import { useCallback, useEffect, useState } from 'react';
import { characterElement, type AssetKind, type Character, type Visual } from '@shared/character';
import { croppedSize } from '@shared/crop';
import { assetUrl } from '@shared/assetUrl';
import type { AssetInfo } from '@shared/types';
import { isAnimated } from '../shared/animationPlayer';
import BackgroundSection from './BackgroundSection';
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
    void window.jacquelineEditor?.assets({ id }).then(setAssets);
  }, [id]);
  useEffect(loadAssets, [loadAssets]);

  const element = characterElement(character);
  const idle = appearance.states.idle ?? null;
  const naturalSize = natural && idle && natural.src === idle.src ? natural : null;

  const slotFile = (visual: Visual | undefined): SlotFile | null => {
    if (!visual) return null;
    const info = assets?.find((entry) => entry.file === visual.src);
    return {
      name: visual.src,
      url: assetUrl(id, visual.src),
      kind: visual.type === 'video' ? 'video' : 'image',
      bytes: info?.bytes ?? null,
      ...(visual.type === 'animation' ? { label: 'Animation' } : {})
    };
  };

  const setElementSize = (base: Character, width: number, height: number): Character => ({
    ...base,
    layout: {
      ...base.layout,
      elements: base.layout.elements.map((entry) => (entry.type === 'character' ? { ...entry, width, height } : entry))
    }
  });

  const uncropped = (base: Character): Character => ({
    ...base,
    layout: {
      ...base.layout,
      elements: base.layout.elements.map((entry) => {
        if (entry.type !== 'character') return entry;
        const { crop: _crop, ...rest } = entry;
        return rest;
      })
    }
  });

  /** Puts a file into a state, and lets the old one go once nothing points at it any more. */
  const choose = async (state: StateName, path?: string): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setBusy(state);
    try {
      const imported = await api.importAsset({ id, kinds: VISUAL_KINDS, ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      const type = imported.kind === 'video' ? 'video' : (await isAnimated(assetUrl(id, imported.file))) ? 'animation' : 'image';
      let next: Character = {
        ...character,
        appearance: { ...appearance, states: { ...appearance.states, [state]: { type, src: imported.file } } }
      };
      // A new look for the character fits its box: same width, the file's own proportions, and
      // whole again: a crop was made for the file it replaces.
      if (state === 'idle' && element) {
        const size = await probeMedia(assetUrl(id, imported.file), type);
        if (size) next = uncropped(setElementSize(next, element.width, heightFor(element.width, size)));
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

  const stylesheet = appearance.stylesheet;
  const [styleBusy, setStyleBusy] = useState(false);

  /** A stylesheet put to use; the one it had goes once nothing points at it. */
  const applyStylesheet = async (file: string | null): Promise<boolean> => {
    const old = appearance.stylesheet;
    if (!(await characters.save({ ...character, appearance: { ...appearance, stylesheet: file } }))) return false;
    if (old && old !== file) await window.jacquelineEditor?.releaseAsset({ id, file: old });
    loadAssets();
    return true;
  };

  const chooseStylesheet = async (path?: string): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setStyleBusy(true);
    try {
      const imported = await api.importAsset({ id, kinds: ['style'], ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      if (!(await applyStylesheet(imported.file))) await api.releaseAsset({ id, file: imported.file });
    } finally {
      setStyleBusy(false);
    }
  };

  /** A stylesheet from the template, put to use and opened for editing. */
  const startStylesheet = async (): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setStyleBusy(true);
    try {
      const made = await api.newStylesheet({ id });
      if (!made.ok) {
        characters.report(made.error);
        return;
      }
      if (await applyStylesheet(made.file)) await api.openAsset({ id, file: made.file });
      else await api.releaseAsset({ id, file: made.file });
    } finally {
      setStyleBusy(false);
    }
  };

  const script = appearance.script;
  const [scriptBusy, setScriptBusy] = useState(false);
  // Null while not known yet; false for a script that came with an imported character.
  const [scriptAllowed, setScriptAllowed] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    void window.jacquelineEditor?.scriptAllowed({ id }).then((allowed) => {
      if (!cancelled) setScriptAllowed(allowed);
    });
    return () => {
      cancelled = true;
    };
  }, [id, script]);

  /** A script put to use; the one it had goes once nothing points at it. */
  const applyScript = async (file: string | null): Promise<boolean> => {
    const old = appearance.script;
    if (!(await characters.save({ ...character, appearance: { ...appearance, script: file } }))) return false;
    if (old && old !== file) await window.jacquelineEditor?.releaseAsset({ id, file: old });
    loadAssets();
    return true;
  };

  /** Chosen or written here: the user's own, so it may run. */
  const allowScript = async (): Promise<void> => {
    const result = await window.jacquelineEditor?.allowScript({ id });
    if (result?.ok) setScriptAllowed(true);
  };

  const chooseScript = async (path?: string): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setScriptBusy(true);
    try {
      const imported = await api.importAsset({ id, kinds: ['script'], ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      if (await applyScript(imported.file)) await allowScript();
      else await api.releaseAsset({ id, file: imported.file });
    } finally {
      setScriptBusy(false);
    }
  };

  const startScript = async (): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setScriptBusy(true);
    try {
      const made = await api.newScript({ id, kind: 'visual' });
      if (!made.ok) {
        characters.report(made.error);
        return;
      }
      if (await applyScript(made.file)) {
        await allowScript();
        await api.openAsset({ id, file: made.file });
      } else {
        await api.releaseAsset({ id, file: made.file });
      }
    } finally {
      setScriptBusy(false);
    }
  };

  const remove = async (state: StateName): Promise<void> => {
    const old = appearance.states[state]?.src;
    const states = { ...appearance.states };
    delete states[state];
    if (!(await characters.save({ ...character, appearance: { ...appearance, states } }))) return;
    if (old) await window.jacquelineEditor?.releaseAsset({ id, file: old });
    loadAssets();
  };

  const setWidth = (width: number): void => {
    if (!element) return;
    const ratio = naturalSize ? croppedSize(naturalSize, element.crop) : { width: element.width, height: element.height };
    characters.update(setElementSize(character, width, keepProportions ? heightFor(width, ratio) : element.height));
  };

  const setHeight = (height: number): void => {
    if (!element) return;
    const ratio = naturalSize ? croppedSize(naturalSize, element.crop) : { width: element.width, height: element.height };
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
          hint={appearance.states.idle ? undefined : 'A picture, a GIF or a video. Without one, the character shows as a placeholder with its name.'}
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

      {idle && idle.type !== 'image' ? (
        <Group title="Motion">
          <Field label="Rest between plays" hint="0 plays it on a loop.">
            <NumberInput label="Rest between plays" value={appearance.restSec} min={0} max={3600} unit="s" onCommit={(restSec) => setLook({ restSec })} />
          </Field>
          <Notice kind="warn">A moving character costs about ten times a still one. A rest between plays is the cheapest way to have both.</Notice>
        </Group>
      ) : null}

      {idle ? <BackgroundSection character={character} characters={characters} idle={idle} /> : null}

      <Group title="Style">
        <FileSlot
          label="Stylesheet"
          file={
            stylesheet
              ? { name: stylesheet, url: assetUrl(id, stylesheet), kind: 'style', bytes: assets?.find((entry) => entry.file === stylesheet)?.bytes ?? null }
              : null
          }
          kinds={['style']}
          busy={styleBusy}
          onChoose={(path) => void chooseStylesheet(path)}
          onRemove={() => void applyStylesheet(null)}
          actions={
            stylesheet ? (
              <button type="button" className="button quiet" onClick={() => void window.jacquelineEditor?.openAsset({ id, file: stylesheet })}>
                Edit
              </button>
            ) : null
          }
          hint="A .css file for the character's window: shadows, filters, animations, how text looks. Saved changes show on the desktop at once."
        />
        {stylesheet ? null : (
          <div>
            <button type="button" className="button quiet under-prose" disabled={styleBusy} onClick={() => void startStylesheet()}>
              Start one from a template
            </button>
          </div>
        )}
      </Group>

      <Group title="Script">
        {script && scriptAllowed === false ? (
          <div className="script-blocked">
            <Notice kind="warn">
              This script came with an imported character and does not run until you allow it. It cannot reach the internet, your files or other
              characters — but read it first: Edit opens it.
            </Notice>
            <button type="button" className="button" onClick={() => void allowScript()}>
              Allow it to run
            </button>
          </div>
        ) : null}
        <FileSlot
          label="Script"
          file={script ? { name: script, url: assetUrl(id, script), kind: 'script', bytes: assets?.find((entry) => entry.file === script)?.bytes ?? null } : null}
          kinds={['script']}
          busy={scriptBusy}
          onChoose={(path) => void chooseScript(path)}
          onRemove={() => void applyScript(null)}
          actions={
            script ? (
              <button type="button" className="button quiet" onClick={() => void window.jacquelineEditor?.openAsset({ id, file: script })}>
                Edit
              </button>
            ) : null
          }
          hint="A .js file that draws over the character — sparks, rings, anything on a canvas — and hears when it speaks or is clicked. Sealed off: no internet, no files, no other characters. Saved changes show at once."
        />
        {script ? null : (
          <div>
            <button type="button" className="button quiet under-prose" disabled={scriptBusy} onClick={() => void startScript()}>
              Start one from a template
            </button>
          </div>
        )}
      </Group>
    </div>
  );
}
