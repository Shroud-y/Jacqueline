import type { AppEvent } from './events';
import { eventTypeMatches } from './events';

type Listener = (event: AppEvent) => void;

const RING_SIZE = 100;

/**
 * Typed pub/sub plus a bounded ring buffer of the last 100 events for the
 * debug panel. Subscribing with a pattern uses the same wildcard rules as
 * trigger rules.
 */
export class EventBus {
  private listeners = new Map<string, Set<Listener>>();
  private ring: AppEvent[] = [];

  /** `pattern` may be an exact type, a 'prefix.*' wildcard, or '*'. */
  on(pattern: string, listener: Listener): () => void {
    let set = this.listeners.get(pattern);
    if (!set) {
      set = new Set();
      this.listeners.set(pattern, set);
    }
    set.add(listener);
    return () => {
      set!.delete(listener);
      if (set!.size === 0) this.listeners.delete(pattern);
    };
  }

  emit(event: AppEvent): void {
    this.ring.push(event);
    if (this.ring.length > RING_SIZE) this.ring.shift();

    for (const [pattern, set] of this.listeners) {
      if (!eventTypeMatches(pattern, event.type)) continue;
      for (const listener of set) {
        try {
          listener(event);
        } catch (err) {
          // A broken listener must not take the bus down with it.
          console.error(`[eventBus] listener for "${pattern}" threw:`, err);
        }
      }
    }
  }

  /** Most recent last. */
  recent(limit = RING_SIZE): AppEvent[] {
    return this.ring.slice(-limit);
  }

  clear(): void {
    this.ring = [];
  }
}
