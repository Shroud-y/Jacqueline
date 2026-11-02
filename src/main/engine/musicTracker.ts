/**
 * What Windows reports about players, turned into what a person would call
 * music starting, stopping and changing. Windows says the same thing several
 * times over, and a player between two tracks can look stopped for a moment.
 */

import { appStem } from '../characters/presence';

/** One player, as Windows reports it. */
export interface MediaSession {
  app: string;
  playing: boolean;
  title: string;
  artist: string;
}

export interface MusicNow {
  playing: boolean;
  track: string;
  artist: string;
  /** The player, by stem. */
  app: string;
}

export type MusicEventType = 'musicStarted' | 'musicStopped' | 'trackChanged';

/** Long enough for the title that follows a player starting. */
const SETTLE_MS = 300;
/** Quiet for this long is stopped; shorter is a gap between tracks. */
export const STOP_GRACE_MS = 5_000;

const trackOf = (session: { title: string; artist: string }): string => `${session.title}\n${session.artist}`;
const NO_TRACK = trackOf({ title: '', artist: '' });

export class MusicTracker {
  private sessions: MediaSession[] = [];
  private settleTimer: NodeJS.Timeout | null = null;
  private stopTimer: NodeJS.Timeout | null = null;
  private known = false;
  private current: MusicNow = { playing: false, track: '', artist: '', app: '' };
  private playerId: string | null = null;

  constructor(
    private readonly onEvent: (type: MusicEventType, now: MusicNow) => void,
    /** Windows has first answered: `now` is known, and no event says so. */
    private readonly onKnown?: () => void
  ) {}

  /** What is going on; null until Windows has first answered. */
  get now(): MusicNow | null {
    return this.known ? this.current : null;
  }

  update(sessions: MediaSession[]): void {
    this.sessions = sessions;
    if (this.settleTimer) return;
    this.settleTimer = setTimeout(() => {
      this.settleTimer = null;
      this.settle();
    }, SETTLE_MS);
    this.settleTimer.unref?.();
  }

  stop(): void {
    if (this.settleTimer) clearTimeout(this.settleTimer);
    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.settleTimer = this.stopTimer = null;
  }

  private settle(): void {
    const playing = this.sessions.filter((session) => session.playing);
    // The one already being listened to, for as long as it goes on.
    const session = playing.find((one) => one.app === this.playerId) ?? playing[0];

    // Whatever was already playing when the watching began has not just started.
    if (!this.known) {
      this.known = true;
      if (session) this.take(session);
      this.onKnown?.();
      return;
    }

    if (!session) {
      if (this.current.playing && !this.stopTimer) {
        this.stopTimer = setTimeout(() => {
          this.stopTimer = null;
          this.current = { ...this.current, playing: false };
          this.playerId = null;
          this.onEvent('musicStopped', this.current);
        }, STOP_GRACE_MS);
        this.stopTimer.unref?.();
      }
      return;
    }

    if (this.stopTimer) clearTimeout(this.stopTimer);
    this.stopTimer = null;

    if (!this.current.playing) {
      this.take(session);
      this.onEvent('musicStarted', this.current);
      return;
    }

    const before = trackOf({ title: this.current.track, artist: this.current.artist });
    const after = trackOf(session);
    // A player between tracks can have no title for a moment: nothing has changed yet.
    if (after === NO_TRACK || after === before) return;
    this.take(session);
    // A title arriving late is the same track, not a new one.
    if (before !== NO_TRACK) this.onEvent('trackChanged', this.current);
  }

  private take(session: MediaSession): void {
    this.playerId = session.app;
    this.current = { playing: true, track: session.title, artist: session.artist, app: appStem(session.app) };
  }
}
