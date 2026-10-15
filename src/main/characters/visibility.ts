/**
 * "Not now" — characters put out of sight from the tray or their own menu,
 * without being switched off. None of it is saved: after a restart everyone
 * enabled is back, which is what "until restart" promises.
 */

export type HideChoice = '30m' | 'restart';

const HIDE_MS: Record<HideChoice, number> = {
  '30m': 30 * 60_000,
  restart: Number.POSITIVE_INFINITY
};

export class Visibility {
  private everyone = false;
  /** When each hidden character comes back; infinity for "until restart". */
  private readonly until = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly listeners = new Set<() => void>();

  constructor(private readonly now: () => number = Date.now) {}

  /** Everyone is out of sight, whatever each of them is set to. */
  get everyoneHidden(): boolean {
    return this.everyone;
  }

  /** This one was hidden on its own and has not come back yet. */
  isSnoozed(id: string): boolean {
    return (this.until.get(id) ?? 0) > this.now();
  }

  isHidden(id: string): boolean {
    return this.everyone || this.isSnoozed(id);
  }

  onChange(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  hide(id: string, choice: HideChoice): void {
    this.hideFor(id, HIDE_MS[choice]);
  }

  /** Out of sight for this many milliseconds — longer if it was already hidden for longer. */
  hideFor(id: string, ms: number): void {
    const until = this.now() + ms;
    if ((this.until.get(id) ?? 0) >= until) return;
    this.until.set(id, until);
    this.changed();
  }

  show(id: string): void {
    if (!this.until.delete(id)) return;
    this.changed();
  }

  setEveryoneHidden(hidden: boolean): void {
    if (hidden === this.everyone) return;
    this.everyone = hidden;
    this.changed();
  }

  toggleEveryone(): void {
    this.setEveryoneHidden(!this.everyone);
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private changed(): void {
    this.arm();
    for (const listener of this.listeners) listener();
  }

  /** One timer, for whoever comes back soonest. */
  private arm(): void {
    this.stop();
    const now = this.now();
    for (const [id, at] of this.until) {
      if (at <= now) this.until.delete(id);
    }
    const next = Math.min(...[...this.until.values()].filter(Number.isFinite));
    if (!Number.isFinite(next)) return;
    this.timer = setTimeout(() => this.changed(), Math.max(0, next - now) + 50);
    this.timer.unref?.();
  }
}
