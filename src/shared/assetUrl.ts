/**
 * `jacqueline-asset://<characterId>/<file>` — how a page reaches a character's own
 * pictures, video and sound. Shared so the editor can show a character's
 * files the same way its window does.
 */
export const ASSET_SCHEME = 'jacqueline-asset';

export function assetUrl(characterId: string, file: string): string {
  return `${ASSET_SCHEME}://${characterId}/${encodeURIComponent(file)}`;
}

/**
 * `jacqueline-script://<characterId>/` — the sealed page a character's own
 * script runs in. An origin of its own, framed with `sandbox`, so the script
 * reaches nothing of the window it sits in or of any other character.
 */
export const SCRIPT_SCHEME = 'jacqueline-script';

export function scriptHostUrl(characterId: string, version: string): string {
  return `${SCRIPT_SCHEME}://${characterId}/?v=${encodeURIComponent(version)}`;
}
