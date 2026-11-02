import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MusicTracker, STOP_GRACE_MS, type MediaSession, type MusicEventType, type MusicNow } from '@main/engine/musicTracker';

const SETTLE = 400;
const player = (playing: boolean, title = 'One', artist = 'Band', app = 'Spotify.exe'): MediaSession => ({ app, playing, title, artist });

describe('MusicTracker', () => {
  let events: { type: MusicEventType; now: MusicNow }[];
  let tracker: MusicTracker;
  const types = (): string[] => events.map((event) => event.type);
  const report = async (...sessions: MediaSession[]): Promise<void> => {
    tracker.update(sessions);
    await vi.advanceTimersByTimeAsync(SETTLE);
  };

  beforeEach(() => {
    vi.useFakeTimers();
    events = [];
    tracker = new MusicTracker((type, now) => events.push({ type, now: { ...now } }));
  });
  afterEach(() => {
    tracker.stop();
    vi.useRealTimers();
  });

  it('knows nothing until Windows has answered', async () => {
    expect(tracker.now).toBeNull();
    await report();
    expect(tracker.now?.playing).toBe(false);
  });

  it('takes what was already playing for no start', async () => {
    await report(player(true));
    expect(events).toEqual([]);
    expect(tracker.now).toMatchObject({ playing: true, track: 'One', artist: 'Band', app: 'spotify' });
  });

  it('says it started once, however many times Windows repeats it', async () => {
    await report();
    tracker.update([player(true)]);
    tracker.update([player(true)]);
    await vi.advanceTimersByTimeAsync(SETTLE);
    await report(player(true));
    expect(types()).toEqual(['musicStarted']);
    expect(events[0]?.now.track).toBe('One');
  });

  it('waits for the title that follows a player starting', async () => {
    await report();
    tracker.update([player(true, '', '')]);
    await vi.advanceTimersByTimeAsync(50);
    tracker.update([player(true, 'One', 'Band')]);
    await vi.advanceTimersByTimeAsync(SETTLE);
    expect(events.map((event) => event.now.track)).toEqual(['One']);
  });

  it('does not take a late title for a new track', async () => {
    await report();
    await report(player(true, '', ''));
    await report(player(true, 'One', 'Band'));
    expect(types()).toEqual(['musicStarted']);
    expect(tracker.now?.track).toBe('One');
  });

  it('says the track changed, and not for a moment with no title', async () => {
    await report(player(true));
    await report(player(true, '', ''));
    expect(events).toEqual([]);
    await report(player(true, 'Two', 'Band'));
    expect(types()).toEqual(['trackChanged']);
    expect(events[0]?.now.track).toBe('Two');
  });

  it('takes a short gap for a gap and a long one for stopping', async () => {
    await report(player(true));
    await report(player(false));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS - SETTLE - 100);
    await report(player(true));
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS * 2);
    expect(events).toEqual([]);

    await report(player(false));
    expect(tracker.now?.playing).toBe(true);
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    expect(types()).toEqual(['musicStopped']);
    expect(events[0]?.now).toMatchObject({ playing: false, track: 'One' });
    expect(tracker.now?.playing).toBe(false);
  });

  it('stays with one player while a second one starts', async () => {
    await report(player(true));
    await report(player(true, 'Video', 'Channel', 'Chrome'), player(true));
    expect(events).toEqual([]);
    expect(tracker.now?.app).toBe('spotify');
    await report(player(true, 'Video', 'Channel', 'Chrome'));
    expect(types()).toEqual(['trackChanged']);
    expect(tracker.now?.app).toBe('chrome');
  });

  it('counts a player closing as stopping', async () => {
    await report(player(true));
    await report();
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS);
    expect(types()).toEqual(['musicStopped']);
  });

  it('holds no timers once stopped', async () => {
    await report(player(true));
    await report(player(false));
    tracker.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(STOP_GRACE_MS * 2);
    expect(events).toEqual([]);
  });
});
