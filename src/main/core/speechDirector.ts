/**
 * §8 — the only component allowed to decide that something is actually said.
 * There is no other path to the overlay.
 *
 * The entry point is `submit(SpeechRequest)`, deliberately origin-agnostic
 * (§19): trigger-matched phrases are merely the only current producer.
 */

import { computeDurationMs } from '@shared/speechTiming';
import type { SpeechShowPayload } from '@shared/types';
import type { AppEvent, EventPriority } from './events';
import type { ConditionContext } from './conditions';
import { evaluateConditions } from './conditions';
import { CooldownKey, type CooldownLedger } from './cooldown';
import type { Phrase, PhraseBankIndex } from './phraseBank';
import { RecentHistory, selectPhrase, type Rng } from './selector';
import type { SuppressionReason, SuppressionState } from './suppression';
import type { VoiceEngine } from '../voice/VoiceEngine';

export interface SpeechRequest {
  /** 'trigger' today; 'command' and 'llm' in later phases. */
  origin: string;
  groupId: string;
  category: string;
  priority: EventPriority;
  ruleId?: string;
  event?: AppEvent;
  /** Tray "Say something now". Still respects hard mute. */
  bypassCooldowns?: boolean;
  bypassSuppression?: boolean;
  /**
   * §8.5 — the dedicated startup greeting is the documented exception to the
   * 30 s post-boot blackout. Every other suppression reason still applies.
   */
  bypassBootGrace?: boolean;
}

export type DropReason =
  | 'muted'
  | 'suppressed'
  | 'globalCooldown'
  | 'categoryCooldown'
  | 'busy'
  | 'noPhrase'
  | 'unknownGroup'
  | 'deferralExpired'
  | 'queueFull';

export type Decision =
  | { said: true; speechId: string; phraseId: string }
  | { said: false; reason: DropReason; deferred: boolean };

export interface OverlayPresenter {
  show(payload: SpeechShowPayload): void;
  hide(): void;
  interrupt(): void;
}

export interface SpeechDirectorDeps {
  bank: PhraseBankIndex;
  ledger: CooldownLedger;
  history: RecentHistory;
  voice: VoiceEngine;
  overlay: OverlayPresenter;
  getSuppression: (now: number) => SuppressionState;
  getConditionContext: (now: number) => Pick<ConditionContext, 'uptimeMinutes' | 'firstRun'>;
  /** Every drop, with its reason. Noisy by design. */
  logDebug?: (message: string) => void;
  /** Lines actually spoken. Kept at info so packaged builds record them. */
  logInfo?: (message: string) => void;
  rng?: Rng;
  now?: () => number;
}

interface DeferredItem {
  request: SpeechRequest;
  expiresAt: number;
}

interface CurrentSpeech {
  speechId: string;
  phraseId: string;
  priority: EventPriority;
}

/** §8.4 */
const DEFERRAL_TTL_MS = 90_000;
const DEFERRAL_MAX = 3;
const DEFERRAL_TICK_MS = 5_000;

const PRIORITY_RANK: Record<EventPriority, number> = { ambient: 0, notable: 1, urgent: 2 };

export class SpeechDirector {
  private readonly deps: SpeechDirectorDeps;
  private readonly rng: Rng;
  private readonly now: () => number;

  private deferred: DeferredItem[] = [];
  private current: CurrentSpeech | null = null;
  private speechCounter = 0;
  private flushTimer: NodeJS.Timeout | null = null;
  private pendingAck: { speechId: string; resolve: () => void } | null = null;

  constructor(deps: SpeechDirectorDeps) {
    this.deps = deps;
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.flushTimer) return;
    this.flushTimer = setInterval(() => this.flushDeferred(), DEFERRAL_TICK_MS);
    this.flushTimer.unref?.();
  }

  stop(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    this.deferred = [];
    this.deps.voice.stop();
    this.deps.overlay.hide();
    this.current = null;
  }

  get speaking(): boolean {
    return this.current !== null;
  }

  /** Swaps the active bank when the active preset changes, no restart needed. */
  setBank(bank: PhraseBankIndex): void {
    this.deps.bank = bank;
  }

  deferredSnapshot(): { speechId: string; expiresAt: number }[] {
    return this.deferred.map((item) => ({
      speechId: `${item.request.origin}:${item.request.groupId}`,
      expiresAt: item.expiresAt
    }));
  }

  /* ---------------------------------------------------------------- */
  /* Pipeline (§8.1)                                                   */
  /* ---------------------------------------------------------------- */

  submit(request: SpeechRequest, isDeferredRetry = false): Decision {
    const now = this.now();
    const label = `${request.origin}/${request.ruleId ?? request.groupId}`;

    const drop = (reason: DropReason, deferred = false): Decision => {
      const message = `[director] ${label} → ${deferred ? 'deferred' : 'dropped'} (${reason})`;
      // Ambient drops are the common case and would drown the log. A notable
      // or urgent line going missing is rare and worth recording, otherwise a
      // packaged build gives no way to find out why it stayed silent.
      if (request.priority === 'ambient') this.deps.logDebug?.(message);
      else this.deps.logInfo?.(message);
      return { said: false, reason, deferred };
    };

    // 1. Hard mute — absolute, including urgent.
    const suppression = this.deps.getSuppression(now);
    if (suppression.hardMute) return drop('muted');

    // 2. Suppression.
    const reasons = activeReasons(request, suppression);
    if (reasons.length > 0 && !request.bypassSuppression) {
      if (request.priority === 'ambient') return drop('suppressed');
      if (request.priority === 'notable') {
        // A retry blocked again is discarded, not re-queued — say so.
        return this.defer(request, now, isDeferredRetry) ?? drop('suppressed', !isDeferredRetry);
      }
      // urgent falls through
    }

    // 3. Global cooldown.
    if (!request.bypassCooldowns && !this.deps.ledger.canFire(CooldownKey.global(), now)) {
      if (request.priority === 'ambient') return drop('globalCooldown');
      if (request.priority === 'notable') {
        return this.defer(request, now, isDeferredRetry) ?? drop('globalCooldown', !isDeferredRetry);
      }
    }

    // 4. Category cooldown — drop unless urgent.
    if (
      !request.bypassCooldowns &&
      request.priority !== 'urgent' &&
      !this.deps.ledger.canFire(CooldownKey.category(request.category), now)
    ) {
      return drop('categoryCooldown');
    }

    // 5. Already speaking — higher priority interrupts, otherwise drop.
    if (this.current) {
      if (PRIORITY_RANK[request.priority] > PRIORITY_RANK[this.current.priority]) {
        this.interrupt();
      } else {
        return drop('busy');
      }
    }

    // 6. Select a phrase.
    const group = this.deps.bank.group(request.groupId);
    if (!group) return drop('unknownGroup');

    const conditionBase = this.deps.getConditionContext(now);
    const phrase = selectPhrase({
      phrases: group.phrases,
      recentIds: this.deps.history.get(group.id),
      rng: this.rng,
      isEligible: (candidate) => this.isEligible(candidate, request, conditionBase, now)
    });
    if (!phrase) return drop('noPhrase');

    // 7. Stamp and speak. Silence is never a bug, but this is not silence.
    this.deps.ledger.stamp(CooldownKey.global(), now);
    this.deps.ledger.stamp(CooldownKey.category(request.category), now);
    this.deps.ledger.stamp(CooldownKey.phrase(phrase.id), now);
    this.deps.history.push(group.id, phrase.id);

    const speechId = `s${++this.speechCounter}-${phrase.id}`;
    this.current = { speechId, phraseId: phrase.id, priority: request.priority };
    void this.perform(speechId, phrase);

    this.deps.logInfo?.(`[director] ${label} → speaking "${phrase.id}"`);
    return { said: true, speechId, phraseId: phrase.id };
  }

  private isEligible(
    phrase: Phrase,
    request: SpeechRequest,
    base: Pick<ConditionContext, 'uptimeMinutes' | 'firstRun'>,
    now: number
  ): boolean {
    if (!request.bypassCooldowns && !this.deps.ledger.canFire(CooldownKey.phrase(phrase.id), now)) {
      return false;
    }
    return evaluateConditions(phrase.conditions, {
      ...base,
      now,
      payload: request.event?.payload,
      warn: (message) => this.deps.logDebug?.(`[conditions] ${phrase.id}: ${message}`)
    });
  }

  private async perform(speechId: string, phrase: Phrase): Promise<void> {
    const durationMs = computeDurationMs(phrase.segments);

    let audioUrl: string | null = null;
    try {
      audioUrl = (await this.deps.voice.prepare?.(phrase.id)) ?? null;
    } catch (err) {
      this.deps.logDebug?.(`[director] voice.prepare failed for ${phrase.id}: ${String(err)}`);
    }

    if (this.current?.speechId !== speechId) return; // interrupted while preparing

    const payload: SpeechShowPayload = {
      speechId,
      segments: phrase.segments,
      durationMs,
      ...(audioUrl ? { audioUrl } : {})
    };
    this.deps.overlay.show(payload);

    try {
      await this.deps.voice.speak({ phraseId: phrase.id, segments: phrase.segments });
    } catch (err) {
      this.deps.logDebug?.(`[director] voice.speak failed for ${phrase.id}: ${String(err)}`);
    }

    if (this.current?.speechId !== speechId) return;
    this.finish(speechId);
  }

  /** Called by the renderer ack and by the voice engine completing. */
  finish(speechId: string): void {
    if (this.current?.speechId !== speechId) return;
    this.current = null;
    this.resolveAck(speechId);
    this.deps.overlay.hide();
    this.flushDeferred();
  }

  dismiss(speechId: string): void {
    if (this.current?.speechId !== speechId) return;
    this.deps.voice.stop();
    this.finish(speechId);
  }

  interrupt(): void {
    if (!this.current) return;
    const { speechId } = this.current;
    this.current = null;
    this.resolveAck(speechId);
    this.deps.voice.stop();
    this.deps.overlay.interrupt();
  }

  /**
   * Awaits the overlay's playback ack for the current speech; used by
   * `PrerenderedVoiceEngine`, which cannot know when audio ended on its own.
   */
  awaitPlaybackAck(_phraseId: string, timeoutMs: number): Promise<void> {
    const speechId = this.current?.speechId;
    if (!speechId) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        if (this.pendingAck?.speechId === speechId) this.pendingAck = null;
        resolve();
      }, timeoutMs);
      timer.unref?.();
      this.pendingAck = {
        speechId,
        resolve: () => {
          clearTimeout(timer);
          resolve();
        }
      };
    });
  }

  private resolveAck(speechId: string): void {
    if (this.pendingAck?.speechId === speechId) {
      const { resolve } = this.pendingAck;
      this.pendingAck = null;
      resolve();
    }
  }

  /* ---------------------------------------------------------------- */
  /* Deferral (§8.4)                                                   */
  /* ---------------------------------------------------------------- */

  private defer(request: SpeechRequest, now: number, isDeferredRetry: boolean): Decision | null {
    // A retry that is blocked again is dropped, never re-queued: a backlog of
    // chatter is exactly the failure mode this whole section exists to avoid.
    if (isDeferredRetry) return null;
    if (this.deferred.length >= DEFERRAL_MAX) {
      this.deps.logDebug?.('[director] deferral queue full — dropping');
      return { said: false, reason: 'queueFull', deferred: false };
    }
    this.deferred.push({ request, expiresAt: now + DEFERRAL_TTL_MS });
    return null;
  }

  /**
   * Fires the best non-expired deferred item and discards the rest. While the
   * block that deferred them is still in place the queue is left alone: the
   * timer ticks every 5 s, and retrying into the same block would drop every
   * item on the first tick and make the 90 s TTL meaningless.
   */
  flushDeferred(): void {
    if (this.deferred.length === 0) return;
    const now = this.now();

    const alive = this.deferred.filter((item) => item.expiresAt > now);
    if (alive.length === 0) {
      this.deferred = [];
      return;
    }

    alive.sort((a, b) => {
      const byPriority = PRIORITY_RANK[b.request.priority] - PRIORITY_RANK[a.request.priority];
      return byPriority !== 0 ? byPriority : a.expiresAt - b.expiresAt;
    });

    const best = alive[0];
    if (!best) return;
    if (this.stillDeferrable(best.request, now)) {
      this.deferred = alive;
      return;
    }
    this.deferred = [];
    this.submit(best.request, true);
  }

  /** The gates `submit` defers on (suppression, global cooldown) still hold. */
  private stillDeferrable(request: SpeechRequest, now: number): boolean {
    const suppression = this.deps.getSuppression(now);
    // Mute is not a deferral: let `submit` drop it with the right reason.
    if (suppression.hardMute) return false;
    if (activeReasons(request, suppression).length > 0 && !request.bypassSuppression) return true;
    return !request.bypassCooldowns && !this.deps.ledger.canFire(CooldownKey.global(), now);
  }
}

function activeReasons(request: SpeechRequest, suppression: SuppressionState): SuppressionReason[] {
  return request.bypassBootGrace
    ? suppression.reasons.filter((reason) => reason !== 'bootGrace')
    : suppression.reasons;
}
