import { readFileSync, renameSync, writeFileSync } from 'node:fs';

/** Written beside the target and renamed over it, so a crash mid-write leaves the old file whole. */
export function writeJsonAtomic(filePath: string, value: unknown): void {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8');
  renameSync(tmp, filePath);
}

export function readJson(filePath: string): unknown {
  return JSON.parse(readFileSync(filePath, 'utf8')) as unknown;
}
