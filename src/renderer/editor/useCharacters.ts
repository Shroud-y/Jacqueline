import { useCallback, useEffect, useRef, useState } from 'react';
import { referencedAssets, type Character, type CharacterEntry } from '@shared/character';
import { EditHistory } from '@shared/editHistory';
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
  /** Puts the character back as it was before the last change, or forward again; false when there is no step. */
  undo(id: string): Promise<boolean>;
  redo(id: string): Promise<boolean>;
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

  const history = useRef(new EditHistory());
  // What main last had for each character: what an edit replaces, and so what undo goes back to.
  const latest = useRef(new Map<string, Character>());
  useEffect(() => {
    latest.current = new Map((entries ?? []).flatMap((entry) => (entry.ok ? [[entry.id, entry.character] as const] : [])));
  }, [entries]);

  const remember = (character: Character): void => {
    const before = latest.current.get(character.id);
    if (before && before !== character) history.current.record(before, Date.now());
    latest.current.set(character.id, character);
  };

  const update = useCallback(
    (character: Character): void => {
      remember(character);
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
      remember(character);
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

  const step = useCallback(
    async (id: string, direction: 'undo' | 'redo'): Promise<boolean> => {
      const api = window.jacquelineEditor;
      const current = latest.current.get(id);
      const target = direction === 'undo' ? history.current.peekUndo(id) : history.current.peekRedo(id);
      if (!api || !current || !target) return false;
      // A file let go of since is gone from the folder: going back to it would show nothing.
      const files = new Set((await api.assets({ id })).map((asset) => asset.file));
      const missing = [...referencedAssets(target)].filter((file) => !files.has(file));
      if (missing.length > 0) {
        setError(`It used ${missing.join(', ')}, which has since been removed from its folder.`);
        setErrorLead(direction === 'undo' ? 'Cannot undo.' : 'Cannot redo.');
        history.current.forget(id);
        return false;
      }
      if (direction === 'undo') history.current.undo(current);
      else history.current.redo(current, Date.now());
      // Where it sits on the desktop is not an edit made here: dragging it is not undone.
      const next = { ...target, presence: { ...target.presence, position: current.presence.position } };
      latest.current.set(id, next);
      setEntries((list) => (list ? list.map((entry) => (entry.id === id ? { id, ok: true, character: next } : entry)) : list));
      const result = await api.save(next);
      return settle(result);
    },
    [settle]
  );

  const undo = useCallback((id: string) => step(id, 'undo'), [step]);
  const redo = useCallback((id: string) => step(id, 'redo'), [step]);

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
    importCharacter,
    undo,
    redo
  };
}
