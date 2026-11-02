/**
 * What Windows says is playing, read on a thread of its own: on Electron's
 * main thread, creating the monitor blocks forever and takes the whole app
 * with it. Only what the rules use leaves here; the cover art stays behind.
 */

import { parentPort } from 'node:worker_threads';
import { PlaybackStatus, SMTCMonitor } from '@coooookies/windows-smtc-monitor';
import type { MediaSession } from '../engine/musicTracker';

const monitor = new SMTCMonitor();

const send = (): void => {
  const sessions: MediaSession[] = monitor.sessions.map((session) => ({
    app: session.sourceAppId,
    playing: session.playback.playbackStatus === PlaybackStatus.PLAYING,
    title: session.media.title,
    artist: session.media.artist
  }));
  parentPort?.postMessage(sessions);
};

// Not the timeline: it says nothing the rules use, and it is the one that keeps talking.
for (const name of ['session-added', 'session-removed', 'session-media-changed', 'session-playback-changed', 'current-session-changed'] as const) {
  monitor.on(name as 'session-added', send);
}
send();

parentPort?.on('message', () => {
  monitor.destroy();
  parentPort?.close();
});
