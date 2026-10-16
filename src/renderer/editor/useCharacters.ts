import { useCallback, useEffect, useState } from 'react';
import type { Character, CharacterEntry } from '@shared/character';
import type { EditorResult } from '@shared/types';

export interface Characters {
  /** Null until main has answered for the first time. */
  entries: CharacterEntry[] | null;
  /** The last thing main refused, in its own words; null once something has gone through since. */
  error: string | null;
  /** What did not happen, to lead the error with: "Not saved.", "Not imported." */
  errorLead: string;
  dismissError(): void;
  /** Saves the whole character as it should now be. */
  update(character: Character): void;
  /** The same, for when what comes next depends on whether it went through. */
  save(character: Character): Promise<boolean>;
  /** Shows a refusal that came from somewhere other than a save. */
  report(message: string): void;
  create(name: string): Promise<Character | null>;
  duplicate(id: string): Promise<Character | null>;
  remove(id: string): Promise<boolean>;
  openFolder(id: string): void;
  exportCharacter(id: string): void;
  /** From a dropped zip's path, or one the user picks. */
  importCharacter(path?: string): Promise<Character | null>;
}

/**
 * The characters, as main has them. There is no draft here: every edit is
 * saved at once and what comes back from main is what is shown, so the
 * editor, the tray and the character on screen can never disagree — and a
 * character dragged across the desktop while the editor is open is not put
 * back where the editor last saw it.
 */
export function useCharacters(): Characters {
  const [entries, setEntries] = useState<CharacterEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorLead, setErrorLead] = useState('Not saved.');

  useEffect(() => {
    const api = window.jacquelineEditor;
    if (!api) return;
    let cancelled = false;
    void api.list().then((list) => {
      if (!cancelled) setEntries(list);
    });
    const off = api.onChanged(setEntries);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  const settle = useCallback(<T extends object>(result: EditorResult<T>, lead = 'Not saved.'): result is { ok: true } & T => {
    // An empty error is a cancelled dialog: nothing happened and nothing needs saying.
    setError(result.ok || result.error === '' ? null : result.error);
    setErrorLead(lead);
    return result.ok;
  }, []);

  const update = useCallback(
    (character: Character): void => {
      // Shown at once, so typing does not wait on the disk; main's answer follows and wins.
      setEntries((current) =>
        current ? current.map((entry) => (entry.id === character.id ? { id: character.id, ok: true, character } : entry)) : current
      );
      void window.jacquelineEditor?.save(character).then(async (result) => {
        if (settle(result)) return;
        // Refused: put back what main actually has.
        const list = await window.jacquelineEditor?.list();
        if (list) setEntries(list);
      });
    },
    [settle]
  );

  const save = useCallback(
    async (character: Character): Promise<boolean> => {
      const result = await window.jacquelineEditor?.save(character);
      return result ? settle(result) : false;
    },
    [settle]
  );

  const create = useCallback(
    async (name: string): Promise<Character | null> => {
      const result = await window.jacquelineEditor?.create({ name });
      return result && settle(result) ? result.character : null;
    },
    [settle]
  );

  const duplicate = useCallback(
    async (id: string): Promise<Character | null> => {
      const result = await window.jacquelineEditor?.duplicate({ id });
      return result && settle(result) ? result.character : null;
    },
    [settle]
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await window.jacquelineEditor?.remove({ id });
      return result ? settle(result) : false;
    },
    [settle]
  );

  const openFolder = useCallback(
    (id: string): void => {
      void window.jacquelineEditor?.openFolder({ id }).then(settle);
    },
    [settle]
  );

  const exportCharacter = useCallback(
    (id: string): void => {
      void window.jacquelineEditor?.exportCharacter({ id }).then((result) => settle(result, 'Not exported.'));
    },
    [settle]
  );

  const importCharacter = useCallback(
    async (path?: string): Promise<Character | null> => {
      const result = await window.jacquelineEditor?.importCharacter(path ? { path } : {});
      return result && settle(result, 'Not imported.') ? result.character : null;
    },
    [settle]
  );

  const report = useCallback((message: string): void => {
    setError(message);
    setErrorLead('Not saved.');
  }, []);

  return {
    entries,
    error,
    errorLead,
    dismissError: () => setError(null),
    update,
    save,
    report,
    create,
    duplicate,
    remove,
    openFolder,
    exportCharacter,
    importCharacter
  };
}
