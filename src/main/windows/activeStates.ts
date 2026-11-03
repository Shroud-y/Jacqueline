/**
 * Which of its own states each character is wearing, and for how long. Kept
 * only while the app runs: after a restart a character is back to its usual look.
 */
export class ActiveStates {
  private readonly active = new Map<string, { state: string; timer: NodeJS.Timeout | null }>();

  /** `onEnded` is told when a state runs out by itself. */
  constructor(private readonly onEnded: (id: string) => void) {}

  get(id: string): string | null {
    return this.active.get(id)?.state ?? null;
  }

  /** Replaces whatever it was wearing. `ms` null lasts until it is changed. */
  set(id: string, state: string | null, ms: number | null): void {
    this.clearTimer(id);
    if (state === null) {
      this.active.delete(id);
      return;
    }
    let timer: NodeJS.Timeout | null = null;
    if (ms !== null) {
      timer = setTimeout(() => {
        this.active.delete(id);
        this.onEnded(id);
      }, ms);
      timer.unref?.();
    }
    this.active.set(id, { state, timer });
  }

  stop(): void {
    for (const id of this.active.keys()) this.clearTimer(id);
    this.active.clear();
  }

  private clearTimer(id: string): void {
    const timer = this.active.get(id)?.timer;
    if (timer) clearTimeout(timer);
  }
}
