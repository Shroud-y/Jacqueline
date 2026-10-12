import type { CompanionStatus, SilenceReason } from './types';

/**
 * What the character is doing right now, in words — the same words in the
 * tray tooltip and at the top of the settings window, so the two can never
 * tell the user different things. Dependency-free and pure.
 */

function clock(epochMs: number): string {
  const date = new Date(epochMs);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** One reason, as a short phrase that completes "It is quiet because it is …". */
export function describeReason(reason: SilenceReason, status: CompanionStatus): string {
  switch (reason) {
    case 'muted':
      return 'Muted';
    case 'snoozed':
      if (status.snoozedUntilRestart) return 'Snoozed until restart';
      return status.snoozedUntil !== null ? `Snoozed until ${clock(status.snoozedUntil)}` : 'Snoozed';
    case 'quietHours':
      return status.quietUntil ? `Quiet hours until ${status.quietUntil}` : 'Quiet hours';
    case 'fullscreen':
      return 'Stepping aside for a fullscreen app';
    case 'microphone':
      return 'Silent while the microphone is in use';
  }
}

/** The headline: the reason that matters most, or that nothing is in the way. */
export function describeStatus(status: CompanionStatus): string {
  const first = status.reasons[0];
  return first ? describeReason(first, status) : 'Active';
}

/** Everything else that would also keep it quiet once the headline reason lifts. */
export function describeOtherReasons(status: CompanionStatus): string[] {
  return status.reasons.slice(1).map((reason) => describeReason(reason, status));
}

/**
 * The order reasons are reported in: what the user did on purpose first, then
 * what the clock is doing, then what the machine is doing. It is also the
 * order in which lifting one would matter.
 */
export const REASON_ORDER: readonly SilenceReason[] = ['muted', 'snoozed', 'quietHours', 'fullscreen', 'microphone'];
