/**
 * Telling Dota 2 where to send its game state: one cfg file in its
 * `gamestate_integration` folder. Dota reads it when it starts. Finding Dota
 * means finding Steam (the registry) and the library Dota is installed in
 * (`libraryfolders.vdf`); when that fails, the user points at the folder.
 */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export const CFG_NAME = 'gamestate_integration_jacqueline.cfg';
const DOTA_IN_LIBRARY = ['steamapps', 'common', 'dota 2 beta'];
/** Where in Dota's own folder the cfg goes. */
const CFG_DIR_IN_DOTA = ['game', 'dota', 'cfg', 'gamestate_integration'];

/**
 * The cfg Dota reads. Only provider, map, player and hero are asked for: what
 * the events need and nothing else (no items, no abilities, no other players).
 * `throttle` 0.5 s is as often as Dota sends while something changes;
 * `heartbeat` 30 s while nothing does.
 */
export function cfgText(port: number, token: string): string {
  return [
    '"Jacqueline"',
    '{',
    `  "uri"        "http://127.0.0.1:${port}/"`,
    '  "timeout"    "5.0"',
    '  "buffer"     "0.1"',
    '  "throttle"   "0.5"',
    '  "heartbeat"  "30.0"',
    '  "data"',
    '  {',
    '    "provider" "1"',
    '    "map"      "1"',
    '    "player"   "1"',
    '    "hero"     "1"',
    '  }',
    '  "auth"',
    '  {',
    `    "token"    "${token}"`,
    '  }',
    '}',
    ''
  ].join('\r\n');
}

/** The library folders `libraryfolders.vdf` lists, those holding Dota (app 570) first. */
export function libraryPaths(vdf: string): string[] {
  const withDota: string[] = [];
  const others: string[] = [];
  // Each library is `"<n>" { "path" "D:\\SteamLibrary" … "apps" { "570" "…" } }`; cut the text at each "path".
  const parts = vdf.split(/"path"\s+/).slice(1);
  for (const part of parts) {
    const match = /^"((?:[^"\\]|\\.)*)"/.exec(part);
    if (!match?.[1]) continue;
    const path = match[1].replace(/\\\\/g, '\\');
    (/"570"\s+"/.test(part) ? withDota : others).push(path);
  }
  return [...withDota, ...others];
}

/** `SteamPath` as `reg query` prints it, or null. */
export function steamPathFromReg(output: string): string | null {
  const match = /SteamPath\s+REG_SZ\s+(.+)/i.exec(output);
  return match?.[1]?.trim() || null;
}

/**
 * The folders a picked folder could mean as Dota's own: Dota's folder itself,
 * a Steam library, its `steamapps`, or somewhere inside Dota.
 */
export function dotaDirCandidates(picked: string): string[] {
  const normal = picked.replace(/[\\/]+$/, '');
  const candidates = [normal, join(normal, ...DOTA_IN_LIBRARY), join(normal, 'common', 'dota 2 beta')];
  const inside = /^(.*?[\\/]dota 2 beta)(?:[\\/]|$)/i.exec(normal);
  if (inside?.[1]) candidates.unshift(inside[1]);
  return candidates;
}

/** Whether this is Dota's folder: the one with `game/dota` in it. */
function isDotaDir(dir: string): boolean {
  return existsSync(join(dir, 'game', 'dota'));
}

function queryRegistry(): Promise<string> {
  return new Promise((resolve) => {
    execFile('reg', ['query', 'HKCU\\Software\\Valve\\Steam', '/v', 'SteamPath'], { windowsHide: true, timeout: 5_000 }, (err, stdout) => resolve(err ? '' : stdout));
  });
}

/** Dota's folder, looked for where Steam says its libraries are; null when it is not found. */
export async function findDotaDir(): Promise<string | null> {
  const steam = steamPathFromReg(await queryRegistry());
  const roots = [steam, 'C:\\Program Files (x86)\\Steam', 'C:\\Program Files\\Steam'].filter((root): root is string => !!root);
  for (const root of roots) {
    const vdf = join(root, 'steamapps', 'libraryfolders.vdf');
    let libraries = [root];
    try {
      if (existsSync(vdf)) libraries = [...libraryPaths(readFileSync(vdf, 'utf8')), root];
    } catch {
      // Unreadable: the root itself is still worth a look.
    }
    for (const library of libraries) {
      const dir = join(library, ...DOTA_IN_LIBRARY);
      if (isDotaDir(dir)) return dir;
    }
  }
  return null;
}

/** Dota's folder for whatever folder the user picked; null when none of it is Dota. */
export function dotaDirFrom(picked: string): string | null {
  return dotaDirCandidates(picked).find(isDotaDir) ?? null;
}

/** Writes the cfg into Dota's folder and answers with where it went. Throws when it cannot. */
export function writeCfg(dotaDir: string, port: number, token: string): string {
  const dir = join(dotaDir, ...CFG_DIR_IN_DOTA);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, CFG_NAME);
  writeFileSync(`${path}.tmp`, cfgText(port, token), 'utf8');
  renameSync(`${path}.tmp`, path);
  return path;
}
