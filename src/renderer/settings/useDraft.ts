import { useCallback, useEffect, useRef, useState, type KeyboardEvent } from 'react';

export interface DraftOptions<T> {
  /** The stored value. */
  value: T;
  /** How the stored value reads in the field. */
  format: (value: T) => string;
  /**
   * Turns what was typed into a value, or says why it cannot be one. Runs on
   * commit only — never on a keystroke, so "23:0" on the way to "23:05" is
   * not an error.
   */
  parse: (text: string) => { ok: true; value: T } | { ok: false; error: string };
  /** Saves the value. Resolves with an error message if it was refused. */
  commit: (value: T) => Promise<string | null>;
  /** Treats two values as the same, so committing an unchanged field does nothing. */
  equals?: (a: T, b: T) => boolean;
}

export interface Draft {
  text: string;
  error: string | null;
  /** True between Enter/blur and the answer. */
  busy: boolean;
  /** True when the text differs from the stored value. */
  dirty: boolean;
  setText: (text: string) => void;
  /** For `onBlur`. */
  commit: () => void;
  /** For `onKeyDown`: Enter commits, Escape puts the stored value back. */
  onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => void;
}

/**
 * A text field that is edited freely and saved on purpose.
 *
 * The settings used to be written on every keystroke, which is why a time
 * could not be typed at all: "23:0" is not a time, so it was refused, and the
 * field snapped back before the next digit arrived. Here the field holds its
 * own text; blur or Enter commits it, Escape abandons it, and a refusal
 * leaves the text where it is with the reason underneath, so it can be fixed
 * rather than retyped.
 *
 * A change from outside — the tray, a reset — replaces the text unless the
 * user is in the middle of typing something different.
 */
export function useDraft<T>({ value, format, parse, commit, equals = Object.is }: DraftOptions<T>): Draft {
  const stored = format(value);
  const [text, setTextState] = useState(stored);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lastStored = useRef(stored);
  const editing = useRef(false);

  useEffect(() => {
    if (stored === lastStored.current) return;
    lastStored.current = stored;
    if (!editing.current) {
      setTextState(stored);
      setError(null);
    }
  }, [stored]);

  const setText = useCallback((next: string): void => {
    editing.current = true;
    setTextState(next);
    // The message described the previous attempt; it is stale the moment the
    // text changes, and re-checking mid-word would only be noise.
    setError(null);
  }, []);

  const revert = useCallback((): void => {
    editing.current = false;
    setTextState(lastStored.current);
    setError(null);
  }, []);

  const doCommit = useCallback((): void => {
    if (busy) return;
    const parsed = parse(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (equals(parsed.value, value)) {
      // Nothing to save; tidy the text to its canonical form.
      revert();
      return;
    }
    setBusy(true);
    void commit(parsed.value)
      .then((refusal) => {
        if (refusal) {
          setError(refusal);
          return;
        }
        editing.current = false;
        setError(null);
      })
      .finally(() => setBusy(false));
  }, [busy, commit, equals, parse, revert, text, value]);

  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Enter') {
        event.preventDefault();
        doCommit();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        revert();
      }
    },
    [doCommit, revert]
  );

  return { text, error, busy, dirty: text !== stored, setText, commit: doCommit, onKeyDown };
}
