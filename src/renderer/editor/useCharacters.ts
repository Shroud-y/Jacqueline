import { useCallback, useEffect, useState } from 'react';
import type { Character, CharacterEntry } from '@shared/character';
import type { EditorResult } from '@shared/types';

export interface Characters {
  /** Null until main has answered for the first time. */
  entries: CharacterEntry[] | null;
  /** The last thing main refused, in its own words; null once something has gone through since. */
  error: string | null;
  dismissError(): void;
  /** Saves the whole character as it should now be. */
  update(character: Character): void;
  create(name: string): Promise<Character | null>;
  duplicate(id: string): Promise<Character | null>;
  remove(id: string): Promise<boolean>;
  openFolder(id: string): void;
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

  useEffect(() => {
    const api = window.shardEditor;
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

  const settle = useCallback(<T extends object>(result: EditorResult<T>): result is { ok: true } & T => {
    // An empty error is a cancelled dialog: nothing happened and nothing needs saying.
    setError(result.ok || result.error === '' ? null : result.error);
    return result.ok;
  }, []);

  const update = useCallback(
    (character: Character): void => {
      // Shown at once, so typing does not wait on the disk; main's answer follows and wins.
      setEntries((current) =>
        current ? current.map((entry) => (entry.id === character.id ? { id: character.id, ok: true, character } : entry)) : current
      );
      void window.shardEditor?.save(character).then(async (result) => {
        if (settle(result)) return;
        // Refused: put back what main actually has.
        const list = await window.shardEditor?.list();
        if (list) setEntries(list);
      });
    },
    [settle]
  );

  const create = useCallback(
    async (name: string): Promise<Character | null> => {
      const result = await window.shardEditor?.create({ name });
      return result && settle(result) ? result.character : null;
    },
    [settle]
  );

  const duplicate = useCallback(
    async (id: string): Promise<Character | null> => {
      const result = await window.shardEditor?.duplicate({ id });
      return result && settle(result) ? result.character : null;
    },
    [settle]
  );

  const remove = useCallback(
    async (id: string): Promise<boolean> => {
      const result = await window.shardEditor?.remove({ id });
      return result ? settle(result) : false;
    },
    [settle]
  );

  const openFolder = useCallback(
    (id: string): void => {
      void window.shardEditor?.openFolder({ id }).then(settle);
    },
    [settle]
  );

  return { entries, error, dismissError: () => setError(null), update, create, duplicate, remove, openFolder };
}
