/**
 * §8.5 — do-not-disturb evaluation. Pure; every input is passed in.
 */

import { isWithinClockWindow, minutesOfDay } from './conditions';
import type { QuietHours } from '@shared/types';

export type SuppressionReason =
  | 'muted'
  | 'snoozed'
  | 'quietHours'
  | 'fullscreen'
  | 'microphone'
  | 'bootGrace';

export interface SuppressionInput {
  now: number;
  muted: boolean;
  snoozedUntil: number | null;
  quietHours: QuietHours;
  suppressOnFullscreen: boolean;
  fullscreenActive: boolean;
  suppressOnMicrophoneUse: boolean;
  microphoneActive: boolean;
  /** Timestamp the process started at. */
  bootAt: number;
  bootGraceMs: number;
}

export interface SuppressionState {
  /** True when anything at all is silencing the companion. */
  suppressed: boolean;
  /** First reason found, in evaluation order. */
  reason: SuppressionReason | null;
  /** Mute is absolute: it silences `urgent` too (§8.1 step 1). */
  hardMute: boolean;
  /** All active reasons, for the debug panel. */
  reasons: SuppressionReason[];
}

/** §8.5 — the 30 s post-boot blackout. */
export const DEFAULT_BOOT_GRACE_MS = 30_000;
/** The dedicated startup greeting is the one exception, at +25 s. */
export const STARTUP_GREETING_DELAY_MS = 25_000;

export function evaluateSuppression(input: SuppressionInput): SuppressionState {
  const reasons: SuppressionReason[] = [];

  if (input.muted) reasons.push('muted');
  if (input.snoozedUntil !== null && input.now < input.snoozedUntil) reasons.push('snoozed');
  if (
    input.quietHours.enabled &&
    isWithinClockWindow(minutesOfDay(input.now), input.quietHours.from, input.quietHours.to)
  ) {
    reasons.push('quietHours');
  }
  if (input.suppressOnFullscreen && input.fullscreenActive) reasons.push('fullscreen');
  if (input.suppressOnMicrophoneUse && input.microphoneActive) reasons.push('microphone');
  if (input.now - input.bootAt < input.bootGraceMs) reasons.push('bootGrace');

  return {
    suppressed: reasons.length > 0,
    reason: reasons[0] ?? null,
    hardMute: input.muted,
    reasons
  };
}
