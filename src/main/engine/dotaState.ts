/**
 * Dota 2's game state, as Game State Integration posts it, turned into the few
 * things a rule cares about. Dota sends the whole state again every half
 * second or so; this remembers the last one and reports only what changed —
 * each win or loss once per match. Pure: no sockets, no clock.
 */

import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import type { GameHappening } from '@shared/game';

const DOTA_APP_ID = 570;
const POST_GAME = 'DOTA_GAMERULES_STATE_POST_GAME';
const count = z.number().int().min(0).max(100_000);
const word = z.string().max(128);

/**
 * Only the parts read here; everything else Dota sends is dropped. Every part
 * may be missing: in the menus there is no map, while watching someone else
 * there is no player of one's own.
 */
export const dotaPayloadSchema = z.object({
  provider: z.object({ appid: z.number().int() }).partial().optional(),
  map: z.object({ matchid: word, game_state: word, win_team: word }).partial().optional(),
  player: z.object({ team_name: word, kills: count, deaths: count, kill_streak: count }).partial().optional(),
  hero: z.object({ name: word }).partial().optional(),
  auth: z.object({ token: z.string().max(256) }).partial().optional()
});
export type DotaPayload = z.infer<typeof dotaPayloadSchema>;

/** One thing that happened in a match. */
export interface DotaEvent {
  event: GameHappening;
  /** Internal name, `npc_dota_hero_axe`; null when Dota did not say. */
  hero: string | null;
  kills: number;
  deaths: number;
  /** Kills in a row now, and before this update: a streak rule fires when its number is crossed. */
  streak: number;
  streakBefore: number;
}

/** Whether a payload carries the token Dota was given. Constant time, so it cannot be guessed a letter at a time. */
export function tokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string' || expected === '') return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

interface Match {
  id: string;
  state: string;
  kills: number;
  deaths: number;
  streak: number;
}

/** How many finished matches are remembered, so a reconnect to the results screen does not cheer twice. */
const FINISHED_KEPT = 32;

export class DotaTracker {
  private match: Match | null = null;
  private readonly finished: string[] = [];

  /** What changed since the last update. The first look at a match is only a baseline. */
  update(payload: DotaPayload): DotaEvent[] {
    if (payload.provider?.appid !== undefined && payload.provider.appid !== DOTA_APP_ID) return [];
    const { map, player, hero } = payload;
    const id = map?.matchid;
    const team = player?.team_name;
    // In the menus, or watching a match that is not one's own: nothing happens to the player.
    if (!id || id === '0' || !map?.game_state || (team !== 'radiant' && team !== 'dire')) return [];

    // A count Dota left out this time stays what it was, so its return is not a jump.
    const before = this.match?.id === id ? this.match : null;
    const now: Match = {
      id,
      state: map.game_state,
      kills: player?.kills ?? before?.kills ?? 0,
      deaths: player?.deaths ?? before?.deaths ?? 0,
      streak: player?.kill_streak ?? before?.streak ?? 0
    };
    this.match = now;
    if (!before) {
      // First seen already over (Jacqueline started on the results screen): nothing to cheer about.
      if (now.state === POST_GAME) this.finish(id);
      return [];
    }

    const base = { hero: hero?.name ?? null, kills: now.kills, deaths: now.deaths, streak: now.streak };
    const events: DotaEvent[] = [];
    if (now.kills > before.kills) events.push({ event: 'kill', ...base, streakBefore: before.streak });
    if (now.deaths > before.deaths) events.push({ event: 'death', ...base, streakBefore: before.streak });
    if (now.state === POST_GAME && before.state !== POST_GAME && !this.finished.includes(id)) {
      this.finish(id);
      const winner = map.win_team;
      if (winner === 'radiant' || winner === 'dire') events.push({ event: winner === team ? 'won' : 'lost', ...base, streakBefore: before.streak });
    }
    return events;
  }

  private finish(id: string): void {
    if (this.finished.includes(id)) return;
    this.finished.push(id);
    if (this.finished.length > FINISHED_KEPT) this.finished.shift();
  }
}
