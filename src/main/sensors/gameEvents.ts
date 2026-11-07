/**
 * Game events as the rule runner asks for them: the local listener Dota posts
 * to, opened only when the user has switched game events on and some rule or
 * script waits for one. Keeps a status the Settings pane shows.
 */

import { randomBytes, randomInt } from 'node:crypto';
import type { GameStatus, GameEventsSettings } from '@shared/types';
import { createLogger } from '../app/logger';
import { DotaTracker } from '../engine/dotaState';
import type { RuleEvent } from '../engine/ruleEngine';
import { dotaDirFrom, findDotaDir, writeCfg } from './dotaSetup';
import { startGsiListener, type GsiListener } from './gsiListener';

const log = createLogger('game');

export type GameRuleEvent = Extract<RuleEvent, { type: 'game' }>;

export interface GameEventsDeps {
  settings: () => GameEventsSettings;
  onStatus: (status: GameStatus) => void;
  now?: () => number;
}

/** A token Dota sends back, and a port away from the usual development ones. */
export function newGameIdentity(): { port: number; token: string } {
  return { port: randomInt(40_000, 60_000), token: randomBytes(24).toString('hex') };
}

export class GameEvents {
  private listener: GsiListener | null = null;
  private current: GameStatus = { state: 'off', error: null, heardAt: null };
  private readonly now: () => number;

  constructor(private readonly deps: GameEventsDeps) {
    this.now = deps.now ?? Date.now;
    this.current = this.resting();
  }

  get status(): GameStatus {
    return this.current;
  }

  /** The settings changed: what the status says while nothing listens may have too. */
  settingsChanged(): void {
    if (!this.listener) this.set(this.resting());
  }

  /** Opens the listener, if the user allows it; what it returns closes it again. */
  watch(onEvent: (event: GameRuleEvent) => void): () => void {
    const { enabled, port, token } = this.deps.settings();
    if (!enabled || token === '') {
      this.set(this.resting());
      return () => undefined;
    }
    const tracker = new DotaTracker();
    let heard = false;
    const listener = startGsiListener({
      port,
      token,
      onListening: (at) => {
        log.info(`listening for Dota 2 on 127.0.0.1:${at}`);
        if (this.listener === listener) this.set({ state: 'listening', error: null, heardAt: null });
      },
      onError: (message) => {
        log.warn(`game events: ${message}`);
        if (this.listener === listener) this.set({ state: 'failed', error: message, heardAt: null });
      },
      onPayload: (payload) => {
        if (this.listener !== listener) return;
        // Told once per listening, not every half second: the pane only needs to know Dota got through.
        if (!heard) {
          heard = true;
          log.info('Dota 2 is talking');
          this.set({ ...this.current, heardAt: this.now() });
        } else this.current = { ...this.current, heardAt: this.now() };
        for (const event of tracker.update(payload)) onEvent({ type: 'game', ...event });
      }
    });
    this.listener = listener;
    return () => {
      if (this.listener !== listener) return;
      listener.close();
      this.listener = null;
      log.info('stopped listening for Dota 2');
      this.set(this.resting());
    };
  }

  /** What the status is while nothing listens. */
  private resting(): GameStatus {
    return { state: this.deps.settings().enabled ? 'idle' : 'off', error: null, heardAt: null };
  }

  private set(status: GameStatus): void {
    const changed = status.state !== this.current.state || status.error !== this.current.error || status.heardAt !== this.current.heardAt;
    this.current = status;
    if (changed) this.deps.onStatus(status);
  }
}

export interface SetUpDotaDeps {
  current: () => GameEventsSettings;
  /** Saves game event settings; false with why when they could not be. */
  save: (next: GameEventsSettings) => { ok: true } | { ok: false; error: string };
  /** A folder the user picks; null when they back out. */
  pickFolder: () => Promise<string | null>;
}

/**
 * Switches game events on (making their port and token the first time) and
 * writes Dota's cfg with them: into the Dota Steam knows of, or, with `pick`,
 * into the one in a folder the user chooses.
 */
export async function setUpDota(pick: boolean, deps: SetUpDotaDeps): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  let dir: string | null;
  if (pick) {
    const picked = await deps.pickFolder();
    if (picked === null) return { ok: false, error: '' };
    dir = dotaDirFrom(picked);
    if (!dir) return { ok: false, error: 'Dota 2 is not in that folder. Pick the one called "dota 2 beta", or the Steam library it is in.' };
  } else {
    dir = await findDotaDir();
    if (!dir) return { ok: false, error: 'Steam does not seem to have Dota 2. Choose its folder yourself — the one called "dota 2 beta".' };
  }
  const settings = deps.current();
  const next = { ...settings, ...(settings.token === '' ? newGameIdentity() : {}), enabled: true };
  const saved = deps.save(next);
  if (!saved.ok) return saved;
  try {
    const path = writeCfg(dir, next.port, next.token);
    log.info(`wrote ${path}`);
    return { ok: true, path };
  } catch (err) {
    return { ok: false, error: `Could not write into Dota's folder: ${(err as Error).message}` };
  }
}
