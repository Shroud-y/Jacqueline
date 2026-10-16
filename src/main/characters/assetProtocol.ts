import { net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import { ASSET_SCHEME } from '@shared/assetUrl';
import { createLogger } from '../app/logger';
import type { CharacterStore } from './store';

const log = createLogger('assets');

/**
 * `jacqueline-asset://<characterId>/<file>` — how a character's window reaches its
 * own pictures, video and sound. A scheme of our own rather than `file://`,
 * so a renderer can be handed exactly the assets folders and nothing else on
 * the disk.
 */
export { ASSET_SCHEME, assetUrl } from '@shared/assetUrl';

/** Must run before `app.whenReady`. */
export function registerAssetScheme(): void {
  protocol.registerSchemesAsPrivileged([
    // `corsEnabled`: a font is always fetched in CORS mode, unlike a picture or a
    // video, and the pages asking (`http://localhost` in development, `file://`
    // when packaged) are never the same origin as this scheme.
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ]);
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
      const response = await net.fetch(pathToFileURL(path).toString());
      // Only our own pages can ask this scheme for anything, so any origin may read it.
      const headers = new Headers(response.headers);
      headers.set('Access-Control-Allow-Origin', '*');
      return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
    } catch (err) {
      log.debug(`asset request failed: ${String(err)}`);
      return new Response('not found', { status: 404 });
    }
  });
}
