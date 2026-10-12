/**
 * §7 — maps an event to candidate phrase groups. Rules are data, in one array,
 * in this file. The engine knows nothing about timing beyond `minIntervalMs`
 * and never touches the overlay.
 */

import type { FocusRemarkId, TopicId } from '@shared/types';
import type { AppEvent, EventPriority } from './events';
import { eventTypeMatches } from './events';
import type { Condition, ConditionContext } from './conditions';
import { evaluateConditions } from './conditions';
import type { PhraseBankIndex } from './phraseBank';
import type { Rng } from './selector';

export interface TriggerRule {
  id: string;
  /**
   * What the line is about, as the user sees it in settings. A rule whose
   * topic is switched off does not fire — and does not roll its dice or
   * start its debounce either, so switching the topic back on finds it fresh.
   */
  topic: TopicId;
  /** Within the active-window topic, which kind of remark this is. */
  focusRemark?: FocusRemarkId;
  /** Event type(s); a trailing '*' is a prefix wildcard. */
  on: string | string[];
  groupId: string;
  /** 0..1, default 1 — probabilistic firing. */
  chance?: number;
  /** Per-rule debounce. */
  minIntervalMs?: number;
  conditions?: Condition[];
}

export interface Candidate {
  ruleId: string;
  groupId: string;
  category: string;
  priority: EventPriority;
  event: AppEvent;
}

const MINUTE = 60_000;

/** The kind of application on a `process.*` event — see `WatchedApp`. */
const kindIs = (kind: string): Condition => ({ kind: 'payloadString', path: 'kind', equals: kind });

/* ------------------------------------------------------------------ */
/* Focus rules — one phrase group per thing that can be in front.       */
/* ------------------------------------------------------------------ */

const activityIs = (activity: string): Condition => ({ kind: 'payloadString', path: 'activity', equals: activity });

/**
 * Activities with their own "settled in" lines, and how often to take the
 * chance. The ones that say something about the user get most of them; the
 * ones that are merely where the user happens to be are kept rare, or the
 * companion narrates every alt-tab.
 *
 * `game` is absent on purpose: starting a game is already covered by the
 * process rules, and a fullscreen game suppresses speech anyway.
 */
const FOCUS_ENTER: Record<string, number> = {
  coding: 0.5,
  terminal: 0.4,
  research: 0.5,
  ai: 0.7,
  video: 0.6,
  social: 0.6,
  chat: 0.35,
  music: 0.4,
  creative: 0.5,
  writing: 0.4,
  office: 0.4,
  mail: 0.4,
  shopping: 0.6,
  files: 0.2,
  browsing: 0.2,
  other: 0.3
};

/** Activities whose long stretches have lines of their own; the rest share `generic`. */
const FOCUS_LONG_SPECIFIC = ['coding', 'video', 'social', 'game'];

/** Tools as `Tool` in `activity.ts` names them. */
const FOCUS_TOOLS = ['taskmgr', 'regedit', 'calculator', 'settings', 'installer', 'screenshot', 'self'];

const FOCUS_RULES: TriggerRule[] = [
  ...Object.entries(FOCUS_ENTER).map(
    ([activity, chance]): TriggerRule => ({
      id: `focus.enter.${activity}`,
      topic: 'activeWindow',
      focusRemark: 'settling',
      on: 'focus.enter',
      groupId: `focus.enter.${activity}`,
      chance,
      minIntervalMs: 10 * MINUTE,
      conditions: [activityIs(activity)]
    })
  ),

  // The slide from work into something else, and the way back, are the two
  // moments that most read as "it noticed" — neither is left to chance much.
  { id: 'focus.drift', topic: 'activeWindow', focusRemark: 'drift', on: 'focus.drift', groupId: 'focus.drift', chance: 0.9 },
  { id: 'focus.return', topic: 'activeWindow', focusRemark: 'drift', on: 'focus.return', groupId: 'focus.return', chance: 0.8 },

  ...FOCUS_LONG_SPECIFIC.map(
    (activity): TriggerRule => ({
      id: `focus.long.${activity}`,
      topic: 'activeWindow',
      focusRemark: 'long',
      on: 'focus.long',
      groupId: `focus.long.${activity}`,
      conditions: [activityIs(activity)]
    })
  ),
  {
    id: 'focus.long.generic',
    topic: 'activeWindow',
    focusRemark: 'long',
    on: 'focus.long',
    groupId: 'focus.long.generic',
    chance: 0.7,
    // Nothing to admire about a long time in a file manager or an unknown window.
    conditions: [
      { kind: 'payloadString', path: 'activity', noneOf: [...FOCUS_LONG_SPECIFIC, 'files', 'browsing', 'other'] }
    ]
  },

  {
    id: 'focus.restless',
    topic: 'activeWindow',
    focusRemark: 'restless',
    on: 'focus.restless',
    groupId: 'focus.restless',
    minIntervalMs: 30 * MINUTE
  },
  {
    id: 'focus.hung',
    topic: 'activeWindow',
    focusRemark: 'restless',
    on: 'focus.hung',
    groupId: 'focus.hung',
    minIntervalMs: 5 * MINUTE
  },

  ...FOCUS_TOOLS.map(
    (tool): TriggerRule => ({
      id: `focus.tool.${tool}`,
      topic: 'activeWindow',
      focusRemark: 'tools',
      on: 'focus.tool',
      groupId: `focus.tool.${tool}`,
      chance: 0.8,
      minIntervalMs: 20 * MINUTE,
      conditions: [{ kind: 'payloadString', path: 'tool', equals: tool }]
    })
  )
];

/**
 * `chance` is what keeps ambient reactions from feeling mechanical — the
 * companion should read as having noticed, not as having polled.
 */
export const TRIGGER_RULES: TriggerRule[] = [
  // ---- greetings ---------------------------------------------------
  { id: 'startup', topic: 'greetings', on: 'session.startup', groupId: 'greeting.startup' },
  { id: 'resume', topic: 'greetings', on: 'session.resume', groupId: 'greeting.return', chance: 0.8 },
  {
    id: 'idle.exit.long',
    topic: 'greetings',
    on: 'session.idle.exit',
    groupId: 'greeting.return',
    conditions: [{ kind: 'payloadNumber', path: 'awayMs', gt: 30 * MINUTE }]
  },
  {
    id: 'idle.exit.short',
    topic: 'greetings',
    on: 'session.idle.exit',
    groupId: 'greeting.return',
    chance: 0.4,
    conditions: [{ kind: 'payloadNumber', path: 'awayMs', lt: 30 * MINUTE }]
  },
  { id: 'idle.enter', topic: 'greetings', on: 'session.idle.enter', groupId: 'idle.enter', chance: 0.4 },
  { id: 'lock', topic: 'greetings', on: 'session.lock', groupId: 'session.lock', chance: 0.35 },
  { id: 'unlock', topic: 'greetings', on: 'session.unlock', groupId: 'greeting.return', chance: 0.5 },

  // ---- system health -----------------------------------------------
  { id: 'cpu.high', topic: 'system', on: 'system.cpu.high', groupId: 'system.cpu', chance: 0.5 },
  { id: 'cpu.sustained', topic: 'system', on: 'system.cpu.sustained', groupId: 'system.cpu' },
  { id: 'memory.high', topic: 'system', on: 'system.memory.high', groupId: 'system.memory', chance: 0.7 },
  { id: 'temperature.high', topic: 'system', on: 'system.temperature.high', groupId: 'system.thermal' },
  { id: 'disk.low', topic: 'system', on: 'system.disk.low', groupId: 'system.disk' },
  { id: 'battery.low', topic: 'system', on: 'system.battery.low', groupId: 'system.battery' },

  // ---- apps and games ----------------------------------------------
  // One pair of rules per kind of application. The kind is on the event
  // because it is on the watch-list entry: the user says what a thing is.
  ...(
    [
      ['app', '', 0.35],
      ['launcher', '.gameLauncher', 0.4],
      ['notable', '.notable', 0.4],
      ['game', '.game', 0.4]
    ] as const
  ).flatMap(([kind, suffix, chance]) =>
    (['started', 'stopped'] as const).map(
      (edge): TriggerRule => ({
        id: `process.${edge}${suffix}`,
        topic: 'apps',
        on: `process.${edge}`,
        groupId: `process.${edge}${suffix}`,
        chance,
        minIntervalMs: 10 * MINUTE,
        conditions: [kindIs(kind)]
      })
    )
  ),
  {
    id: 'process.longRunning',
    topic: 'apps',
    on: 'process.longRunning',
    groupId: 'process.longRunning',
    chance: 0.6
  },

  // ---- time of day -------------------------------------------------
  { id: 'schedule.morning', topic: 'timeOfDay', on: 'schedule.morning', groupId: 'time.morning' },
  { id: 'schedule.evening', topic: 'timeOfDay', on: 'schedule.evening', groupId: 'time.evening' },
  { id: 'schedule.night', topic: 'timeOfDay', on: 'schedule.night', groupId: 'time.night' },
  { id: 'schedule.hourly', topic: 'timeOfDay', on: 'schedule.hourly', groupId: 'time.hourly', chance: 0.25 },

  // ---- break reminders ---------------------------------------------
  { id: 'schedule.workBreak', topic: 'breaks', on: 'schedule.workBreak', groupId: 'wellbeing.break' },
  { id: 'schedule.uptime', topic: 'breaks', on: 'schedule.uptimeMilestone', groupId: 'wellbeing.uptime' },

  // ---- idle chatter ------------------------------------------------
  // No `chance`: the monitor's silence timer is already the gate, and rolling
  // dice on top would turn "occasionally" into "almost never".
  { id: 'schedule.quiet', topic: 'chatter', on: 'schedule.quiet', groupId: 'chatter.idle' },

  // ---- the active window -------------------------------------------
  ...FOCUS_RULES,

  // ---- downloads ---------------------------------------------------
  {
    id: 'file.download',
    topic: 'downloads',
    on: 'file.downloadComplete',
    groupId: 'file.download',
    chance: 0.6,
    minIntervalMs: 5 * MINUTE
  },
  // Dormant: nothing emits `file.buildComplete` — the file monitor is given no
  // build folders, because "a new file appeared" is too weak a sign that a
  // build finished. Kept so the group in the bank still has a rule.
  { id: 'file.build', topic: 'downloads', on: 'file.buildComplete', groupId: 'file.build' }
];

export interface TriggerEngineOptions {
  rules?: TriggerRule[];
  rng?: Rng;
  /**
   * Whether the user has this rule's topic switched on. Asked on every event,
   * so a change in settings takes effect on the next one. Absent means
   * everything is on.
   */
  isEnabled?: (rule: TriggerRule) => boolean;
}

export class TriggerEngine {
  private readonly rules: TriggerRule[];
  private readonly rng: Rng;
  private readonly isEnabled: (rule: TriggerRule) => boolean;
  private readonly lastFiredAt = new Map<string, number>();

  private bank: PhraseBankIndex;

  constructor(bank: PhraseBankIndex, options: TriggerEngineOptions = {}) {
    this.bank = bank;
    this.rules = options.rules ?? TRIGGER_RULES;
    this.rng = options.rng ?? Math.random;
    this.isEnabled = options.isEnabled ?? (() => true);
  }

  /** Swaps the active bank when the active preset changes, no restart needed. */
  setBank(bank: PhraseBankIndex): void {
    this.bank = bank;
  }

  /** Rules pointing at a group the bank does not define. Checked at startup. */
  danglingRules(): { ruleId: string; groupId: string }[] {
    return this.rules
      .filter((rule) => this.bank.group(rule.groupId) === undefined)
      .map((rule) => ({ ruleId: rule.id, groupId: rule.groupId }));
  }

  match(event: AppEvent, ctx: Omit<ConditionContext, 'payload' | 'now'>): Candidate[] {
    const candidates: Candidate[] = [];

    for (const rule of this.rules) {
      const patterns = Array.isArray(rule.on) ? rule.on : [rule.on];
      if (!patterns.some((pattern) => eventTypeMatches(pattern, event.type))) continue;

      // Before the debounce and the dice: a rule that is switched off must
      // not spend either.
      if (!this.isEnabled(rule)) continue;

      if (rule.minIntervalMs !== undefined) {
        const last = this.lastFiredAt.get(rule.id);
        if (last !== undefined && event.at - last < rule.minIntervalMs) continue;
      }

      const conditionCtx: ConditionContext = { ...ctx, now: event.at, payload: event.payload };
      if (!evaluateConditions(rule.conditions, conditionCtx)) continue;

      if (rule.chance !== undefined && rule.chance < 1 && this.rng() >= rule.chance) continue;

      const group = this.bank.group(rule.groupId);
      if (!group) continue;

      this.lastFiredAt.set(rule.id, event.at);
      candidates.push({
        ruleId: rule.id,
        groupId: group.id,
        category: group.category,
        priority: event.priority,
        event
      });
    }

    return candidates;
  }
}
