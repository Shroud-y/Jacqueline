import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { PhraseSegment } from '@shared/types';
import { parsePhraseBank } from '@main/core/phraseBank';
import { fillSegments, fillSlots } from '@main/core/slots';

describe('fillSlots', () => {
  it('fills a slot from the payload', () => {
    expect(fillSlots('{subject}. I will note the time.', { subject: 'YouTube' })).toBe('YouTube. I will note the time.');
  });

  it('fills several, and reads dotted paths', () => {
    expect(fillSlots('{minutes} minutes of {app.name}.', { minutes: 90, app: { name: 'code' } })).toBe('90 minutes of code.');
  });

  it('rounds numbers to whole ones', () => {
    expect(fillSlots('{minutes} minutes.', { minutes: 44.6 })).toBe('45 minutes.');
  });

  it('leaves text without slots untouched', () => {
    expect(fillSlots('Nothing to fill.', undefined)).toBe('Nothing to fill.');
  });

  it('refuses rather than leave a hole', () => {
    expect(fillSlots('{subject} again.', {})).toBeNull();
    expect(fillSlots('{subject} again.', { subject: '   ' })).toBeNull();
    expect(fillSlots('{subject} again.', { subject: { nested: true } })).toBeNull();
    expect(fillSlots('{subject} again.', undefined)).toBeNull();
    expect(fillSlots('{minutes} minutes.', { minutes: Number.NaN })).toBeNull();
  });
});

describe('fillSegments', () => {
  const segments: PhraseSegment[] = [
    { text: '{app} has frozen.', mode: 'normal' },
    { text: 'UNACCEPTABLE, {app}', mode: 'rage' },
    { text: '— give it a moment.', mode: 'normal' }
  ];

  it('fills every segment and shouts what goes into a rage segment', () => {
    expect(fillSegments(segments, { app: 'Chrome' })).toEqual([
      { text: 'Chrome has frozen.', mode: 'normal' },
      { text: 'UNACCEPTABLE, CHROME', mode: 'rage' },
      { text: '— give it a moment.', mode: 'normal' }
    ]);
  });

  it('is all or nothing', () => {
    expect(fillSegments(segments, {})).toBeNull();
  });

  it('hands back the same segment objects when there was nothing to fill', () => {
    const plain: PhraseSegment[] = [{ text: 'Still here.', mode: 'normal' }];
    expect(fillSegments(plain, undefined)?.[0]).toBe(plain[0]);
  });
});

describe('shipped bank slots', () => {
  const bank = parsePhraseBank(
    JSON.parse(readFileSync(join(process.cwd(), 'resources/phrases/bank.json'), 'utf8'))
  );

  /** What the focus monitor puts on each kind of event — see `FocusPayload`. */
  const base = { activity: 'video', app: 'Chrome', site: 'YouTube', subject: 'YouTube' };
  const payloadFor = (groupId: string): Record<string, unknown> | undefined => {
    if (!groupId.startsWith('focus.')) return undefined;
    if (groupId === 'focus.restless') return { ...base, count: 12 };
    if (groupId === 'focus.drift' || groupId === 'focus.return' || groupId.startsWith('focus.long.')) {
      return { ...base, minutes: 90 };
    }
    return base;
  };

  it('can fill every phrase from the event that triggers its group', () => {
    // A phrase the director can never fill is dead weight that looks alive:
    // it sits in the bank, passes the schema, and is silently never said.
    const unfillable: string[] = [];
    for (const group of bank.groups) {
      for (const phrase of group.phrases) {
        if (fillSegments(phrase.segments, payloadFor(group.id)) === null) unfillable.push(phrase.id);
      }
    }
    expect(unfillable).toEqual([]);
  });

  it('leaves no brace behind in any filled focus line', () => {
    for (const group of bank.groups.filter((entry) => entry.id.startsWith('focus.'))) {
      for (const phrase of group.phrases) {
        const text = fillSegments(phrase.segments, payloadFor(group.id))?.map((segment) => segment.text).join(' ');
        expect(text).not.toMatch(/[{}]/);
      }
    }
  });
});
