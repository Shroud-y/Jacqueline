import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { characterSchema, currentLook, defaultCharacter, MAX_CUSTOM_STATES, type Character, type Visual } from '../src/shared/character';
import { defaultAction, ruleProblems, ruleSentence } from '../src/shared/ruleText';
import type { Rule } from '../src/shared/rules';
import { ActiveStates } from '../src/main/windows/activeStates';

const look = (src: string, name?: string): Visual => ({ type: 'image', src, ...(name ? { name } : {}) });
const states = { idle: look('idle.png'), speaking: look('speak.png'), music: look('music.png'), nap: look('nap.png', 'Сон') };
const nothing = { speaking: false, custom: null, music: false };

describe('currentLook', () => {
  it('puts a line before its own state, its own state before music, music before idle', () => {
    expect(currentLook(states, nothing)).toEqual({ state: 'idle', visual: states.idle });
    expect(currentLook(states, { ...nothing, music: true })).toEqual({ state: 'music', visual: states.music });
    expect(currentLook(states, { ...nothing, music: true, custom: 'nap' })).toEqual({ state: 'nap', visual: states.nap });
    expect(currentLook(states, { speaking: true, music: true, custom: 'nap' })).toEqual({ state: 'speaking', visual: states.speaking });
  });

  it('keeps its own state on through a line it has no look for', () => {
    const { speaking: _speaking, ...silent } = states;
    expect(currentLook(silent, { ...nothing, speaking: true, custom: 'nap' })).toEqual({ state: 'speaking', visual: states.nap });
  });

  it('ignores a state that is gone', () => {
    expect(currentLook(states, { ...nothing, custom: 'gone' })).toEqual({ state: 'idle', visual: states.idle });
  });
});

describe('ActiveStates', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('runs out by itself and says so', () => {
    const ended: string[] = [];
    const active = new ActiveStates((id) => ended.push(id));
    active.set('a', 'nap', 1000);
    expect(active.get('a')).toBe('nap');
    vi.advanceTimersByTime(1000);
    expect(active.get('a')).toBeNull();
    expect(ended).toEqual(['a']);
  });

  it('starts the time again when asked again, and lasts without one', () => {
    const ended: string[] = [];
    const active = new ActiveStates((id) => ended.push(id));
    active.set('a', 'nap', 1000);
    vi.advanceTimersByTime(800);
    active.set('a', 'nap', 1000);
    vi.advanceTimersByTime(800);
    expect(active.get('a')).toBe('nap');
    active.set('a', 'nap', null);
    vi.advanceTimersByTime(10_000);
    expect(active.get('a')).toBe('nap');
    expect(ended).toEqual([]);
  });

  it('forgets on being cleared, or stopped', () => {
    const ended: string[] = [];
    const active = new ActiveStates((id) => ended.push(id));
    active.set('a', 'nap', 1000);
    active.set('a', null, null);
    active.set('b', 'nap', 1000);
    active.stop();
    vi.advanceTimersByTime(2000);
    expect(active.get('a')).toBeNull();
    expect(active.get('b')).toBeNull();
    expect(ended).toEqual([]);
  });
});

describe('a character with states of its own', () => {
  const character = (): Character => {
    const base = defaultCharacter('a', 'A');
    return { ...base, appearance: { ...base.appearance, states } };
  };
  const rule = (state: string | null, seconds: number | null): Rule => ({
    id: 'r',
    name: '',
    enabled: true,
    when: { type: 'clicked' },
    if: [],
    then: [{ type: 'setState', state, seconds }],
    cooldownSec: 0
  });
  const sentence = (of: Rule): string => ruleSentence(of, character()).map((part) => part.text).join('');

  it('reads its names, not its keys', () => {
    expect(sentence(rule('nap', 90))).toContain('change look to Сон for 2 min');
    expect(sentence(rule('nap', null))).toMatch(/change look to Сон$/);
    expect(sentence(rule(null, null))).toContain('go back to its usual look');
  });

  it('says when the state a rule changes to is gone', () => {
    expect(ruleProblems(character(), rule('nap', 5))).toEqual([]);
    expect(ruleProblems(character(), rule(null, null))).toEqual([]);
    expect(ruleProblems(character(), rule('gone', 5))).toHaveLength(1);
  });

  it('starts a new action on a state of its own, and has none to offer without one', () => {
    expect(defaultAction('setState', character())).toEqual({ type: 'setState', state: 'nap', seconds: 10 });
    expect(defaultAction('setState', defaultCharacter('b', 'B'))).toBeNull();
  });

  it('holds a limited number of them, and saves their names', () => {
    const many = (count: number): Character => {
      const own = Object.fromEntries(Array.from({ length: count }, (_, index) => [`state${index}`, look('a.png')]));
      return { ...character(), appearance: { ...character().appearance, states: { idle: look('i.png'), speaking: look('i.png'), music: look('i.png'), ...own } } };
    };
    expect(characterSchema.safeParse(many(MAX_CUSTOM_STATES)).success).toBe(true);
    expect(characterSchema.safeParse(many(MAX_CUSTOM_STATES + 1)).success).toBe(false);
    expect(characterSchema.parse(character()).appearance.states.nap?.name).toBe('Сон');
  });

  it('still reads a character from before there were any', () => {
    const before = { ...character(), appearance: { ...character().appearance, states: { idle: { type: 'image', src: 'i.png' } } } };
    expect(characterSchema.safeParse(before).success).toBe(true);
  });
});
