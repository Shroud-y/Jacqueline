import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECK_EVERY_MS, FIRST_CHECK_DELAY_MS, RELEASES_URL, compareVersions, newerRelease, nextCheckAt, parseVersion, releaseVersion, type Release } from '@shared/updates';
import { UpdateChecker, type UpdateDeps } from '@main/app/updates';

const release = (over: Partial<Release> = {}): Release => ({
  tag_name: 'v0.4.0',
  html_url: 'https://github.com/Shroud-y/Jacqueline/releases/tag/v0.4.0',
  assets: [{ name: 'Jacqueline.Setup.0.4.0.exe' }],
  ...over
});

describe('versions', () => {
  it('reads a version however it is written, and nothing that is not one', () => {
    expect(parseVersion('v0.4.0')).toEqual([0, 4, 0]);
    expect(parseVersion('1.2')).toEqual([1, 2, 0]);
    expect(parseVersion('2.0.1-beta.1')).toEqual([2, 0, 1]);
    expect(parseVersion('latest-build')).toBeNull();
    expect(parseVersion('')).toBeNull();
  });

  it('orders by major, then minor, then patch', () => {
    expect(compareVersions([0, 10, 0], [0, 9, 9])).toBe(1);
    expect(compareVersions([1, 0, 0], [1, 0, 0])).toBe(0);
    expect(compareVersions([0, 3, 0], [0, 3, 1])).toBe(-1);
  });

  it('takes the version from the tag, or from the installer when the tag is not one', () => {
    expect(releaseVersion(release())).toEqual([0, 4, 0]);
    // How the releases so far were tagged.
    expect(releaseVersion(release({ tag_name: 'v3', assets: [{ name: 'Jacqueline.Setup.0.3.0.exe' }] }))).toEqual([0, 3, 0]);
    expect(releaseVersion(release({ tag_name: 'v3', assets: [{ name: 'notes.txt' }] }))).toBeNull();
  });
});

describe('newerRelease', () => {
  it('tells about a newer one only', () => {
    expect(newerRelease(release(), '0.3.0')).toEqual({ version: '0.4.0', url: release().html_url });
    expect(newerRelease(release(), '0.4.0')).toBeNull();
    expect(newerRelease(release(), '0.5.0')).toBeNull();
    expect(newerRelease(release({ tag_name: 'v3', assets: [{ name: 'Jacqueline.Setup.0.3.0.exe' }] }), '0.3.0')).toBeNull();
  });

  it('keeps quiet about drafts, pre-releases and pages that are not on GitHub', () => {
    expect(newerRelease(release({ draft: true }), '0.3.0')).toBeNull();
    expect(newerRelease(release({ prerelease: true }), '0.3.0')).toBeNull();
    expect(newerRelease(release({ html_url: 'https://example.com/x' }), '0.3.0')).toBeNull();
  });
});

describe('nextCheckAt', () => {
  it('looks a minute after starting, then a day after the last look', () => {
    expect(nextCheckAt(null, 1000)).toBe(1000 + FIRST_CHECK_DELAY_MS);
    expect(nextCheckAt(0, 10 * CHECK_EVERY_MS)).toBe(10 * CHECK_EVERY_MS + FIRST_CHECK_DELAY_MS);
    expect(nextCheckAt(5000, 6000)).toBe(5000 + CHECK_EVERY_MS);
  });
});

describe('UpdateChecker', () => {
  let dir: string;
  let enabled: boolean;
  let answer: () => Promise<string>;
  let asked: { url: string; headers: Record<string, string> }[];
  let changes: number;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'jacqueline-updates-'));
    enabled = true;
    answer = async () => JSON.stringify(release());
    asked = [];
    changes = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 10, 7, 12, 0));
  });

  afterEach(() => {
    vi.useRealTimers();
    rmSync(dir, { recursive: true, force: true });
  });

  const checker = (over: Partial<UpdateDeps> = {}): UpdateChecker =>
    new UpdateChecker({
      current: '0.3.0',
      supported: true,
      isEnabled: () => enabled,
      fetchText: (url, init) => {
        asked.push({ url, headers: init.headers });
        return answer();
      },
      stateFile: join(dir, 'update-state.json'),
      onChange: () => {
        changes += 1;
      },
      ...over
    });

  it('asks GitHub about the latest release, with nothing in it but its own name', async () => {
    const updates = checker();
    expect(await updates.check()).toBe(true);
    expect(asked).toEqual([{ url: RELEASES_URL, headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Jacqueline/0.3.0' } }]);
    expect(updates.available).toEqual({ version: '0.4.0', url: release().html_url });
    expect(updates.view).toMatchObject({ checking: false, error: null, checkedAt: Date.now() });
    expect(changes).toBe(2);
  });

  it('asks nothing in a development run, or with looking off', async () => {
    expect(await checker({ supported: false }).check()).toBe(false);
    enabled = false;
    expect(await checker().check()).toBe(false);
    expect(asked).toEqual([]);
  });

  it('says nothing of a newer version while looking is off, and again once it is on', async () => {
    const updates = checker();
    await updates.check();
    enabled = false;
    expect(updates.available).toBeNull();
    enabled = true;
    expect(updates.available?.version).toBe('0.4.0');
  });

  it('remembers across a restart, and forgets what it found once another version is installed', async () => {
    await checker().check();
    const saved = JSON.parse(readFileSync(join(dir, 'update-state.json'), 'utf8')) as { checkedAt: number; checkedAs: string };
    expect(saved).toMatchObject({ checkedAt: Date.now(), checkedAs: '0.3.0' });
    expect(checker().available?.version).toBe('0.4.0');
    const updated = checker({ current: '0.4.0' });
    expect(updated.available).toBeNull();
    expect(updated.view.checkedAt).toBeNull();
  });

  it('looks afresh, a minute after starting, when the last look was made by another version', async () => {
    writeFileSync(join(dir, 'update-state.json'), JSON.stringify({ checkedAt: Date.now() - 60_000, checkedAs: '0.4.0', newer: null }));
    const updates = checker();
    updates.arm();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS);
    expect(asked).toHaveLength(1);
    expect(updates.available?.version).toBe('0.4.0');
    updates.stop();
  });

  it('keeps what it knew when GitHub cannot be reached, and says why', async () => {
    const updates = checker();
    await updates.check();
    answer = async () => {
      throw new Error('offline');
    };
    await updates.check();
    expect(updates.view.error).toBe('Could not reach GitHub.');
    expect(updates.available?.version).toBe('0.4.0');
  });

  it('refuses an answer that is not a release', async () => {
    answer = async () => '{"message":"Not Found"}';
    const updates = checker();
    await updates.check();
    expect(updates.view.error).not.toBeNull();
    expect(updates.view.checkedAt).toBeNull();
  });

  it('looks a minute after starting, then once a day, and not at all once switched off', async () => {
    const updates = checker();
    updates.arm();
    await vi.advanceTimersByTimeAsync(FIRST_CHECK_DELAY_MS - 1_000);
    expect(asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(asked).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS);
    expect(asked).toHaveLength(2);
    enabled = false;
    updates.arm();
    await vi.advanceTimersByTimeAsync(3 * CHECK_EVERY_MS);
    expect(asked).toHaveLength(2);
    updates.stop();
  });

  it('does not look again on a restart within the day', async () => {
    writeFileSync(join(dir, 'update-state.json'), JSON.stringify({ checkedAt: Date.now() - 60_000, checkedAs: '0.3.0', newer: null }));
    const updates = checker();
    updates.arm();
    await vi.advanceTimersByTimeAsync(CHECK_EVERY_MS - 2 * 60_000);
    expect(asked).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(2 * 60_000);
    expect(asked).toHaveLength(1);
    updates.stop();
  });
});
