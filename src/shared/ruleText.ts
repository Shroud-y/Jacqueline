/**
 * Rules as the editor shows and builds them: one sentence for what a rule
 * does, a quieter line for what limits it, what is wrong with it, and the
 * values a part starts with when it is picked. Pure.
 */

import type { Character } from './character';
import type { Rule, RuleAction, RuleCondition, Trigger } from './rules';

/** A run of a sentence; `strong` runs are what the user filled in. */
export interface Part {
  text: string;
  strong?: boolean;
}

const plain = (text: string): Part => ({ text });
const strong = (text: string): Part => ({ text, strong: true });

/* ------------------------------------------------------------------ */
/* Words                                                               */
/* ------------------------------------------------------------------ */

export const TRIGGER_LABELS: Record<Trigger['type'], string> = {
  programStarted: 'A program starts',
  programStopped: 'A program closes',
  programFocused: 'A program comes to the front',
  time: 'Every day at a time',
  every: 'Every so often',
  returned: 'You come back to the computer',
  startup: 'Jacqueline starts',
  clicked: 'The character is clicked'
};

export const CONDITION_LABELS: Record<RuleCondition['type'], string> = {
  chance: 'By chance',
  timeBetween: 'Between two times',
  programRunning: 'A program'
};

export const ACTION_LABELS: Record<RuleAction['type'], string> = {
  say: 'Say a line',
  sound: 'Play a sound',
  show: 'Come out for a while',
  hide: 'Hide for a while'
};

/** "45 s", "10 min", "2 h", "1 h 30 min". */
export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} s`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

function triggerParts(trigger: Trigger): Part[] {
  switch (trigger.type) {
    case 'programStarted':
      return [plain('When '), strong(trigger.program), plain(' starts')];
    case 'programStopped':
      return [plain('When '), strong(trigger.program), plain(' closes')];
    case 'programFocused':
      return [plain('When '), strong(trigger.program), plain(' comes to the front')];
    case 'time':
      return [plain('Every day at '), strong(trigger.at)];
    case 'every':
      return [
        plain('Every '),
        strong(trigger.minMinutes === trigger.maxMinutes ? `${trigger.minMinutes}` : `${trigger.minMinutes}–${trigger.maxMinutes}`),
        plain(' minutes')
      ];
    case 'returned':
      return [plain('When you are back after '), strong(`${trigger.afterMinutes} min`), plain(' away')];
    case 'startup':
      return [plain('When Jacqueline starts')];
    case 'clicked':
      return [plain('When it is clicked')];
  }
}

function actionParts(action: RuleAction): Part[] {
  switch (action.type) {
    case 'say':
      return [plain('say a line from '), strong(action.group)];
    case 'sound':
      return [plain('play '), strong(action.file)];
    case 'show':
      return [plain('come out for '), strong(formatDuration(action.seconds))];
    case 'hide':
      return [plain('hide for '), strong(formatDuration(action.minutes * 60))];
  }
}

/** "When **dota2.exe** starts → say a line from **greet** and play **hi.ogg**" */
export function ruleSentence(rule: Rule): Part[] {
  const parts = [...triggerParts(rule.when), plain(' → ')];
  rule.then.forEach((action, index) => {
    if (index > 0) parts.push(plain(index === rule.then.length - 1 ? ' and ' : ', '));
    parts.push(...actionParts(action));
  });
  return parts;
}

function conditionText(condition: RuleCondition): string {
  switch (condition.type) {
    case 'chance':
      return `${condition.percent} %`;
    case 'timeBetween':
      return `${condition.from}–${condition.to}`;
    case 'programRunning':
      return condition.running ? `while ${condition.program} runs` : `unless ${condition.program} runs`;
  }
}

/** What holds the rule back, quietly: "50 % · 09:00–18:00 · at most every 10 min". */
export function ruleDetail(rule: Rule): string {
  const bits = rule.if.map(conditionText);
  if (rule.cooldownSec > 0) bits.push(`at most every ${formatDuration(rule.cooldownSec)}`);
  return bits.join(' · ');
}

/**
 * Why the rule will not do all it says, or nothing. `assets` is what the
 * character's folder holds; without it, sound files are not checked.
 */
export function ruleProblems(character: Character, rule: Rule, assets?: ReadonlySet<string>): string[] {
  const problems: string[] = [];
  for (const action of rule.then) {
    if (action.type === 'say') {
      const lines = character.lines[action.group];
      if (!lines) problems.push(`There is no group of lines called "${action.group}".`);
      else if (lines.length === 0) problems.push(`"${action.group}" has no lines yet.`);
    } else if (action.type === 'sound' && assets && !assets.has(action.file)) {
      problems.push(`${action.file} is not in the character's folder.`);
    }
  }
  return problems;
}

/* ------------------------------------------------------------------ */
/* Starting values                                                     */
/* ------------------------------------------------------------------ */

/** The program a new program trigger or condition starts with: one the character already knows. */
export function likelyProgram(character: Character): string {
  for (const rule of character.rules) if ('program' in rule.when) return rule.when.program;
  return character.presence.apps[0] ?? 'notepad.exe';
}

export function defaultTrigger(type: Trigger['type'], character: Character): Trigger {
  switch (type) {
    case 'programStarted':
    case 'programStopped':
    case 'programFocused':
      return { type, program: likelyProgram(character) };
    case 'time':
      return { type, at: '09:00' };
    case 'every':
      return { type, minMinutes: 20, maxMinutes: 40 };
    case 'returned':
      return { type, afterMinutes: 15 };
    case 'startup':
    case 'clicked':
      return { type };
  }
}

export function defaultCondition(type: RuleCondition['type'], character: Character): RuleCondition {
  switch (type) {
    case 'chance':
      return { type, percent: 50 };
    case 'timeBetween':
      return { type, from: '09:00', to: '18:00' };
    case 'programRunning':
      return { type, program: likelyProgram(character), running: true };
  }
}

/**
 * Null for a sound: it needs a file chosen first. Null for a line too while
 * the character has no groups to say one from.
 */
export function defaultAction(type: RuleAction['type'], character: Character): RuleAction | null {
  switch (type) {
    case 'say': {
      const group = Object.keys(character.lines)[0];
      return group === undefined ? null : { type, group };
    }
    case 'sound':
      return null;
    case 'show':
      return { type, seconds: 10 };
    case 'hide':
      return { type, minutes: 30 };
  }
}

export function freeRuleId(rules: readonly Rule[]): string {
  const taken = new Set(rules.map((rule) => rule.id));
  for (let n = rules.length + 1; ; n += 1) if (!taken.has(`rule-${n}`)) return `rule-${n}`;
}

/** When it is clicked → say a line from the first group; with no groups yet, come out for a while. */
export function newRule(character: Character): Rule {
  return {
    id: freeRuleId(character.rules),
    name: '',
    enabled: true,
    when: { type: 'clicked' },
    if: [],
    then: [defaultAction('say', character) ?? { type: 'show', seconds: 10 }],
    cooldownSec: 0
  };
}

/** The rule's own name, or what it is for a person to tell it by. */
export function ruleTitle(rule: Rule): string {
  return rule.name.trim() || ruleSentence(rule).map((part) => part.text).join('');
}
