import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CFG_NAME, cfgText, dotaDirFrom, libraryPaths, steamPathFromReg, writeCfg } from '@main/sensors/dotaSetup';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jacqueline-dota-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('cfgText', () => {
  it('points Dota at 127.0.0.1 with the token, asking for no more than the events need', () => {
    const text = cfgText(47420, 'abc123');
    expect(text).toContain('"uri"        "http://127.0.0.1:47420/"');
    expect(text).toContain('"token"    "abc123"');
    for (const part of ['provider', 'map', 'player', 'hero']) expect(text).toMatch(new RegExp(`"${part}"\\s+"1"`));
    expect(text).not.toMatch(/"items"|"abilities"|"allplayers"/);
    // Braces balance, so Dota's KeyValues reader takes it.
    expect(text.split('{').length).toBe(text.split('}').length);
  });
});

describe('libraryPaths', () => {
  it('lists every library, the one with Dota (570) first, backslashes as written', () => {
    const vdf = `"libraryfolders"
{
\t"0"
\t{
\t\t"path"\t\t"C:\\\\Program Files (x86)\\\\Steam"
\t\t"apps"
\t\t{
\t\t\t"228980"\t\t"1"
\t\t}
\t}
\t"1"
\t{
\t\t"path"\t\t"D:\\\\SteamLibrary"
\t\t"apps"
\t\t{
\t\t\t"570"\t\t"40000000000"
\t\t}
\t}
}`;
    expect(libraryPaths(vdf)).toEqual(['D:\\SteamLibrary', 'C:\\Program Files (x86)\\Steam']);
    expect(libraryPaths('garbage')).toEqual([]);
  });
});

describe('steamPathFromReg', () => {
  it('reads SteamPath out of reg query', () => {
    const out = '\r\nHKEY_CURRENT_USER\\Software\\Valve\\Steam\r\n    SteamPath    REG_SZ    c:/program files (x86)/steam\r\n\r\n';
    expect(steamPathFromReg(out)).toBe('c:/program files (x86)/steam');
    expect(steamPathFromReg('')).toBeNull();
  });
});

describe('finding Dota from a picked folder, and writing the cfg', () => {
  it('takes Dota\'s folder, its library, or a folder inside it', () => {
    const dota = join(dir, 'lib', 'steamapps', 'common', 'dota 2 beta');
    mkdirSync(join(dota, 'game', 'dota'), { recursive: true });
    expect(dotaDirFrom(dota)).toBe(dota);
    expect(dotaDirFrom(join(dir, 'lib'))).toBe(dota);
    expect(dotaDirFrom(join(dir, 'lib', 'steamapps'))).toBe(dota);
    expect(dotaDirFrom(join(dota, 'game', 'dota'))).toBe(dota);
    expect(dotaDirFrom(dir)).toBeNull();
  });

  it('writes the cfg into gamestate_integration, making the folder', () => {
    const dota = join(dir, 'dota 2 beta');
    mkdirSync(join(dota, 'game', 'dota'), { recursive: true });
    const path = writeCfg(dota, 50000, 'tok');
    expect(path).toBe(join(dota, 'game', 'dota', 'cfg', 'gamestate_integration', CFG_NAME));
    expect(readFileSync(path, 'utf8')).toBe(cfgText(50000, 'tok'));
  });
});
