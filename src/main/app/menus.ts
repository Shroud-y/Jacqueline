/**
 * What the tray menu and a character's own menu say, as plain data. Electron
 * turns it into a menu in `tray.ts`; keeping it apart is what lets the wording
 * and the rules be tested without one.
 */

import type { Character, CharacterEntry } from '@shared/character';
import type { HideChoice } from '../characters/visibility';

export type MenuAction =
  | { type: 'setEnabled'; id: string; enabled: boolean }
  | { type: 'hide'; id: string; choice: HideChoice }
  | { type: 'show'; id: string }
  | { type: 'setEveryoneHidden'; hidden: boolean }
  | { type: 'setMuted'; muted: boolean }
  | { type: 'openEditor' }
  | { type: 'openCharactersFolder' }
  | { type: 'quit' };

export type MenuEntry =
  | { kind: 'separator' }
  | { kind: 'label'; label: string }
  | { kind: 'action'; label: string; action: MenuAction }
  | { kind: 'check'; label: string; checked: boolean; action: MenuAction };

export interface MenuState {
  everyoneHidden: boolean;
  muted: boolean;
  isSnoozed: (id: string) => boolean;
}

export function trayMenu(entries: readonly CharacterEntry[], state: MenuState): MenuEntry[] {
  const menu: MenuEntry[] = [{ kind: 'label', label: 'Jacqueline' }, { kind: 'separator' }];

  if (entries.length === 0) menu.push({ kind: 'label', label: 'No characters yet' });
  for (const entry of entries) {
    if (!entry.ok) {
      menu.push({ kind: 'label', label: `${entry.id} — cannot be read` });
      continue;
    }
    const { id, name, enabled } = entry.character;
    // Ticked means "on screen when its own rules say so". One that was
    // hidden for now is not, and a click is the way to bring it back.
    const snoozed = enabled && state.isSnoozed(id);
    menu.push({
      kind: 'check',
      label: snoozed ? `${name} — hidden for now` : name,
      checked: enabled && !snoozed,
      action: snoozed ? { type: 'show', id } : { type: 'setEnabled', id, enabled: !enabled }
    });
  }

  menu.push(
    { kind: 'separator' },
    {
      kind: 'check',
      label: 'Hide everyone',
      checked: state.everyoneHidden,
      action: { type: 'setEveryoneHidden', hidden: !state.everyoneHidden }
    },
    { kind: 'check', label: 'Mute', checked: state.muted, action: { type: 'setMuted', muted: !state.muted } },
    { kind: 'separator' },
    { kind: 'action', label: 'Characters…', action: { type: 'openEditor' } },
    { kind: 'action', label: 'Open characters folder', action: { type: 'openCharactersFolder' } },
    { kind: 'separator' },
    { kind: 'action', label: 'Quit', action: { type: 'quit' } }
  );
  return menu;
}

/** What a right-click on a character offers: ways to be rid of it, mildest first. */
export function characterMenu(character: Character): MenuEntry[] {
  const { id, name } = character;
  return [
    { kind: 'label', label: name },
    { kind: 'separator' },
    { kind: 'action', label: 'Hide for 30 minutes', action: { type: 'hide', id, choice: '30m' } },
    { kind: 'action', label: 'Hide until restart', action: { type: 'hide', id, choice: 'restart' } },
    { kind: 'action', label: 'Turn off', action: { type: 'setEnabled', id, enabled: false } },
    { kind: 'separator' },
    { kind: 'action', label: 'Hide everyone', action: { type: 'setEveryoneHidden', hidden: true } }
  ];
}

export function trayTooltip(state: Pick<MenuState, 'everyoneHidden'>): string {
  return state.everyoneHidden ? 'Jacqueline — everyone hidden' : 'Jacqueline';
}
