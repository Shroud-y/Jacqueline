/**
 * Who is saying what, right now. One line per character at a time; a line
 * that arrives while another is up waits its turn, but not for long — a remark
 * about something is only worth making while that something is still true.
 */

import { computeDurationMs } from '@shared/speechTiming';

/** A line on screen. */
export interface Speech {
  id: string;
  text: string;
  /** How long it stays up, from when it appears. */
  durationMs: number;
}

interface Waiting {
  text: string;
  expiresAt: number;
}

interface Voice {
  current: (Speech & { endsAt: number }) | null;
  queue: Waiting[];
  timer: ReturnType<typeof setTimeout> | null;
  /** Until when the character counts as on stage after its last line, so the line can leave before the window does. */
  lingerUntil: number;
}

/** How long a line may wait behind another before it is no longer worth saying. */
export const WAIT_MS = 30_000;
/** At most this many lines wait behind the one being said; the oldest gives way. */
export const QUEUE_MAX = 2;
/** A character that came out only to speak stays this long after its line, for the line to fade. */
export const LINGER_MS = 400;

export class SpeechDirector {
  private readonly voices = new Map<string, Voice>();
  private readonly listeners = new Set<(characterId: string) => void>();
  private counter = 0;

  constructor(private readonly now: () => number = Date.now) {}

  /** Told which character's speech changed: started, ended, or was dismissed. */
  onChange(listener: (characterId: string) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The line a character is saying now, or null. */
  current(characterId: string): Speech | null {
    const current = this.voices.get(characterId)?.current;
    return current ? { id: current.id, text: current.text, durationMs: current.durationMs } : null;
  }

  isSpeaking(characterId: string): boolean {
    return this.voices.get(characterId)?.current != null;
  }

  /** Speaking, or only just finished — still on stage for its line to leave. */
  isOnStage(characterId: string): boolean {
    const voice = this.voices.get(characterId);
    return voice !== undefined && (voice.current !== null || this.now() < voice.lingerUntil);
  }

  say(characterId: string, text: string): void {
    const voice = this.voice(characterId);
    if (voice.current) {
      voice.queue.push({ text, expiresAt: this.now() + WAIT_MS });
      while (voice.queue.length > QUEUE_MAX) voice.queue.shift();
      return;
    }
    this.start(characterId, voice, text);
  }

  /** The user waved it away: this line goes, and so does everything waiting behind it. */
  dismiss(characterId: string): void {
    const voice = this.voices.get(characterId);
    if (!voice?.current) return;
    voice.queue = [];
    this.end(characterId, voice);
  }

  /** Everyone stops, at once. For mute and for quitting. */
  silenceAll(): void {
    for (const [characterId, voice] of this.voices) {
      voice.queue = [];
      if (voice.current) this.end(characterId, voice);
    }
  }

  /** A character that is gone — deleted, switched off — says nothing more. */
  forget(characterId: string): void {
    const voice = this.voices.get(characterId);
    if (!voice) return;
    if (voice.timer) clearTimeout(voice.timer);
    this.voices.delete(characterId);
    if (voice.current) this.emit(characterId);
  }

  private voice(characterId: string): Voice {
    let voice = this.voices.get(characterId);
    if (!voice) {
      voice = { current: null, queue: [], timer: null, lingerUntil: 0 };
      this.voices.set(characterId, voice);
    }
    return voice;
  }

  private start(characterId: string, voice: Voice, text: string): void {
    const durationMs = computeDurationMs(text);
    this.counter += 1;
    voice.current = { id: `${characterId}#${this.counter}`, text, durationMs, endsAt: this.now() + durationMs };
    voice.timer = setTimeout(() => this.end(characterId, voice), durationMs);
    voice.timer.unref?.();
    this.emit(characterId);
  }

  private end(characterId: string, voice: Voice): void {
    if (voice.timer) clearTimeout(voice.timer);
    voice.timer = null;
    voice.current = null;
    // The next line still worth saying, if any.
    const now = this.now();
    voice.queue = voice.queue.filter((waiting) => waiting.expiresAt > now);
    const next = voice.queue.shift();
    if (next) {
      this.start(characterId, voice, next.text);
      return;
    }
    voice.lingerUntil = now + LINGER_MS;
    this.emit(characterId);
    // Once the linger is over, whoever came out only to speak can go.
    const linger = setTimeout(() => this.emit(characterId), LINGER_MS);
    linger.unref?.();
  }

  private emit(characterId: string): void {
    for (const listener of this.listeners) listener(characterId);
  }
}
