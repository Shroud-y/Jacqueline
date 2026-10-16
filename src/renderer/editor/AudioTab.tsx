import { useCallback, useEffect, useRef, useState } from 'react';
import type { AssetKind, Character } from '@shared/character';
import { assetUrl } from '@shared/assetUrl';
import type { AssetInfo } from '@shared/types';
import FileSlot, { type SlotFile } from './FileSlot';
import { Field, Group, Slider } from './fields';
import type { Characters } from './useCharacters';

type Entry = 'appear' | 'disappear';

const SOUND_KINDS: AssetKind[] = ['audio'];

/** How loud the character is, and what it sounds like coming and going. */
export default function AudioTab({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const { id, audio } = character;
  const [assets, setAssets] = useState<AssetInfo[] | null>(null);
  const [busy, setBusy] = useState<Entry | null>(null);
  const playing = useRef<HTMLAudioElement | null>(null);

  const loadAssets = useCallback((): void => {
    void window.shardEditor?.assets({ id }).then(setAssets);
  }, [id]);
  useEffect(loadAssets, [loadAssets]);

  // Leaving the tab stops whatever is being listened to.
  useEffect(() => () => playing.current?.pause(), []);

  const slotFile = (file: string | null): SlotFile | null => {
    if (!file) return null;
    const info = assets?.find((entry) => entry.file === file);
    return { name: file, url: assetUrl(id, file), kind: 'audio', bytes: info?.bytes ?? null };
  };

  /** Heard here, at the character's volume: what it will sound like on the desktop. */
  const play = (file: string): void => {
    playing.current?.pause();
    const sound = new Audio(assetUrl(id, file));
    sound.volume = audio.volume;
    playing.current = sound;
    void sound.play().catch(() => undefined);
  };

  const choose = async (entry: Entry, path?: string): Promise<void> => {
    const api = window.shardEditor;
    if (!api) return;
    setBusy(entry);
    try {
      const imported = await api.importAsset({ id, kinds: SOUND_KINDS, ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      const old = audio[entry];
      if (await characters.save({ ...character, audio: { ...audio, [entry]: imported.file } })) {
        if (old && old !== imported.file) await api.releaseAsset({ id, file: old });
      } else {
        await api.releaseAsset({ id, file: imported.file });
      }
      loadAssets();
    } finally {
      setBusy(null);
    }
  };

  const remove = async (entry: Entry): Promise<void> => {
    const old = audio[entry];
    if (!(await characters.save({ ...character, audio: { ...audio, [entry]: null } }))) return;
    if (old) await window.shardEditor?.releaseAsset({ id, file: old });
    loadAssets();
  };

  const slot = (entry: Entry, label: string, hint: string): JSX.Element => {
    const file = audio[entry];
    return (
      <FileSlot
        label={label}
        hint={hint}
        file={slotFile(file)}
        kinds={SOUND_KINDS}
        // One at a time: each save starts from the character as it was before it.
        busy={busy !== null}
        onChoose={(path) => void choose(entry, path)}
        onRemove={() => void remove(entry)}
        actions={
          file ? (
            <button type="button" className="button quiet" onClick={() => play(file)}>
              Play
            </button>
          ) : null
        }
      />
    );
  };

  return (
    <div className="form">
      <Group title="Volume">
        <Field hint="For every sound the character makes: its lines, its rules, its coming and going.">
          <Slider
            label="Volume"
            value={Math.round(audio.volume * 100)}
            min={0}
            max={100}
            unit="%"
            onCommit={(percent) => characters.update({ ...character, audio: { ...audio, volume: percent / 100 } })}
          />
        </Field>
      </Group>

      <Group title="Coming and going">
        <div className="slots">
          {slot('appear', 'Appear', 'Plays as it comes on screen.')}
          {slot('disappear', 'Disappear', 'Plays as it leaves.')}
        </div>
        <div className="prose quiet-prose">
          Neither plays while everyone is muted or in quiet hours, more than once in 10 seconds, or while it is out only to be laid out.
        </div>
      </Group>
    </div>
  );
}
