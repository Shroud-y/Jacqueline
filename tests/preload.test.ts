import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '@shared/ipc';

/**
 * The preload writes its channel names out literally (see the note at the top
 * of it for why). This is what stops the two lists drifting apart.
 */
describe('stage preload', () => {
  const source = readFileSync(join(process.cwd(), 'src/preload/stage.ts'), 'utf8');
  const literal = source.slice(source.indexOf('const CHANNEL = {'), source.indexOf('} as const'));
  const declared = Object.fromEntries(
    [...literal.matchAll(/(\w+): '([^']+)'/g)].map((match) => [match[1], match[2]])
  );

  it('names every stage channel exactly as `IPC` does', () => {
    const stage = Object.fromEntries(Object.entries(IPC).filter(([key]) => key.startsWith('stage')));
    expect(declared).toEqual(stage);
  });

  it('imports nothing at runtime but electron', () => {
    const valueImports = [...source.matchAll(/^import (?!type)[^;]*from '([^']+)'/gm)].map((match) => match[1]);
    expect(valueImports).toEqual(['electron']);
  });
});
