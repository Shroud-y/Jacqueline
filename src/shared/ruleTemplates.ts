/**
 * Rules to start from: a rule and the group of lines it says from, made in
 * one click and then changed like any other. Pure, so what each one makes is
 * tested without the editor.
 */

import type { Character, Line } from './character';
import { freeGroupName } from './lines';
import type { Rule, RuleAction, RuleCondition, Trigger } from './rules';
import { freeRuleId, likelyProgram } from './ruleText';

export interface RuleTemplate {
  id: string;
  title: string;
  /** One line on what it does, for the list. */
  hint: string;
}

interface Recipe extends RuleTemplate {
  /** The group's name it would like, and its lines; null for a rule that says nothing from a group. */
  group: { name: string; lines: string[] } | null;
  rule: (character: Character, group: string) => { name: string; when: Trigger; if?: RuleCondition[]; then: RuleAction[]; cooldownSec?: number };
}

const RECIPES: Recipe[] = [
  {
    id: 'greet-program',
    title: 'Say hello when a program starts',
    hint: 'Pick the program after; a line now and then, not every time it opens.',
    group: { name: 'Hello', lines: ['There you are.', '{program}, again? Have fun.', 'Good luck in there.'] },
    rule: (character, group) => ({
      name: 'Hello',
      when: { type: 'programStarted', program: likelyProgram(character) },
      then: [{ type: 'say', group }],
      cooldownSec: 600
    })
  },
  {
    id: 'bedtime',
    title: 'Send me to bed',
    hint: 'Every night at 23:30.',
    group: { name: 'Bedtime', lines: ['It is {time}. Bed.', 'Still up? It is {time}.', 'Tomorrow will thank you. Go to sleep.'] },
    rule: (_character, group) => ({ name: 'Bedtime', when: { type: 'time', at: '23:30' }, then: [{ type: 'say', group }] })
  },
  {
    id: 'poke',
    title: 'Answer a click, sometimes',
    hint: 'Half the time, at most every few seconds.',
    group: { name: 'Poke', lines: ['Yes?', 'Hm?', 'That tickles.', 'I am working here.'] },
    rule: (_character, group) => ({
      name: 'Poke',
      when: { type: 'clicked' },
      if: [{ type: 'chance', percent: 50 }],
      then: [{ type: 'say', group }],
      cooldownSec: 5
    })
  },
  {
    id: 'welcome-back',
    title: 'Welcome me back',
    hint: 'When you come back after a quarter of an hour away.',
    group: { name: 'Welcome back', lines: ['Back after {minutes} minutes.', 'Welcome back.', 'There you are again.'] },
    rule: (_character, group) => ({ name: 'Welcome back', when: { type: 'returned', afterMinutes: 15 }, then: [{ type: 'say', group }] })
  },
  {
    id: 'chatter',
    title: 'Say something now and then',
    hint: 'Somewhere between every 30 and 60 minutes, in the daytime.',
    group: { name: 'Chatter', lines: ['Still here.', 'Have some water.', 'Look away from the screen for a bit.'] },
    rule: (_character, group) => ({
      name: 'Chatter',
      when: { type: 'every', minMinutes: 30, maxMinutes: 60 },
      if: [{ type: 'timeBetween', from: '09:00', to: '22:00' }],
      then: [{ type: 'say', group }]
    })
  },
  {
    id: 'build',
    title: 'React to a build',
    hint: 'When a build script runs Jacqueline.exe --signal build-ok; Copy command is in the rule.',
    group: null,
    rule: () => ({
      name: 'Build done',
      when: { type: 'signal', name: 'build-ok' },
      then: [
        { type: 'sayText', text: 'Built. {text}' },
        { type: 'show', seconds: 6, place: 'usual' }
      ]
    })
  }
];

export const RULE_TEMPLATES: readonly RuleTemplate[] = RECIPES.map(({ id, title, hint }) => ({ id, title, hint }));

/** The character with the template's rule — and its group of lines, under a name not taken — added; null for no such template. */
export function applyTemplate(character: Character, templateId: string): { character: Character; rule: Rule } | null {
  const recipe = RECIPES.find((entry) => entry.id === templateId);
  if (!recipe) return null;
  let lines = character.lines;
  let group = '';
  if (recipe.group) {
    group = freeGroupName(character, recipe.group.name);
    const made: Line[] = recipe.group.lines.map((text, index) => ({ id: `line-${index + 1}`, text }));
    lines = { ...lines, [group]: made };
  }
  const shape = recipe.rule(character, group);
  const rule: Rule = {
    id: freeRuleId(character.rules),
    name: shape.name,
    enabled: true,
    when: shape.when,
    if: shape.if ?? [],
    then: shape.then,
    cooldownSec: shape.cooldownSec ?? 0
  };
  return { character: { ...character, lines, rules: [...character.rules, rule] }, rule };
}
