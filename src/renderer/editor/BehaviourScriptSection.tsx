import { useEffect, useState } from 'react';
import type { Character } from '@shared/character';
import { assetUrl } from '@shared/assetUrl';
import type { ScriptStatus } from '@shared/types';
import FileSlot from './FileSlot';
import { Group, Notice } from './fields';
import type { Characters } from './useCharacters';

/** The character's behaviour script: its file, whether it may run, and how it is doing. */
export default function BehaviourScriptSection({ character, characters }: { character: Character; characters: Characters }): JSX.Element {
  const { id, behaviourScript: script } = character;
  const [busy, setBusy] = useState(false);
  // Null while not known yet; false for a script that came with an imported character.
  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [status, setStatus] = useState<ScriptStatus | null>(null);

  useEffect(() => {
    const api = window.jacquelineEditor;
    if (!api) return;
    let cancelled = false;
    void api.scriptAllowed({ id }).then((value) => !cancelled && setAllowed(value));
    void api.scriptStatus({ id }).then((value) => !cancelled && setStatus(value));
    const off = api.onScriptStatus((update) => {
      if (update.id === id) setStatus(update.status);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [id, script]);

  /** A script put to use; the one it had goes once nothing points at it. */
  const apply = async (file: string | null): Promise<boolean> => {
    const old = character.behaviourScript;
    if (!(await characters.save({ ...character, behaviourScript: file }))) return false;
    if (old && old !== file) await window.jacquelineEditor?.releaseAsset({ id, file: old });
    return true;
  };

  /** Chosen or written here: the user's own, so it may run. */
  const allow = async (): Promise<void> => {
    const result = await window.jacquelineEditor?.allowScript({ id });
    if (result?.ok) setAllowed(true);
  };

  const choose = async (path?: string): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setBusy(true);
    try {
      const imported = await api.importAsset({ id, kinds: ['script'], ...(path ? { path } : {}) });
      if (!imported.ok) {
        if (imported.error) characters.report(imported.error);
        return;
      }
      if (await apply(imported.file)) await allow();
      else await api.releaseAsset({ id, file: imported.file });
    } finally {
      setBusy(false);
    }
  };

  const start = async (): Promise<void> => {
    const api = window.jacquelineEditor;
    if (!api) return;
    setBusy(true);
    try {
      const made = await api.newScript({ id, kind: 'behaviour' });
      if (!made.ok) {
        characters.report(made.error);
        return;
      }
      if (await apply(made.file)) {
        await allow();
        await api.openAsset({ id, file: made.file });
      } else {
        await api.releaseAsset({ id, file: made.file });
      }
    } finally {
      setBusy(false);
    }
  };

  const restart = (): void => void window.jacquelineEditor?.restartScript({ id });

  return (
    <Group title="Script">
      {script && allowed === false ? (
        <div className="script-blocked">
          <Notice kind="warn">
            This script came with an imported character and does not run until you allow it. It cannot reach the internet, your files or other characters
            — but read it first: Edit opens it.
          </Notice>
          <button type="button" className="button" onClick={() => void allow()}>
            Allow it to run
          </button>
        </div>
      ) : null}
      <FileSlot
        label="Behaviour script"
        file={script ? { name: script, url: assetUrl(id, script), kind: 'script', bytes: null } : null}
        kinds={['script']}
        busy={busy}
        onChoose={(path) => void choose(path)}
        onRemove={() => void apply(null)}
        actions={
          script ? (
            <>
              <button type="button" className="button quiet" onClick={() => void window.jacquelineEditor?.openAsset({ id, file: script })}>
                Edit
              </button>
              {status ? (
                <button type="button" className="button quiet" onClick={restart}>
                  Restart
                </button>
              ) : null}
            </>
          ) : null
        }
        hint="A .js file with logic of its own, next to the rules: it hears programs, clicks, time and its own lines, and says, shows, hides and remembers. Sandboxed; saved changes start it again at once."
      />
      {script && status ? (
        status.error ? (
          <Notice kind="bad" lead={status.running ? 'Script error.' : 'Script stopped.'}>
            {status.error}
          </Notice>
        ) : (
          <div className="prose quiet-prose">Running.</div>
        )
      ) : script && allowed && !character.enabled ? (
        <div className="prose quiet-prose">Not running while the character is off.</div>
      ) : null}
      {script ? null : (
        <div>
          <button type="button" className="button quiet under-prose" disabled={busy} onClick={() => void start()}>
            Start one from a template
          </button>
        </div>
      )}
    </Group>
  );
}
