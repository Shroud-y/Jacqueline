import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultCharacter, type CharacterEntry } from '@shared/character';
import { characterMenu, trayMenu, trayTooltip, type MenuEntry, type MenuState } from '@main/app/menus';
import { Visibility } from '@main/characters/visibility';

const MINUTE = 60_000;

describe('Visibility', () => {
  beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
  afterEach(() => vi.useRealTimers());

  it('hides nobody to begin with', () => {
    const visibility = new Visibility();
    expect(visibility.isHidden('a')).toBe(false);
    expect(visibility.everyoneHidden).toBe(false);
  });

  it('hides one character for half an hour and brings it back by itself', () => {
    const visibility = new Visibility();
    let changes = 0;
    visibility.onChange(() => (changes += 1));

    visibility.hide('a', '30m');
    expect(visibility.isHidden('a')).toBe(true);
    expect(visibility.isHidden('b')).toBe(false);
    expect(changes).toBe(1);

    vi.advanceTimersByTime(29 * MINUTE);
    expect(visibility.isHidden('a')).toBe(true);
    expect(changes).toBe(1);

    vi.advanceTimersByTime(2 * MINUTE);
    expect(visibility.isHidden('a')).toBe(false);
    // Whoever draws the characters has to be told, or it would stay hidden until something else changed.
    expect(changes).toBe(2);
  });

  it('keeps one hidden until restart for as long as it runs', () => {
    const visibility = new Visibility();
    visibility.hide('a', 'restart');
    vi.advanceTimersByTime(48 * 60 * MINUTE);
    expect(visibility.isSnoozed('a')).toBe(true);
    visibility.show('a');
    expect(visibility.isSnoozed('a')).toBe(false);
  });

  it('wakes for whoever is due first when several are hidden', () => {
    const visibility = new Visibility();
    let changes = 0;
    visibility.hide('forever', 'restart');
    visibility.hide('a', '30m');
    vi.advanceTimersByTime(10 * MINUTE);
    visibility.hide('b', '30m');
    visibility.onChange(() => (changes += 1));

    vi.advanceTimersByTime(21 * MINUTE);
    expect([visibility.isHidden('a'), visibility.isHidden('b')]).toEqual([false, true]);
    expect(changes).toBe(1);
    vi.advanceTimersByTime(10 * MINUTE);
    expect(visibility.isHidden('b')).toBe(false);
    expect(changes).toBe(2);
    expect(visibility.isHidden('forever')).toBe(true);
  });

  it('hides everyone at once without forgetting who was hidden on their own', () => {
    const visibility = new Visibility();
    visibility.hide('a', 'restart');
    visibility.toggleEveryone();
    expect([visibility.isHidden('a'), visibility.isHidden('b')]).toEqual([true, true]);
    visibility.toggleEveryone();
    expect([visibility.isHidden('a'), visibility.isHidden('b')]).toEqual([true, false]);
  });

  it('says nothing when asked for what is already so', () => {
    const visibility = new Visibility();
    let changes = 0;
    visibility.onChange(() => (changes += 1));
    visibility.setEveryoneHidden(false);
    visibility.show('never-hidden');
    expect(changes).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

const state = (over: Partial<MenuState> = {}): MenuState => ({
  everyoneHidden: false,
  muted: false,
  isSnoozed: () => false,
  ...over
});

const ok = (id: string, name: string, enabled = true): CharacterEntry => ({
  id,
  ok: true,
  character: { ...defaultCharacter(id, name), enabled }
});

const find = (menu: MenuEntry[], label: string): MenuEntry | undefined =>
  menu.find((entry) => entry.kind !== 'separator' && entry.label === label);

describe('trayMenu', () => {
  it('says so when there is nobody', () => {
    expect(find(trayMenu([], state()), 'No characters yet')).toEqual({ kind: 'label', label: 'No characters yet' });
  });

  it('lists every character with a tick that switches it', () => {
    const menu = trayMenu([ok('a', 'Miku'), ok('b', 'Rin', false)], state());
    expect(find(menu, 'Miku')).toEqual({
      kind: 'check',
      label: 'Miku',
      checked: true,
      action: { type: 'setEnabled', id: 'a', enabled: false }
    });
    expect(find(menu, 'Rin')).toMatchObject({ checked: false, action: { type: 'setEnabled', id: 'b', enabled: true } });
  });

  it('shows one hidden for now as unticked, and a click brings it back rather than switching it off', () => {
    const menu = trayMenu([ok('a', 'Miku')], state({ isSnoozed: (id) => id === 'a' }));
    expect(find(menu, 'Miku — hidden for now')).toMatchObject({ checked: false, action: { type: 'show', id: 'a' } });
  });

  it('does not call a switched-off character hidden for now', () => {
    const menu = trayMenu([ok('a', 'Miku', false)], state({ isSnoozed: () => true }));
    expect(find(menu, 'Miku')).toMatchObject({ action: { type: 'setEnabled', id: 'a', enabled: true } });
  });

  it('keeps a character whose file is broken in sight, with nothing to click', () => {
    const menu = trayMenu([{ id: 'broken', ok: false, error: 'bad' }], state());
    expect(find(menu, 'broken — cannot be read')).toEqual({ kind: 'label', label: 'broken — cannot be read' });
  });

  it('reflects hide-everyone and mute, and offers the opposite', () => {
    const menu = trayMenu([], state({ everyoneHidden: true, muted: true }));
    expect(find(menu, 'Hide everyone')).toMatchObject({ checked: true, action: { type: 'setEveryoneHidden', hidden: false } });
    expect(find(menu, 'Mute')).toMatchObject({ checked: true, action: { type: 'setMuted', muted: false } });
    expect(trayTooltip({ everyoneHidden: true })).toBe('SHARD — everyone hidden');
  });

  it('always ends with a way out', () => {
    expect(trayMenu([], state()).at(-1)).toEqual({ kind: 'action', label: 'Quit', action: { type: 'quit' } });
  });
});

describe('characterMenu', () => {
  it('offers to hide it, switch it off, or hide everyone — and acts on that character', () => {
    const menu = characterMenu(defaultCharacter('a', 'Miku'));
    expect(menu[0]).toEqual({ kind: 'label', label: 'Miku' });
    expect(menu.flatMap((entry) => (entry.kind === 'action' ? [entry.action] : []))).toEqual([
      { type: 'hide', id: 'a', choice: '30m' },
      { type: 'hide', id: 'a', choice: 'restart' },
      { type: 'setEnabled', id: 'a', enabled: false },
      { type: 'setEveryoneHidden', hidden: true }
    ]);
  });
});
