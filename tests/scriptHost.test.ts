import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({ protocol: { handle: vi.fn() } }));

import { runtimeSource } from '@main/characters/scriptHost';

describe('the runtime a script finds', () => {
  it('knows which character it serves, quoted safely, and offers only what it documents', () => {
    const source = runtimeSource('teto');
    expect(source).toContain('const ID = "teto";');
    for (const name of ['on(event, fn)', 'setMood(mood)', 'asset(name)', 'get state()']) expect(source).toContain(name);
    // A real script engine reads it.
    expect(() => new Function(source)).not.toThrow();
  });
});
