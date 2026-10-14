import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { IPC } from '@shared/ipc';

/**
 * Each preload writes its channel names out literally (see the note at the
 * top of `stage.ts` for why). This is what stops them drifting from `IPC`.
 */
describe.each(['stage', 'editor'])('%s preload', (name) => {
  const source = readFileSync(join(process.cwd(), `src/preload/${name}.ts`), 'utf8');
  const literal = source.slice(source.indexOf('const CHANNEL = {'), source.indexOf('} as const'));
  const declared = Object.fromEntries(
    [...literal.matchAll(/(\w+): '([^']+)'/g)].map((match) => [match[1], match[2]])
  );

  it('names every one of its channels exactly as `IPC` does', () => {
    const own = Object.fromEntries(Object.entries(IPC).filter(([key]) => key.startsWith(name)));
    expect(Object.keys(own).length).toBeGreaterThan(0);
    expect(declared).toEqual(own);
  });

  it('imports nothing at runtime but electron', () => {
    const valueImports = [...source.matchAll(/^import (?!type)[^;]*from '([^']+)'/gm)].map((match) => match[1]);
    expect(valueImports).toEqual(['electron']);
  });
});
