import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanionStatus, Settings, SettingsResult } from '@shared/types';

export type Patch = (change: Partial<Settings>) => Promise<SettingsResult>;

export interface SettingsModel {
  /** Null until the first load answers — or for good, if it fails. */
  settings: Settings | null;
  /** Set when the window could not get its settings at all. */
  loadError: string | null;
  retry: () => void;
  /**
   * Applies a change. The new value shows at once; the promise says whether
   * it was accepted, so the control that asked can show the reason if not.
   */
  patch: Patch;
  /** Everything back to stock except the characters. */
  reset: () => Promise<SettingsResult>;
  /**
   * A change that was accepted but could not be written to disk. Not tied to
   * any one control — it is true of the whole window until a save succeeds.
   */
  saveError: string | null;
}

const UNAVAILABLE = 'The settings window is not connected to SHARD.';

/**
 * The window's one copy of the settings, and the only way they are changed.
 *
 * Changes are optimistic: the control moves the moment it is touched and the
 * answer from the app confirms or corrects it. Answers can come back out of
 * order — a slow one for an earlier change must not undo a later one — so only
 * the answer to the most recent request is applied. Pushes from the app (the
 * tray changing something while this window is open) are always applied: they
 * are the truth, in order.
 */
export function useSettings(): SettingsModel {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const latest = useRef(0);
  const current = useRef<Settings | null>(null);

  const adopt = useCallback((next: Settings): void => {
    current.current = next;
    setSettings(next);
  }, []);

  useEffect(() => {
    const api = window.codexPanel;
    if (!api) {
      setLoadError(UNAVAILABLE);
      return;
    }
    let cancelled = false;
    setLoadError(null);
    api
      .getSettings()
      .then((loaded) => {
        if (!cancelled) adopt(loaded);
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : String(err));
      });
    const off = api.onSettingsUpdated((pushed) => {
      // A push supersedes whatever request is still in flight.
      latest.current += 1;
      adopt(pushed);
    });
    return () => {
      cancelled = true;
      off();
    };
  }, [adopt, attempt]);

  const settle = useCallback(
    (request: number, result: SettingsResult): SettingsResult => {
      if (request === latest.current) adopt(result.settings);
      // "Accepted but not saved" comes back as a failure whose settings
      // nonetheless carry the change; a refusal leaves them as they were.
      if (result.ok) setSaveError(null);
      else if (/could not be saved/i.test(result.error)) setSaveError(result.error);
      return result;
    },
    [adopt]
  );

  const fail = (request: number, err: unknown): SettingsResult => {
    const before = current.current;
    const error = err instanceof Error ? err.message : String(err);
    // Nothing came back, so the optimistic value is a guess: ask again.
    if (request === latest.current) setAttempt((n) => n + 1);
    return { ok: false, settings: before as Settings, error };
  };

  const patch = useCallback<Patch>(
    async (change) => {
      const api = window.codexPanel;
      const before = current.current;
      if (!api || !before) return { ok: false, settings: before as Settings, error: UNAVAILABLE };

      const request = (latest.current += 1);
      adopt({ ...before, ...change });
      try {
        return settle(request, await api.setSettings(change));
      } catch (err) {
        return fail(request, err);
      }
    },
    // `fail` only touches refs and stable setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [adopt, settle]
  );

  const reset = useCallback(async (): Promise<SettingsResult> => {
    const api = window.codexPanel;
    const before = current.current;
    if (!api || !before) return { ok: false, settings: before as Settings, error: UNAVAILABLE };
    const request = (latest.current += 1);
    try {
      return settle(request, await api.resetSettings());
    } catch (err) {
      return fail(request, err);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settle]);

  return {
    settings,
    loadError,
    retry: () => setAttempt((n) => n + 1),
    patch,
    reset,
    saveError
  };
}

/** What the character is doing right now, kept live. Null until the first answer. */
export function useStatus(): CompanionStatus | null {
  const [status, setStatus] = useState<CompanionStatus | null>(null);

  useEffect(() => {
    const api = window.codexPanel;
    if (!api) return;
    let cancelled = false;
    void api
      .getStatus()
      .then((loaded) => {
        if (!cancelled) setStatus(loaded);
      })
      .catch(() => {
        /* The status line is an extra; the window works without it. */
      });
    const off = api.onStatusUpdated(setStatus);
    return () => {
      cancelled = true;
      off();
    };
  }, []);

  return status;
}
