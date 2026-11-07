/**
 * Game events: what Dota 2 tells Jacqueline about the match being played,
 * through Valve's own Game State Integration. Shared, because rules name these
 * events and the editor lists them. Dota 2 only for now; the names are kept
 * plain so another game with the same kind of integration (CS2) could reuse
 * them.
 */

import { z } from 'zod';

/** What a rule or a script can wait for. `streak` is a kill that takes the streak up to a number. */
export const GAME_EVENTS = ['won', 'lost', 'kill', 'death', 'streak'] as const;
export type GameEventName = (typeof GAME_EVENTS)[number];
export const gameEventSchema = z.enum(GAME_EVENTS);

/** What the desktop side actually reports; `streak` is worked out from `kill`. */
export type GameHappening = Exclude<GameEventName, 'streak'>;
export const GAME_HAPPENINGS: readonly GameHappening[] = ['won', 'lost', 'kill', 'death'];

export const STREAK_MIN = 2;
export const STREAK_MAX = 50;
export const DEFAULT_STREAK = 3;

/** The local port Dota is told to send to; any free one the user likes. */
export const GAME_PORT_MIN = 1024;
export const GAME_PORT_MAX = 65535;
export const gamePortSchema = z.number().int().min(GAME_PORT_MIN).max(GAME_PORT_MAX);
/** Dota sends this back with every update; anything without it is not Dota talking. */
export const gameTokenSchema = z.string().regex(/^[A-Za-z0-9]{0,64}$/);

/** "npc_dota_hero_shadow_shaman" → "Shadow Shaman": what a line's `{hero}` reads. */
export function heroName(internal: string): string {
  return internal
    .replace(/^npc_dota_hero_/, '')
    .split('_')
    .filter((word) => word !== '')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}
