/**
 * Looks once a day whether a newer Jacqueline is out, and says so — in the
 * tray and in Settings. Never downloads or installs anything: what to do with
 * a new version is the user's call, on the release's own page.
 *
 * The one request it makes is a GET of the latest release's description from
 * GitHub, with nothing about the user in it. Off, it makes none at all.
 */

import { existsSync } from 'node:fs';
import { z } from 'zod';
import { newerRelease, nextCheckAt, releaseSchema, RELEASES_URL, type Available } from '@shared/updates';
import type { UpdateView } from '@shared/types';
import { readJson, writeJsonAtomic } from './jsonFile';
import { createLogger } from './logger';

const log = createLogger('updates');

/** Anything bigger than this is not GitHub describing a release. */
const MAX_ANSWER_BYTES = 1024 * 1024;
const TIMEOUT_MS = 15_000;

const stateSchema = z.object({
  checkedAt: z.number().nullable(),
  newer: z.object({ version: z.string().max(40), url: z.string().max(500) }).nullable()
});
type StoredState = z.infer<typeof stateSchema>;

export interface UpdateDeps {
  /** This build's version, `0.3.0`. */
  current: string;
  /** False in a development run: there is nothing installed to compare. */
  supported: boolean;
  isEnabled: () => boolean;
  /** GETs a URL and answers with its body as text; throws on anything but a 200. */
  fetchText: (url: string, init: { headers: Record<string, string>; signal: AbortSignal }) => Promise<string>;
  stateFile: string;
  onChange: () => void;
  now?: () => number;
}

export class UpdateChecker {
  private state: StoredState = { checkedAt: null, newer: null };
  private checking = false;
  private error: string | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly startedAt: number;
  private readonly now: () => number;
  private stopped = false;

  constructor(private readonly deps: UpdateDeps) {
    this.now = deps.now ?? Date.now;
    this.startedAt = this.now();
    this.state = this.read();
    // A version that has since been installed is no longer news.
    if (this.state.newer && !newerRelease({ tag_name: this.state.newer.version, html_url: this.state.newer.url, assets: [] }, deps.current)) {
      this.state = { ...this.state, newer: null };
    }
  }

  get view(): UpdateView {
    return {
      current: this.deps.current,
      supported: this.deps.supported,
      checking: this.checking,
      checkedAt: this.state.checkedAt,
      error: this.error,
      newer: this.deps.isEnabled() ? this.state.newer : null
    };
  }

  /** The newer release to point at, while there is one and looking is on. */
  get available(): Available | null {
    return this.view.newer;
  }

  /** Arms the day's look, or puts it away when looking is off. Call again whenever the setting changes. */
  arm(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || !this.deps.supported || !this.deps.isEnabled()) return;
    const wait = Math.max(1_000, nextCheckAt(this.state.checkedAt, this.startedAt) - this.now());
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.check().finally(() => this.arm());
    }, wait);
    this.timer.unref?.();
  }

  /** Looks now. False when it cannot look at all: a development run, or looking switched off. */
  async check(): Promise<boolean> {
    if (!this.deps.supported || !this.deps.isEnabled()) return false;
    if (this.checking) return true;
    this.checking = true;
    this.deps.onChange();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    timeout.unref?.();
    try {
      const text = await this.deps.fetchText(RELEASES_URL, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Jacqueline/${this.deps.current}` },
        signal: controller.signal
      });
      if (text.length > MAX_ANSWER_BYTES) throw new Error('the answer was far too big');
      const release = releaseSchema.parse(JSON.parse(text));
      const newer = newerRelease(release, this.deps.current);
      if (newer && newer.version !== this.state.newer?.version) log.info(`${newer.version} is out (this is ${this.deps.current})`);
      this.state = { checkedAt: this.now(), newer };
      this.error = null;
      this.write();
    } catch (err) {
      // Offline, rate-limited, GitHub down: tomorrow's look will do. Nothing to bother anyone with.
      this.error = controller.signal.aborted ? 'GitHub did not answer in time.' : 'Could not reach GitHub.';
      log.warn(`cannot look for updates: ${(err as Error).message}`);
    } finally {
      clearTimeout(timeout);
      this.checking = false;
      this.deps.onChange();
    }
    return true;
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private read(): StoredState {
    if (!existsSync(this.deps.stateFile)) return { checkedAt: null, newer: null };
    try {
      return stateSchema.parse(readJson(this.deps.stateFile));
    } catch (err) {
      log.warn(`cannot read the update state (${(err as Error).message}) — starting afresh`);
      return { checkedAt: null, newer: null };
    }
  }

  private write(): void {
    try {
      writeJsonAtomic(this.deps.stateFile, this.state);
    } catch (err) {
      log.warn(`cannot save the update state: ${(err as Error).message}`);
    }
  }
}
