import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveAssetRequest } from '@main/characters/assetProtocol';
import { CharacterStore } from '@main/characters/store';

let root: string;
let outside: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'jacqueline-characters-'));
  outside = mkdtempSync(join(tmpdir(), 'jacqueline-source-'));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

function sourceFile(name: string, content = 'x'): string {
  const path = join(outside, name);
  writeFileSync(path, content);
  return path;
}

function make(store: CharacterStore, name = 'Miku') {
  const result = store.create(name);
  if (!result.ok) throw new Error(result.error);
  return result.character;
}

describe('CharacterStore', () => {
  it('starts empty and makes its folder', () => {
    const nested = join(root, 'not', 'there', 'yet');
    expect(new CharacterStore(nested).list()).toEqual([]);
    expect(existsSync(nested)).toBe(true);
  });

  it('creates a character that is still there after a restart', () => {
    const created = make(new CharacterStore(root));
    const reopened = new CharacterStore(root);
    expect(reopened.get(created.id)).toEqual(created);
    expect(existsSync(join(root, created.id, 'assets'))).toBe(true);
  });

  it('saves a change, and refuses one that is not valid without touching the file', () => {
    const store = new CharacterStore(root);
    const created = make(store);

    expect(store.save({ ...created, name: 'Rin' }).ok).toBe(true);
    expect(new CharacterStore(root).get(created.id)?.name).toBe('Rin');

    const refused = store.save({ ...created, name: '' });
    expect(refused.ok).toBe(false);
    expect(store.get(created.id)?.name).toBe('Rin');
    expect(new CharacterStore(root).get(created.id)?.name).toBe('Rin');
  });

  it('does not save a character it has never heard of', () => {
    const store = new CharacterStore(root);
    const created = make(store);
    expect(store.save({ ...created, id: 'someone-else' }).ok).toBe(false);
    expect(existsSync(join(root, 'someone-else'))).toBe(false);
  });

  it('tells its listeners about every change', () => {
    const store = new CharacterStore(root);
    let changes = 0;
    store.onChange(() => (changes += 1));
    const created = make(store);
    store.save({ ...created, enabled: false });
    store.remove(created.id);
    expect(changes).toBe(3);
  });

  it('duplicates a character with its files', () => {
    const store = new CharacterStore(root);
    const created = make(store);
    const imported = store.importAsset(created.id, sourceFile('idle.png', 'pixels'));
    expect(imported.ok).toBe(true);

    const copy = store.duplicate(created.id);
    if (!copy.ok) throw new Error(copy.error);
    expect(copy.character.id).not.toBe(created.id);
    expect(copy.character.name).toBe('Miku copy');
    expect(readFileSync(join(root, copy.character.id, 'assets', 'idle.png'), 'utf8')).toBe('pixels');
  });

  it('removes a character and its folder', () => {
    const store = new CharacterStore(root);
    const created = make(store);
    expect(store.remove(created.id).ok).toBe(true);
    expect(store.list()).toEqual([]);
    expect(existsSync(join(root, created.id))).toBe(false);
    expect(store.remove(created.id).ok).toBe(false);
  });

  it('keeps a character whose file is broken in the list, as an error, beside the ones that work', () => {
    const good = make(new CharacterStore(root));
    mkdirSync(join(root, 'broken-json'));
    writeFileSync(join(root, 'broken-json', 'character.json'), '{ not json');
    mkdirSync(join(root, 'wrong-shape'));
    writeFileSync(join(root, 'wrong-shape', 'character.json'), JSON.stringify({ schema: 1, name: 5 }));
    mkdirSync(join(root, 'no-file'));

    const store = new CharacterStore(root);
    const byId = Object.fromEntries(store.list().map((entry) => [entry.id, entry.ok]));
    expect(byId).toEqual({ [good.id]: true, 'broken-json': false, 'wrong-shape': false, 'no-file': false });
    expect(store.get('broken-json')).toBeNull();
    // Still removable, so the list can be cleaned up from inside the app.
    expect(store.remove('broken-json').ok).toBe(true);
  });

  it('takes the folder name as the id of a folder copied by hand', () => {
    const store = new CharacterStore(root);
    const created = make(store);
    mkdirSync(join(root, 'hand-copy'));
    writeFileSync(join(root, 'hand-copy', 'character.json'), readFileSync(join(root, created.id, 'character.json')));

    const reopened = new CharacterStore(root);
    expect(reopened.get('hand-copy')?.id).toBe('hand-copy');
    expect(reopened.list()).toHaveLength(2);
  });

  it('ignores folders that could not be a character', () => {
    mkdirSync(join(root, 'Not An Id'));
    writeFileSync(join(root, 'stray.txt'), 'x');
    expect(new CharacterStore(root).list()).toEqual([]);
  });
});

describe('CharacterStore assets', () => {
  it('copies a file in and lists it', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    const result = store.importAsset(id, sourceFile('idle.webm'));
    expect(result).toEqual({ ok: true, file: 'idle.webm', kind: 'video' });
    expect(store.listAssets(id)).toEqual(['idle.webm']);
  });

  it('numbers a name that is taken instead of overwriting it', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    store.importAsset(id, sourceFile('idle.png', 'first'));
    const second = store.importAsset(id, sourceFile('idle.png', 'second'));
    expect(second).toMatchObject({ ok: true, file: 'idle-2.png' });
    expect(readFileSync(join(root, id, 'assets', 'idle.png'), 'utf8')).toBe('first');
    expect(readFileSync(join(root, id, 'assets', 'idle-2.png'), 'utf8')).toBe('second');
  });

  it('gives an awkward file name one the format can hold', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    const result = store.importAsset(id, sourceFile('..аніме (final)!.PNG'));
    if (!result.ok) throw new Error(result.error);
    expect(store.assetPath(id, result.file)).not.toBeNull();
    expect(result.file.endsWith('.png')).toBe(true);
  });

  it('refuses a file it cannot use, one that is too large, and an unknown character', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    expect(store.importAsset(id, sourceFile('run.exe')).ok).toBe(false);
    expect(store.importAsset(id, sourceFile('big.woff2', 'x'.repeat(8 * 1024 * 1024 + 1))).ok).toBe(false);
    expect(store.importAsset('nobody', sourceFile('idle.png')).ok).toBe(false);
    expect(store.importAsset(id, join(outside, 'missing.png')).ok).toBe(false);
    expect(store.listAssets(id)).toEqual([]);
  });

  it('removes a file', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    store.importAsset(id, sourceFile('idle.png'));
    expect(store.removeAsset(id, 'idle.png').ok).toBe(true);
    expect(store.listAssets(id)).toEqual([]);
  });
});

describe('asset requests', () => {
  it('resolves a character\'s own file, ignoring the version query', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    store.importAsset(id, sourceFile('my idle.png'));
    expect(resolveAssetRequest(`jacqueline-asset://${id}/my%20idle.png?v=12`, store)).toBe(join(root, id, 'assets', 'my idle.png'));
  });

  it('refuses anything that is not a bare file of a known character', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    writeFileSync(join(root, 'secret.txt'), 'x');
    for (const url of [
      `jacqueline-asset://${id}/..%2F..%2Fsecret.txt`,
      `jacqueline-asset://${id}/..%5C..%5Csecret.txt`,
      `jacqueline-asset://${id}/sub/idle.png`,
      `jacqueline-asset://${id}/`,
      `jacqueline-asset://${id}/%E0%A4%A`,
      'jacqueline-asset://nobody/idle.png',
      'jacqueline-asset://../idle.png',
      `file:///${id}/idle.png`,
      'not a url'
    ]) {
      expect(resolveAssetRequest(url, store), url).toBeNull();
    }
  });

  it('cannot be walked out of the assets folder by an encoded dot segment', () => {
    const store = new CharacterStore(root);
    const { id } = make(store);
    // The URL parser collapses the `..` before we see it; what is left is a
    // bare name, looked for inside the folder like any other.
    expect(resolveAssetRequest(`jacqueline-asset://${id}/%2E%2E/secret.txt`, store)).toBe(join(root, id, 'assets', 'secret.txt'));
  });
});
