import { randomUUID } from 'node:crypto';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync, unlinkSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import {
  ASSET_MAX_BYTES,
  assetKindOf,
  assetNameSchema,
  characterIdSchema,
  characterSchema,
  defaultCharacter,
  describeIssue,
  type AssetKind,
  type Character,
  type CharacterEntry
} from '@shared/character';
import type { AssetInfo, EditorResult } from '@shared/types';
import { createLogger } from '../app/logger';
import { readJson, writeJsonAtomic } from '../app/jsonFile';

const log = createLogger('characters');

const CHARACTER_FILE = 'character.json';
const ASSETS_DIR = 'assets';

export type StoreResult<T = object> = EditorResult<T>;

/**
 * The characters on disk: one folder each under `root`, holding
 * `character.json` and an `assets/` folder. The folder's name is the
 * character's id — a folder copied by hand is a new character, whatever id the
 * file inside it still carries.
 *
 * A folder whose file cannot be read stays in the list as an error rather
 * than vanishing or taking the app down: its assets are the user's work.
 */
export class CharacterStore {
  private readonly entries = new Map<string, CharacterEntry>();
  private readonly listeners = new Set<() => void>();

  constructor(private readonly root: string) {
    this.reload();
  }

  /** Re-reads everything from disk. */
  reload(): void {
    this.entries.clear();
    let names: string[] = [];
    try {
      mkdirSync(this.root, { recursive: true });
      names = readdirSync(this.root, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    } catch (err) {
      log.error(`cannot read characters folder: ${(err as Error).message}`);
    }
    for (const id of names) {
      if (!characterIdSchema.safeParse(id).success) continue;
      this.entries.set(id, this.read(id));
    }
  }

  list(): CharacterEntry[] {
    return [...this.entries.values()];
  }

  get(id: string): Character | null {
    const entry = this.entries.get(id);
    return entry?.ok ? entry.character : null;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  create(name: string): StoreResult<{ character: Character }> {
    return this.write(defaultCharacter(randomUUID(), name));
  }

  /** Replaces a character that already exists. */
  save(character: unknown): StoreResult<{ character: Character }> {
    const id = (character as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !this.entries.has(id)) return { ok: false, error: 'Unknown character.' };
    return this.write(character);
  }

  /** A copy with every file the original had. */
  duplicate(sourceId: string): StoreResult<{ character: Character }> {
    const source = this.get(sourceId);
    if (!source) return { ok: false, error: 'Unknown character.' };

    const id = randomUUID();
    try {
      const assets = this.assetsDir(sourceId);
      if (existsSync(assets)) cpSync(assets, this.assetsDir(id), { recursive: true });
    } catch (err) {
      rmSync(this.dir(id), { recursive: true, force: true });
      return { ok: false, error: `Could not copy its files: ${(err as Error).message}` };
    }
    return this.write({ ...source, id, name: `${source.name} copy`.slice(0, 60) });
  }

  remove(id: string): StoreResult {
    if (!this.entries.has(id)) return { ok: false, error: 'Unknown character.' };
    try {
      rmSync(this.dir(id), { recursive: true, force: true });
    } catch (err) {
      return { ok: false, error: `Could not remove its files: ${(err as Error).message}` };
    }
    this.entries.delete(id);
    this.emit();
    return { ok: true };
  }

  /* ------------------------------ assets ---------------------------- */

  /**
   * Copies a file into the character's assets and answers with the name it
   * has there. A name already taken gets a number, never an overwrite: two
   * states may well be given different files that are both called `idle.png`.
   */
  importAsset(id: string, sourcePath: string): StoreResult<{ file: string; kind: AssetKind }> {
    if (!this.entries.has(id)) return { ok: false, error: 'Unknown character.' };

    const kind = assetKindOf(sourcePath);
    if (!kind) return { ok: false, error: 'That kind of file cannot be used.' };

    try {
      const size = statSync(sourcePath).size;
      if (size > ASSET_MAX_BYTES[kind]) {
        return { ok: false, error: `That file is larger than ${ASSET_MAX_BYTES[kind] / (1024 * 1024)} MB.` };
      }
      const dir = this.assetsDir(id);
      mkdirSync(dir, { recursive: true });
      const file = freeName(dir, safeAssetName(sourcePath));
      const tmp = join(dir, `${file}.tmp`);
      copyFileSync(sourcePath, tmp);
      renameSync(tmp, join(dir, file));
      return { ok: true, file, kind };
    } catch (err) {
      return { ok: false, error: `Could not copy the file: ${(err as Error).message}` };
    }
  }

  removeAsset(id: string, file: string): StoreResult {
    const path = this.assetPath(id, file);
    if (!path) return { ok: false, error: 'Unknown file.' };
    try {
      if (existsSync(path)) unlinkSync(path);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: `Could not remove the file: ${(err as Error).message}` };
    }
  }

  /** Every usable file in the character's assets, with what it is and how big. */
  assetInfo(id: string): AssetInfo[] {
    const info: AssetInfo[] = [];
    for (const file of this.listAssets(id)) {
      const kind = assetKindOf(file);
      const path = this.assetPath(id, file);
      if (!kind || !path) continue;
      try {
        info.push({ file, kind, bytes: statSync(path).size });
      } catch {
        // Gone between the listing and the look: not there, then.
      }
    }
    return info;
  }

  listAssets(id: string): string[] {
    if (!this.entries.has(id)) return [];
    try {
      return readdirSync(this.assetsDir(id)).filter((name) => assetKindOf(name) !== null);
    } catch {
      return [];
    }
  }

  /**
   * Where an asset is on disk, or null if the id or the name is not one this
   * store would have produced. Both are checked as bare names, so nothing
   * that reaches here can point outside the character's own folder.
   */
  assetPath(id: string, file: string): string | null {
    if (!this.entries.has(id)) return null;
    if (!assetNameSchema.safeParse(file).success) return null;
    return join(this.assetsDir(id), file);
  }

  /* ------------------------------------------------------------------ */

  private dir(id: string): string {
    return join(this.root, id);
  }

  private assetsDir(id: string): string {
    return join(this.dir(id), ASSETS_DIR);
  }

  private read(id: string): CharacterEntry {
    try {
      const raw = readJson(join(this.dir(id), CHARACTER_FILE));
      const withId = raw !== null && typeof raw === 'object' ? { ...raw, id } : raw;
      const parsed = characterSchema.safeParse(withId);
      if (parsed.success) return { id, ok: true, character: parsed.data };
      log.warn(`character "${id}" is not valid: ${describeIssue(parsed.error)}`);
      return { id, ok: false, error: describeIssue(parsed.error) };
    } catch (err) {
      log.warn(`character "${id}" cannot be read: ${(err as Error).message}`);
      return { id, ok: false, error: `Its file cannot be read: ${(err as Error).message}` };
    }
  }

  private write(character: unknown): StoreResult<{ character: Character }> {
    const parsed = characterSchema.safeParse(character);
    if (!parsed.success) return { ok: false, error: describeIssue(parsed.error) };
    const value = parsed.data;
    try {
      mkdirSync(this.assetsDir(value.id), { recursive: true });
      writeJsonAtomic(join(this.dir(value.id), CHARACTER_FILE), value);
    } catch (err) {
      log.error(`cannot write character "${value.id}": ${(err as Error).message}`);
      return { ok: false, error: `Could not save it to disk: ${(err as Error).message}` };
    }
    this.entries.set(value.id, { id: value.id, ok: true, character: value });
    this.emit();
    return { ok: true, character: value };
  }

  private emit(): void {
    for (const listener of this.listeners) listener();
  }
}

/** The source's own name with anything a bare asset name cannot hold replaced. */
function safeAssetName(sourcePath: string): string {
  const ext = extname(sourcePath).toLowerCase();
  const stem = basename(sourcePath, extname(sourcePath))
    .replace(/[^A-Za-z0-9_ .-]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[^A-Za-z0-9_]+/, '')
    .slice(0, 80);
  return `${stem || 'file'}${ext}`;
}

function freeName(dir: string, wanted: string): string {
  if (!existsSync(join(dir, wanted))) return wanted;
  const ext = extname(wanted);
  const stem = wanted.slice(0, wanted.length - ext.length);
  for (let n = 2; ; n += 1) {
    const candidate = `${stem}-${n}${ext}`;
    if (!existsSync(join(dir, candidate))) return candidate;
  }
}
