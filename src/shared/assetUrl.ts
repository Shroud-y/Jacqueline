/**
 * `shard-asset://<characterId>/<file>` — how a page reaches a character's own
 * pictures, video and sound. Shared so the editor can show a character's
 * files the same way its window does.
 */
export const ASSET_SCHEME = 'shard-asset';

export function assetUrl(characterId: string, file: string): string {
  return `${ASSET_SCHEME}://${characterId}/${encodeURIComponent(file)}`;
}
