import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { createLogger } from '../app/logger';
import type { CharacterStore } from './store';

const log = createLogger('assets');

/**
 * `shard-asset://<characterId>/<file>` — how a character's window reaches its
 * own pictures, video and sound. A scheme of our own rather than `file://`,
 * so a renderer can be handed exactly the assets folders and nothing else on
 * the disk.
 */
export const ASSET_SCHEME = 'shard-asset';

/** Must run before `app.whenReady`. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ]);
}

export function assetUrl(characterId: string, file: string): string {
  return `${ASSET_SCHEME}://${characterId}/${encodeURIComponent(file)}`;
}

/**
 * The file a request is for, or null. The query is ignored: callers put a
 * version there so a replaced file is not served from cache under its old name.
 */
export function resolveAssetRequest(requestUrl: string, store: Pick<CharacterStore, 'assetPath'>): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== `${ASSET_SCHEME}:`) return null;

  let file: string;
  try {
    file = decodeURIComponent(url.pathname.replace(/^\//, ''));
  } catch {
    return null;
  }
  // The store refuses anything that is not a bare, known name — a slash, a
  // backslash or a `..` never gets as far as the disk.
  return store.assetPath(url.hostname, file);
}

export function handleAssetProtocol(store: CharacterStore): void {
  protocol.handle(ASSET_SCHEME, async (request) => {
    const path = resolveAssetRequest(request.url, store);
    if (!path) return new Response('not found', { status: 404 });
    try {
      return await net.fetch(pathToFileURL(path).toString());
    } catch (err) {
      log.debug(`asset request failed: ${String(err)}`);
      return new Response('not found', { status: 404 });
    }
  });
}
