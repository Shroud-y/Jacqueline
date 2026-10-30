import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ScriptTrust } from '@main/characters/scriptTrust';

let dir: string;
const file = (): string => join(dir, 'script-trust.json');

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jacqueline-trust-'));
});

afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe('which scripts may run', () => {
  it('lets every character run its script until one is blocked, and remembers across starts', () => {
    const trust = new ScriptTrust(file());
    expect(trust.isAllowed('teto')).toBe(true);
    let changes = 0;
    trust.onChange(() => (changes += 1));

    trust.block('teto');
    trust.block('teto');
    expect(trust.isAllowed('teto')).toBe(false);
    expect(new ScriptTrust(file()).isAllowed('teto')).toBe(false);

    trust.allow('teto');
    expect(trust.isAllowed('teto')).toBe(true);
    expect(new ScriptTrust(file()).isAllowed('teto')).toBe(true);
    expect(changes).toBe(2);
  });
});
