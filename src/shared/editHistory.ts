/**
 * Undo and redo for the editor, which has no Save button: every change is
 * saved at once, so the only way back is to save what was there before.
 * Pure, so it is tested without a window.
 *
 * One history per character. Changes that come close together — a slider
 * being dragged, saving as it goes — are one step, the way a hand meant them.
 */

import type { Character } from './character';

/** Changes this close together are one step. */
export const COALESCE_MS = 1000;
export const HISTORY_MAX = 50;

interface Past {
  character: Character;
  at: number;
}

export class EditHistory {
  private readonly past = new Map<string, Past[]>();
  private readonly future = new Map<string, Character[]>();

  /** `before` is about to be replaced by an edit at `at`. A new edit forgets what was undone. */
  record(before: Character, at: number): void {
    const past = this.past.get(before.id) ?? [];
    const last = past.at(-1);
    // Part of the step still being made: keep where that step started from.
    if (last && at - last.at < COALESCE_MS) last.at = at;
    else past.push({ character: before, at });
    while (past.length > HISTORY_MAX) past.shift();
    this.past.set(before.id, past);
    this.future.delete(before.id);
  }

  canUndo(id: string): boolean {
    return (this.past.get(id)?.length ?? 0) > 0;
  }

  canRedo(id: string): boolean {
    return (this.future.get(id)?.length ?? 0) > 0;
  }

  /** What to go back to from `current`; null when there is nothing before it. */
  undo(current: Character): Character | null {
    const step = this.past.get(current.id)?.pop();
    if (!step) return null;
    this.future.set(current.id, [...(this.future.get(current.id) ?? []), current]);
    return step.character;
  }

  /** What to go forward to again; null when nothing was undone. */
  redo(current: Character, at: number): Character | null {
    const next = this.future.get(current.id)?.pop();
    if (!next) return null;
    // Not coalesced with whatever came before: an undone step comes back whole.
    const past = this.past.get(current.id) ?? [];
    past.push({ character: current, at: at - COALESCE_MS });
    this.past.set(current.id, past);
    return next;
  }

  /** What undo would go back to, without going: to check it can be saved first. */
  peekUndo(id: string): Character | null {
    return this.past.get(id)?.at(-1)?.character ?? null;
  }

  peekRedo(id: string): Character | null {
    return this.future.get(id)?.at(-1) ?? null;
  }

  forget(id: string): void {
    this.past.delete(id);
    this.future.delete(id);
  }
}
