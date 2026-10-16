/**
 * A character as one file to hand to someone: a zip of `character.json` and
 * the files it uses. Import is the careful half — the zip is someone else's.
 */

import { readFileSync } from 'node:fs';
import {
  ASSET_MAX_BYTES,
  assetKindOf,
  assetNameSchema,
  CHARACTER_SCHEMA_VERSION,
  characterSchema,
  describeIssue,
  referencedAssets,
  type Character
} from '@shared/character';
import type { CharacterStore, StoreResult } from './store';
import { readZip, writeZip, ZipError, type ZipEntry } from './zip';

const CHARACTER_FILE = 'character.json';
const CHARACTER_FILE_MAX = 2 * 1024 * 1024;
/** Every asset slot a character has, and then some. */
const MAX_ENTRIES = 1200;
/** A zip bigger than this is not a character. Read whole into memory, so it is checked first. */
export const ZIP_MAX_BYTES = 512 * 1024 * 1024;
/** Everything in it unpacked, together: a little zip must not become gigabytes. */
const UNPACKED_MAX_BYTES = 768 * 1024 * 1024;

/** The character and every file it uses; files in its folder it does not use stay behind. */
export function exportCharacter(store: CharacterStore, id: string): StoreResult<{ zip: Buffer }> {
  const character = store.get(id);
  if (!character) return { ok: false, error: 'Unknown character.' };
  const entries: ZipEntry[] = [{ name: CHARACTER_FILE, data: Buffer.from(JSON.stringify(character, null, 2), 'utf8') }];
  try {
    for (const file of [...referencedAssets(character)].sort()) {
      const path = store.assetPath(id, file);
      // A file it points at that has gone missing is missing in the copy too.
      if (!path) continue;
      try {
        entries.push({ name: `assets/${file}`, data: readFileSync(path) });
      } catch {
        // Gone: the import will say which.
      }
    }
    return { ok: true, zip: writeZip(entries) };
  } catch (err) {
    return { ok: false, error: `Could not pack it: ${(err as Error).message}` };
  }
}

/**
 * Where an entry would sit in a character's folder: `character.json`,
 * `assets/<file>`, or either one level down — what zipping the folder itself
 * gives. Null for anything else, which is not read at all.
 */
function placeOf(name: string): { prefix: string; path: string } | null {
  const parts = name.split('/');
  const prefix = parts.length === 2 && parts[1] === CHARACTER_FILE ? `${parts[0]}/` : parts.length === 3 && parts[1] === 'assets' ? `${parts[0]}/` : '';
  const path = name.slice(prefix.length);
  if (path === CHARACTER_FILE) return { prefix, path };
  if (path.startsWith('assets/') && assetNameSchema.safeParse(path.slice('assets/'.length)).success) return { prefix, path };
  return null;
}

function limitFor(name: string): number | null {
  const place = placeOf(name);
  if (!place) return null;
  if (place.path === CHARACTER_FILE) return CHARACTER_FILE_MAX;
  const kind = assetKindOf(place.path);
  return kind ? ASSET_MAX_BYTES[kind] : null;
}

export function importCharacter(store: CharacterStore, zip: Buffer): StoreResult<{ character: Character }> {
  let entries: ZipEntry[];
  try {
    entries = readZip(zip, { maxEntries: MAX_ENTRIES, maxBytes: limitFor, maxTotal: UNPACKED_MAX_BYTES });
  } catch (err) {
    return { ok: false, error: err instanceof ZipError ? err.message : `That zip could not be read: ${(err as Error).message}` };
  }

  // One character per zip, at the top or in a single folder.
  const found = entries.filter((entry) => placeOf(entry.name)?.path === CHARACTER_FILE);
  if (found.length === 0) return { ok: false, error: 'There is no character.json in that zip.' };
  if (found.length > 1) return { ok: false, error: 'That zip holds more than one character. Import them one at a time.' };
  const prefix = placeOf(found[0]?.name ?? '')?.prefix ?? '';

  let raw: unknown;
  try {
    raw = JSON.parse((found[0]?.data ?? Buffer.alloc(0)).toString('utf8'));
  } catch {
    return { ok: false, error: 'Its character.json is not valid JSON.' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, error: 'Its character.json is not a character.' };
  const version = (raw as { schema?: unknown }).schema;
  if (typeof version === 'number' && version > CHARACTER_SCHEMA_VERSION) {
    return { ok: false, error: 'It was made by a newer SHARD. Update SHARD to import it.' };
  }
  // Its id is replaced on the way in; where it stood is someone else's screen.
  const parsed = characterSchema.safeParse({ ...raw, id: 'imported' });
  if (!parsed.success) return { ok: false, error: `Its character.json is not valid: ${describeIssue(parsed.error)}` };
  const character = { ...parsed.data, presence: { ...parsed.data.presence, position: null } };

  const files = new Map<string, Buffer>();
  for (const entry of entries) {
    if (!entry.name.startsWith(prefix)) continue;
    const path = entry.name.slice(prefix.length);
    if (path.startsWith('assets/')) files.set(path.slice('assets/'.length), entry.data);
  }
  const needed = referencedAssets(character);
  const missing = [...needed].filter((file) => !files.has(file));
  if (missing.length > 0) return { ok: false, error: `It needs ${missing.join(', ')}, which ${missing.length === 1 ? 'is' : 'are'} not in the zip.` };
  // What it does not use is not brought in.
  for (const file of [...files.keys()]) if (!needed.has(file)) files.delete(file);

  return store.adopt(character, files);
}
