import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Character } from '@shared/character';
import { CharacterStore } from '@main/characters/store';
import { exportCharacter, importCharacter } from '@main/characters/transfer';
import { readZip, writeZip } from '@main/characters/zip';

let root: string;
let src: string;
let store: CharacterStore;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shard-transfer-'));
  src = mkdtempSync(join(tmpdir(), 'shard-transfer-src-'));
  store = new CharacterStore(root);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(src, { recursive: true, force: true });
});

/** A character with a picture it uses, a sound it uses, and a file it does not. */
function made(): Character {
  const created = store.create('Teto');
  if (!created.ok) throw new Error(created.error);
  const id = created.character.id;
  for (const [name, body] of [
    ['idle.png', 'png'],
    ['hi.ogg', 'ogg'],
    ['unused.png', 'unused']
  ]) {
    writeFileSync(join(src, name), body);
    store.importAsset(id, join(src, name));
  }
  const saved = store.save({
    ...created.character,
    appearance: { ...created.character.appearance, states: { idle: { type: 'image', src: 'idle.png' } } },
    presence: { ...created.character.presence, position: { x: 5000, y: 10 } },
    lines: { hi: [{ id: 'a', text: 'Hi.', audio: 'hi.ogg' }] }
  });
  if (!saved.ok) throw new Error(saved.error);
  return saved.character;
}

const files = (zip: Buffer): string[] => readZip(zip, { maxEntries: 100, maxBytes: () => 1e6, maxTotal: 1e9 }).map((entry) => entry.name);

describe('passing a character on', () => {
  it('exports the character and only the files it uses', () => {
    const character = made();
    const packed = exportCharacter(store, character.id);
    if (!packed.ok) throw new Error(packed.error);
    expect(files(packed.zip)).toEqual(['character.json', 'assets/hi.ogg', 'assets/idle.png']);
    expect(exportCharacter(store, 'nobody').ok).toBe(false);
  });

  it('imports as a new character with its own id, its files, and no place on a screen it has never seen', () => {
    const character = made();
    const packed = exportCharacter(store, character.id);
    if (!packed.ok) throw new Error(packed.error);

    const first = importCharacter(store, packed.zip);
    const second = importCharacter(store, packed.zip);
    if (!first.ok || !second.ok) throw new Error('import failed');
    expect(new Set([character.id, first.character.id, second.character.id]).size).toBe(3);
    expect(first.character.name).toBe('Teto');
    expect(first.character.presence.position).toBeNull();
    expect(first.character.lines).toEqual(character.lines);
    expect(readdirSync(join(root, first.character.id, 'assets')).sort()).toEqual(['hi.ogg', 'idle.png']);
  });

  it('takes a zip of the folder itself, one level down', () => {
    const character = made();
    const packed = exportCharacter(store, character.id);
    if (!packed.ok) throw new Error(packed.error);
    const inFolder = writeZip(readZip(packed.zip, { maxEntries: 100, maxBytes: () => 1e6, maxTotal: 1e9 }).map((entry) => ({ ...entry, name: `Teto/${entry.name}` })));
    const imported = importCharacter(store, inFolder);
    expect(imported.ok).toBe(true);
  });

  it('refuses a zip that is missing a file the character uses, and leaves nothing behind', () => {
    const character = made();
    const before = readdirSync(root).length;
    const zip = writeZip([{ name: 'character.json', data: Buffer.from(JSON.stringify(character)) }]);
    const result = importCharacter(store, zip);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain('idle.png');
    expect(readdirSync(root).length).toBe(before);
  });

  it('refuses no character, two characters, bad JSON, an invalid or a newer character', () => {
    const json = (value: unknown): Buffer => Buffer.from(JSON.stringify(value));
    const character = made();
    const cases: [Buffer, string][] = [
      [writeZip([{ name: 'readme.txt', data: Buffer.from('hi') }]), 'no character.json'],
      [
        writeZip([
          { name: 'a/character.json', data: json(character) },
          { name: 'b/character.json', data: json(character) }
        ]),
        'more than one'
      ],
      [writeZip([{ name: 'character.json', data: Buffer.from('{oops') }]), 'not valid JSON'],
      [writeZip([{ name: 'character.json', data: json({ ...character, name: '' }) }]), 'not valid'],
      [writeZip([{ name: 'character.json', data: json({ ...character, schema: 99 }) }]), 'newer SHARD'],
      [Buffer.from('nope'), 'not a zip']
    ];
    for (const [zip, words] of cases) {
      const result = importCharacter(store, zip);
      expect(result.ok, words).toBe(false);
      if (!result.ok) expect(result.error).toContain(words);
    }
  });

  it('never writes outside the new folder, whatever the zip names its files', () => {
    const character = { ...made(), appearance: { ...made().appearance, states: {} }, lines: {} };
    const zip = writeZip([
      { name: 'character.json', data: Buffer.from(JSON.stringify(character)) },
      { name: 'assets/../../evil.png', data: Buffer.from('x') },
      { name: '../evil.png', data: Buffer.from('x') },
      { name: 'C:/evil.png', data: Buffer.from('x') }
    ]);
    const result = importCharacter(store, zip);
    expect(result.ok).toBe(true);
    expect(existsSync(join(root, '..', 'evil.png'))).toBe(false);
    expect(existsSync(join(root, 'evil.png'))).toBe(false);
    if (result.ok) expect(readdirSync(join(root, result.character.id, 'assets'))).toEqual([]);
  });
});
