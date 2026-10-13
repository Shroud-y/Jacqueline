/**
 * Whether a character should be on screen right now. Pure: what the machine
 * is doing is passed in as facts, so every rule here is testable without it.
 */

import type { Character } from '@shared/character';
import { pointInRect, type Rect } from '@shared/layout';

/** What is known about the desktop at this moment. */
export interface DesktopFacts {
  /** Stems of every running executable; null when nobody has asked for them. */
  running: ReadonlySet<string> | null;
  /** Stem of the executable whose window is in front; null when unknown. */
  focused: string | null;
  /** The display a fullscreen application has taken, in screen coordinates; null when none has. */
  fullscreen: Rect | null;
}

/** Which facts a set of characters actually needs — nothing else is watched. */
export interface PresenceNeeds {
  running: boolean;
  focused: boolean;
  fullscreen: boolean;
}

/** 'Dota2.exe' and 'dota2' are the same executable. */
export function appStem(name: string): string {
  const lower = name.trim().toLowerCase();
  return lower.endsWith('.exe') ? lower.slice(0, -'.exe'.length) : lower;
}

export function presenceNeeds(characters: readonly Character[]): PresenceNeeds {
  const needs: PresenceNeeds = { running: false, focused: false, fullscreen: false };
  for (const character of characters) {
    if (!character.enabled) continue;
    const { mode, hideOnFullscreen } = character.presence;
    if (mode === 'whileRunning') needs.running = true;
    if (mode === 'whileFocused') needs.focused = true;
    // Only worth knowing for a character that could be on screen to hide.
    if (hideOnFullscreen && mode !== 'onSpeech') needs.fullscreen = true;
  }
  return needs;
}

/**
 * `anchor` is where the character itself sits on screen: a fullscreen
 * application only hides the characters on the display it has taken.
 */
export function isPresent(character: Character, facts: DesktopFacts, anchor: Rect): boolean {
  if (!character.enabled) return false;
  const { mode, apps, hideOnFullscreen } = character.presence;

  if (hideOnFullscreen && facts.fullscreen) {
    const centre = { x: anchor.x + anchor.width / 2, y: anchor.y + anchor.height / 2 };
    if (pointInRect(centre, facts.fullscreen)) return false;
  }

  switch (mode) {
    case 'always':
      return true;
    case 'whileRunning': {
      const running = facts.running;
      return running !== null && apps.some((app) => running.has(appStem(app)));
    }
    case 'whileFocused':
      return facts.focused !== null && apps.some((app) => appStem(app) === facts.focused);
    case 'onSpeech':
      // It comes out to say something, and nothing can make it speak yet.
      return false;
  }
}
