/**
 * Whether a newer Jacqueline is out, from what GitHub says about the latest
 * release. Pure: the request, the clock and the stored state are all passed
 * in, so every decision here is tested without a network.
 *
 * A release's version comes from its tag (`v0.4.0`), or, for a tag that is no
 * version at all (`v3`), from its installer's name (`Jacqueline.Setup.0.3.0.exe`).
 */

import { z } from 'zod';

export const RELEASES_URL = 'https://api.github.com/repos/Shroud-y/Jacqueline/releases/latest';
/** At most this often, however often the app is started. */
export const CHECK_EVERY_MS = 24 * 60 * 60 * 1000;
/** After starting, before the first look: the start itself is busy enough. */
export const FIRST_CHECK_DELAY_MS = 60 * 1000;

export type Version = readonly [number, number, number];

/** `v0.4.0`, `0.4`, `1.2.3-beta` → the numbers; null for anything that is not a version. */
export function parseVersion(text: string): Version | null {
  const match = /^v?(\d{1,4})\.(\d{1,4})(?:\.(\d{1,6}))?(?:[-+].*)?$/i.exec(text.trim());
  if (!match) return null;
  return [Number(match[1]), Number(match[2]), Number(match[3] ?? 0)];
}

export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i += 1) {
    const diff = (a[i] ?? 0) - (b[i] ?? 0);
    if (diff !== 0) return Math.sign(diff);
  }
  return 0;
}

export const formatVersion = (version: Version): string => version.join('.');

/** The little of GitHub's answer that is used; the rest is ignored. */
export const releaseSchema = z.object({
  tag_name: z.string().max(200),
  html_url: z.string().max(500),
  draft: z.boolean().optional(),
  prerelease: z.boolean().optional(),
  assets: z.array(z.object({ name: z.string().max(300) })).max(100).default([])
});
export type Release = z.infer<typeof releaseSchema>;

/** The release's version, by its tag or else by its installer's name; null when neither says. */
export function releaseVersion(release: Release): Version | null {
  const byTag = parseVersion(release.tag_name);
  // A tag like `v3` reads as no version: two numbers at least, or it is a name.
  if (byTag && /\d\.\d/.test(release.tag_name)) return byTag;
  for (const asset of release.assets) {
    const match = /(\d{1,4}\.\d{1,4}\.\d{1,6})\.exe$/i.exec(asset.name);
    const version = match?.[1] ? parseVersion(match[1]) : null;
    if (version) return version;
  }
  return null;
}

/** A release worth telling about. */
export interface Available {
  version: string;
  url: string;
}

/** A newer release than this one, or null: up to date, a draft, a pre-release, or one whose version cannot be told. */
export function newerRelease(release: Release, current: string): Available | null {
  if (release.draft || release.prerelease) return null;
  const version = releaseVersion(release);
  const mine = parseVersion(current);
  if (!version || !mine || compareVersions(version, mine) <= 0) return null;
  // Only GitHub's own pages are opened from here.
  if (!/^https:\/\/github\.com\//.test(release.html_url)) return null;
  return { version: formatVersion(version), url: release.html_url };
}

/** When the next look is due: a while after starting, then a day after the last one. */
export function nextCheckAt(checkedAt: number | null, startedAt: number): number {
  const first = startedAt + FIRST_CHECK_DELAY_MS;
  return checkedAt === null ? first : Math.max(first, checkedAt + CHECK_EVERY_MS);
}
