import { describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import { COALESCE_MS, EditHistory, HISTORY_MAX } from '@shared/editHistory';

const named = (name: string, id = 'c'): Character => ({ ...defaultCharacter(id, 'x'), name });

describe('EditHistory', () => {
  it('goes back step by step, and forward again', () => {
    const history = new EditHistory();
    history.record(named('A'), 0);
    history.record(named('B'), 5000);
    expect(history.undo(named('C'))?.name).toBe('B');
    expect(history.undo(named('B'))?.name).toBe('A');
    expect(history.undo(named('A'))).toBeNull();
    expect(history.redo(named('A'), 20_000)?.name).toBe('B');
    expect(history.redo(named('B'), 21_000)?.name).toBe('C');
    expect(history.redo(named('C'), 22_000)).toBeNull();
  });

  it('makes changes close together one step, from where they started', () => {
    const history = new EditHistory();
    history.record(named('A'), 0);
    history.record(named('A1'), COALESCE_MS / 2);
    history.record(named('A2'), COALESCE_MS);
    expect(history.undo(named('A3'))?.name).toBe('A');
    expect(history.canUndo('c')).toBe(false);
  });

  it('forgets what was undone once something new is changed', () => {
    const history = new EditHistory();
    history.record(named('A'), 0);
    history.undo(named('B'));
    expect(history.canRedo('c')).toBe(true);
    history.record(named('A'), 10_000);
    expect(history.canRedo('c')).toBe(false);
  });

  it('keeps each character apart, and only so many steps', () => {
    const history = new EditHistory();
    for (let i = 0; i < HISTORY_MAX + 10; i += 1) history.record(named(`${i}`), i * 10_000);
    history.record(named('other', 'd'), 0);
    let steps = 0;
    while (history.undo(named('now'))) steps += 1;
    expect(steps).toBe(HISTORY_MAX);
    expect(history.peekUndo('d')?.name).toBe('other');
  });

  it('shows the next step without taking it', () => {
    const history = new EditHistory();
    history.record(named('A'), 0);
    expect(history.peekUndo('c')?.name).toBe('A');
    expect(history.canUndo('c')).toBe(true);
    expect(history.peekRedo('c')).toBeNull();
  });
});
