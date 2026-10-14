import { useCallback, useEffect, useState } from 'react';
import { characterElement, type AssetKind, type Character, type Visual } from '@shared/character';
import { assetUrl } from '@shared/assetUrl';
import type { AssetInfo } from '@shared/types';
import FileSlot, { type SlotFile } from './FileSlot';
import { Checkbox, Field, Group, Notice, NumberInput, Slider } from './fields';
import { heightFor, probeMedia, widthFor } from './media';
import type { Characters } from './useCharacters';

type StateName = 'idle' | 'speaking';

const VISUAL_KINDS: AssetKind[] = ['image', 'video'];
const MIN_SIZE = 16;
const MAX_SIZE = 4000;

/** What the character looks like: its files, its size, how see-through, how often it moves. */
export default function AppearanceTab({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const { id, appearance } = character;
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [busy, setBusy] = useState<StateName | null>(null);
  const [keepProportions, setKeepProportions] = useState(true);
  // The idle file's own size, for keeping proportions. Per file: a new one is a new shape.
  const [natural, setNatural] = useState<{ src: string; width: number; height: number } | null>(null);

  const loadAssets = useCallback((): void => {
    void window.shardEditor?.assets({ id }).then(setAssets);
  }, [id]);
  useEffect(loadAssets, [loadAssets]);

  const element = characterElement(character);
  const idle = appearance.states.idle ?? null;
  const naturalSize = natural && idle && natural.src === idle.src ? natural : null;

  const slotFile = (visual: Visual | undefined): SlotFile | null => {
    if (!visual) return null;
    const info = assets?.find((entry) => entry.file === visual.src);
    return { name: visual.src, url: assetUrl(id, visual.src), kind: visual.type, bytes: info?.bytes ?? null };
  };

  const setElementSize = (base: Character, width: number, height: number): Character => ({
    ...base,
    layout: {
      ...base.layout,
      elements: base.layout.elements.map((entry) => (entry.type === 'character' ? { ...entry, width, height } : entry))
    }
  });

  /** Puts a file into a state, and lets the old one go once nothing points at it any more. */
  const choose = async (state: StateName, path?: string): Promise<void> => {
    const api = window.shardEditor;
    if (!api) return;
    setBusy(state);
    try {
      const imported = await api.importAsset({ id, kinds: VISUAL_KINDS, ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      const type = imported.kind === 'video' ? 'video' : 'image';
      let next: Character = {
        ...character,
        appearance: { ...appearance, states: { ...appearance.states, [state]: { type, src: imported.file } } }
      };
      // A new look for the character fits its box: same width, the file's own proportions.
      if (state === 'idle' && element) {
        const size = await probeMedia(assetUrl(id, imported.file), type);
        if (size) next = setElementSize(next, element.width, heightFor(element.width, size));
      }
      const old = appearance.states[state]?.src;
      if (await characters.save(next)) {
        if (old && old !== imported.file) await api.releaseAsset({ id, file: old });
      } else {
        // Not saved: the copy is not pointed at by anything, so it goes.
        await api.releaseAsset({ id, file: imported.file });
      }
      loadAssets();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (state: StateName): Promise<void> => {
    const old = appearance.states[state]?.src;
    const states = { ...appearance.states };
    delete states[state];
    if (!(await characters.save({ ...character, appearance: { ...appearance, states } }))) return;
    if (old) await window.shardEditor?.releaseAsset({ id, file: old });
    loadAssets();
  };

  const setWidth = (width: number): void => {
    if (!element) return;
    const ratio = naturalSize ?? { width: element.width, height: element.height };
    characters.update(setElementSize(character, width, keepProportions ? heightFor(width, ratio) : element.height));
  };

  const setHeight = (height: number): void => {
    if (!element) return;
    const ratio = naturalSize ?? { width: element.width, height: element.height };
    characters.update(setElementSize(character, keepProportions ? widthFor(height, ratio) : element.width, height));
  };

  const setLook = (patch: Partial<Character['appearance']>): void => characters.update({ ...character, appearance: { ...appearance, ...patch } });

  return (
    <div className="form">
      <div className="slots">
        <FileSlot
          label="Idle"
          file={slotFile(appearance.states.idle)}
          kinds={VISUAL_KINDS}
          busy={busy === 'idle'}
          onChoose={(path) => void choose('idle', path)}
          onRemove={() => void remove('idle')}
          onMeasured={(size) => idle && setNatural({ src: idle.src, ...size })}
          hint={appearance.states.idle ? undefined : 'A picture or a video. Without one, the character shows as a placeholder with its name.'}
        />
        <FileSlot
          label="Speaking"
          file={slotFile(appearance.states.speaking)}
          kinds={VISUAL_KINDS}
          busy={busy === 'speaking'}
          onChoose={(path) => void choose('speaking', path)}
          onRemove={() => void remove('speaking')}
          hint="Shown instead of idle while it has a line up."
        />
      </div>

      <Group title="Look">
        {element ? (
          <div className="size-row">
            <Field label="Width">
              <NumberInput label="Width" value={element.width} min={MIN_SIZE} max={MAX_SIZE} unit="px" onCommit={setWidth} />
            </Field>
            <Field label="Height">
              <NumberInput label="Height" value={element.height} min={MIN_SIZE} max={MAX_SIZE} unit="px" onCommit={setHeight} />
            </Field>
            <Checkbox label="Keep proportions" checked={keepProportions} onChange={setKeepProportions} />
          </div>
        ) : (
          <div className="prose">This layout has no place for the character itself, so it has no size to set here.</div>
        )}

        <Field label="Opacity">
          <Slider
            label="Opacity"
            value={Math.round(appearance.opacity * 100)}
            min={0}
            max={100}
            unit="%"
            onCommit={(percent) => setLook({ opacity: percent / 100 })}
          />
        </Field>

        <Checkbox label="Mirror" checked={appearance.flip} onChange={(flip) => setLook({ flip })} />
      </Group>

      {idle?.type === 'video' ? (
        <Group title="Motion">
          <Field label="Rest between plays" hint="0 plays it on a loop.">
            <NumberInput label="Rest between plays" value={appearance.restSec} min={0} max={3600} unit="s" onCommit={(restSec) => setLook({ restSec })} />
          </Field>
          <Notice kind="warn">A moving character costs about ten times a still one. A rest between plays is the cheapest way to have both.</Notice>
        </Group>
      ) : null}
    </div>
  );
}
