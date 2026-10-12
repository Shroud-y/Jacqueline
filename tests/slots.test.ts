import { describe, expect, it } from 'vitest';
import { fillSlots } from '@main/engine/slots';

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
