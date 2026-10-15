import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINGER_MS, QUEUE_MAX, SpeechDirector, WAIT_MS } from '@main/engine/director';
import { MAX_DURATION_MS, MIN_DURATION_MS, computeDurationMs } from '@shared/speechTiming';

beforeEach(() => vi.useFakeTimers({ now: 1_000_000 }));
afterEach(() => vi.useRealTimers());

const director = (): { d: SpeechDirector; changes: string[] } => {
  const d = new SpeechDirector(() => Date.now());
  const changes: string[] = [];
  d.onChange((id) => changes.push(`${id}:${d.current(id)?.text ?? '-'}`));
  return { d, changes };
};

describe('speech timing', () => {
  it('gives a short line the least time, a long one the most, and the rest by length', () => {
    expect(computeDurationMs('Hi.')).toBe(MIN_DURATION_MS);
    expect(computeDurationMs('x'.repeat(2000))).toBe(MAX_DURATION_MS);
    expect(computeDurationMs('x'.repeat(200))).toBeGreaterThan(computeDurationMs('x'.repeat(100)));
  });
});

describe('SpeechDirector', () => {
  it('says a line for as long as it takes, then is quiet', () => {
    const { d, changes } = director();
    d.say('a', 'Hello.');
    expect(d.current('a')?.text).toBe('Hello.');
    vi.advanceTimersByTime(computeDurationMs('Hello.') - 1);
    expect(d.isSpeaking('a')).toBe(true);
    vi.advanceTimersByTime(1);
    expect(d.isSpeaking('a')).toBe(false);
    expect(changes).toEqual(['a:Hello.', 'a:-']);
  });

  it('keeps each character to one line at a time, without holding up the others', () => {
    const { d } = director();
    d.say('a', 'One.');
    d.say('b', 'Other.');
    d.say('a', 'Two.');
    expect([d.current('a')?.text, d.current('b')?.text]).toEqual(['One.', 'Other.']);
    vi.advanceTimersByTime(computeDurationMs('One.'));
    expect(d.current('a')?.text).toBe('Two.');
  });

  it('drops a waiting line that has gone stale', () => {
    const { d } = director();
    d.say('a', 'x'.repeat(2000)); // as long as a line gets
    d.say('a', 'Late.');
    vi.advanceTimersByTime(MAX_DURATION_MS);
    // The wait was shorter than WAIT_MS, so it is said.
    expect(d.current('a')?.text).toBe('Late.');

    d.dismiss('a');
    d.say('a', 'Busy.');
    d.say('a', 'Stale.');
    vi.advanceTimersByTime(WAIT_MS + 1);
    expect(d.isSpeaking('a')).toBe(false);
  });

  it('lets only a few lines wait, and the oldest gives way', () => {
    const { d } = director();
    d.say('a', 'Now.');
    for (let i = 1; i <= QUEUE_MAX + 2; i++) d.say('a', `Later ${i}.`);
    vi.advanceTimersByTime(computeDurationMs('Now.'));
    expect(d.current('a')?.text).toBe(`Later ${3}.`);
  });

  it('dismisses the line and everything behind it', () => {
    const { d } = director();
    d.say('a', 'Now.');
    d.say('a', 'Next.');
    d.dismiss('a');
    expect(d.isSpeaking('a')).toBe(false);
    vi.advanceTimersByTime(MAX_DURATION_MS);
    expect(d.isSpeaking('a')).toBe(false);
  });

  it('stays on stage a moment after the line, for it to leave, and says when that is over', () => {
    const { d, changes } = director();
    d.say('a', 'Bye.');
    vi.advanceTimersByTime(computeDurationMs('Bye.'));
    expect(d.isOnStage('a')).toBe(true);
    vi.advanceTimersByTime(LINGER_MS);
    expect(d.isOnStage('a')).toBe(false);
    expect(changes).toEqual(['a:Bye.', 'a:-', 'a:-']);
  });

  it('silences everyone at once', () => {
    const { d } = director();
    d.say('a', 'One.');
    d.say('b', 'Two.');
    d.silenceAll();
    expect([d.isSpeaking('a'), d.isSpeaking('b')]).toEqual([false, false]);
  });

  it('forgets a character entirely', () => {
    const { d } = director();
    d.say('a', 'One.');
    d.say('a', 'Two.');
    d.forget('a');
    vi.advanceTimersByTime(MAX_DURATION_MS * 2);
    expect(d.isSpeaking('a')).toBe(false);
    expect(d.isOnStage('a')).toBe(false);
  });
});
