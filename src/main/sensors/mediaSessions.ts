import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { createLogger } from '../app/logger';
import type { MediaSession } from '../engine/musicTracker';

const log = createLogger('media');

/** How long it gets to let go of Windows by itself. */
const STOP_MS = 500;

/**
 * Starts listening to what Windows says is playing. Failing costs nothing but
 * the music: rules about it simply never fire.
 */
export function watchMediaSessions(onSessions: (sessions: MediaSession[]) => void): () => void {
  let worker: Worker;
  try {
    worker = new Worker(join(__dirname, 'mediaWorker.js'));
  } catch (err) {
    log.error(`cannot watch what is playing: ${String(err)}`);
    return () => undefined;
  }
  worker.on('message', onSessions);
  worker.on('error', (err) => log.error(`stopped watching what is playing: ${String(err)}`));
  // Its messages must not be what keeps the app from quitting.
  worker.unref();
  return () => {
    worker.off('message', onSessions);
    worker.postMessage('stop');
    setTimeout(() => void worker.terminate(), STOP_MS).unref();
  };
}
