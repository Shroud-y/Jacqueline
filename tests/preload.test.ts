import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '@shared/ipc';

/**
 * A sandboxed preload must be a single self-contained file. Sharing a *value*
 * import between the two preload entries makes Rollup hoist it into a chunk,
 * and the preload then dies with "module not found: ./chunks/ipc.js" — the
 * context bridge silently never appears and the overlay can never render.
 *
 * So the channel names are inlined in each preload. These tests are what stop
 * that copy from drifting, and what stop the chunk from coming back.
 */

const root = process.cwd();

function readPreload(name: string): string {
  return readFileSync(join(root, 'src/preload', name), 'utf8');
}

function inlinedChannels(source: string): string[] {
  const block = /const CHANNEL = \{([\s\S]*?)\} as const;/.exec(source);
  if (!block) throw new Error('no inlined CHANNEL map found');
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((match) => match[1]!);
}

describe('preload channel literals', () => {
  const overlay = readPreload('index.ts');
  const panel = readPreload('panel.ts');

  it('the overlay preload matches the §12 surface exactly', () => {
    expect(new Set(inlinedChannels(overlay))).toEqual(
      new Set([
        IPC.speechShow,
        IPC.speechHide,
        IPC.speechInterrupt,
        IPC.stateUpdate,
        IPC.overlaySetInteractive,
        IPC.overlaySetHotRect,
        IPC.overlayDragStart,
        IPC.overlayDragEnd,
        IPC.overlayPoke,
        IPC.overlayMenu,
        IPC.speechFinished,
        IPC.speechDismissed
      ])
    );
  });

  it('the panel preload matches the settings and debug channels', () => {
    expect(new Set(inlinedChannels(panel))).toEqual(
      new Set([
        IPC.settingsGet,
        IPC.settingsSet,
        IPC.settingsUpdated,
        IPC.settingsDefaults,
        IPC.settingsReset,
        IPC.statusGet,
        IPC.statusUpdated,
        IPC.statusSetMuted,
        IPC.statusSetSnooze,
        IPC.sayNow,
        IPC.foldersPick,
        IPC.debugSnapshot,
        IPC.debugRequestSnapshot,
        IPC.debugFireEvent,
        IPC.presetsPickAsset,
        IPC.presetsClearAsset,
        IPC.presetsAssetStatus,
        IPC.presetsDelete,
        IPC.presetsDuplicate,
        IPC.presetsOpenFolder,
        IPC.bankSaveTemplate
      ])
    );
  });

  it('every inlined channel is a real channel', () => {
    const known = new Set<string>(Object.values(IPC));
    for (const channel of [...inlinedChannels(overlay), ...inlinedChannels(panel)]) {
      expect(known).toContain(channel);
    }
  });

  it('neither preload takes a runtime import that could become a chunk', () => {
    for (const source of [overlay, panel]) {
      const runtimeImports = [...source.matchAll(/^import (?!type )[^;]+ from '([^']+)';/gm)].map(
        (match) => match[1]!
      );
      expect(runtimeImports).toEqual(['electron']);
    }
  });
});
