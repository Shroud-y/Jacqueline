import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AssetKind } from '@shared/character';
import { editorHandlers } from '@main/characters/editorIpc';
import { CharacterStore } from '@main/characters/store';

let root: string;
let outside: string;
let store: CharacterStore;
let picked: string | null;
let askedFor: readonly AssetKind[][];
let opened: string[];

const handlers = (): ReturnType<typeof editorHandlers> =>
  editorHandlers(store, {
    pickFile: async (kinds) => {
      askedFor = [...askedFor, [...kinds]];
      return picked;
    },
    openFolder: async (id) => {
      opened.push(id);
      return { ok: true };
    }
  });

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'shard-editor-'));
  outside = mkdtempSync(join(tmpdir(), 'shard-editor-src-'));
  store = new CharacterStore(root);
  picked = null;
  askedFor = [];
  opened = [];
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

async function make(name = 'Miku') {
  const result = await handlers().create({ name });
  if (!result.ok) throw new Error(result.error);
  return result.character;
}

describe('editor requests', () => {
  it('creates, lists, saves, duplicates and removes', async () => {
    const h = handlers();
    const created = await make();
    expect(await h.list()).toHaveLength(1);

    const saved = await h.save({ ...created, name: 'Rin', enabled: false });
    expect(saved).toMatchObject({ ok: true, character: { name: 'Rin', enabled: false } });

    const copy = await h.duplicate({ id: created.id });
    expect(copy).toMatchObject({ ok: true, character: { name: 'Rin copy' } });
    expect(await h.list()).toHaveLength(2);

    expect(await h.remove({ id: created.id })).toEqual({ ok: true });
    expect(await h.list()).toHaveLength(1);
  });

  it('says why a character that is not valid was not saved', async () => {
    const created = await make();
    const result = await handlers().save({ ...created, name: '' });
    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.error).toMatch(/name/i);
    expect(store.get(created.id)?.name).toBe('Miku');
  });

  it('refuses a new character with no name', async () => {
    expect((await handlers().create({ name: '  ' })).ok).toBe(false);
    expect(store.list()).toEqual([]);
  });

  it('refuses anything that is not the shape it expects, and touches nothing', async () => {
    const h = handlers();
    const created = await make();
    for (const payload of [undefined, null, 'x', 7, {}, { id: 7 }, { id: '../..' }, { id: 'A B' }]) {
      expect((await h.duplicate(payload)).ok, JSON.stringify(payload)).toBe(false);
      expect((await h.remove(payload)).ok, JSON.stringify(payload)).toBe(false);
      expect((await h.openFolder(payload)).ok, JSON.stringify(payload)).toBe(false);
      expect((await h.importAsset(payload)).ok, JSON.stringify(payload)).toBe(false);
    }
    expect((await h.create({ name: 5 })).ok).toBe(false);
    expect((await h.save(null)).ok).toBe(false);
    expect((await h.save({ ...created, id: 'someone-else' })).ok).toBe(false);
    expect(store.list()).toHaveLength(1);
    expect(existsSync(join(root, created.id))).toBe(true);
    expect(opened).toEqual([]);
  });

  it('imports the file the user picked, asking only for the kinds it was told to', async () => {
    const created = await make();
    picked = join(outside, 'idle.png');
    writeFileSync(picked, 'pixels');
    const result = await handlers().importAsset({ id: created.id, kinds: ['image', 'video'] });
    expect(result).toEqual({ ok: true, file: 'idle.png', kind: 'image' });
    expect(askedFor).toEqual([['image', 'video']]);
    expect(store.listAssets(created.id)).toEqual(['idle.png']);
  });

  it('treats a closed file picker as nothing happening, not as an error to show', async () => {
    const created = await make();
    expect(await handlers().importAsset({ id: created.id, kinds: ['image'] })).toEqual({ ok: false, error: '' });
  });

  it('does not open a file picker for a character that does not exist, or for a kind it has never heard of', async () => {
    const created = await make();
    expect((await handlers().importAsset({ id: 'nobody', kinds: ['image'] })).ok).toBe(false);
    expect((await handlers().importAsset({ id: created.id, kinds: ['program'] })).ok).toBe(false);
    expect((await handlers().importAsset({ id: created.id, kinds: [] })).ok).toBe(false);
    expect(askedFor).toEqual([]);
  });

  it('opens the folder of a character that exists, and of no other', async () => {
    const created = await make();
    expect(await handlers().openFolder({ id: created.id })).toEqual({ ok: true });
    expect((await handlers().openFolder({ id: 'nobody' })).ok).toBe(false);
    expect(opened).toEqual([created.id]);
  });
});
