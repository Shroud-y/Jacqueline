import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import type { CooldownLedger } from './cooldown';
import type { RecentHistory } from './selector';
import { createLogger } from '../app/logger';

const log = createLogger('state');

/** Anything older than this cannot still be gating a phrase. */
const PRUNE_MAX_AGE_MS = 7 * 24 * 60 * 60_000;

interface PersistedState {
  version: 1;
  cooldowns: unknown;
  history: unknown;
  firstRunAt: number;
}

/**
 * §18.9 — per-phrase cooldown history and anti-repeat history must survive a
 * restart, otherwise the first minutes after every launch repeat lines.
 */
export class StateStore {
  private firstRunAt = 0;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(
    private readonly filePath: string,
    private readonly ledger: CooldownLedger,
    private readonly history: RecentHistory
  ) {}

  /** Returns true when this is the very first launch on this machine. */
  load(now: number): boolean {
    if (!existsSync(this.filePath)) {
      this.firstRunAt = now;
      this.save();
      return true;
    }
    try {
      const raw = JSON.parse(readFileSync(this.filePath, 'utf8')) as PersistedState;
      this.ledger.restore(raw.cooldowns);
      this.ledger.prune(now, PRUNE_MAX_AGE_MS);
      this.history.restore(raw.history);
      this.firstRunAt = typeof raw.firstRunAt === 'number' ? raw.firstRunAt : now;
      return false;
    } catch (err) {
      log.warn(`cannot read state (${(err as Error).message}) — starting fresh`);
      this.firstRunAt = now;
      return true;
    }
  }

  get startedAt(): number {
    return this.firstRunAt;
  }

  /** Coalesces bursts of stamps into one write. */
  scheduleSave(delayMs = 5_000): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save();
    }, delayMs);
    this.saveTimer.unref?.();
  }

  save(): void {
    const data: PersistedState = {
      version: 1,
      cooldowns: this.ledger.serialize(),
      history: this.history.serialize(),
      firstRunAt: this.firstRunAt
    };
    try {
      const tmp = `${this.filePath}.tmp`;
      writeFileSync(tmp, JSON.stringify(data), 'utf8');
      renameSync(tmp, this.filePath);
    } catch (err) {
      log.error(`cannot write state: ${(err as Error).message}`);
    }
  }
}
