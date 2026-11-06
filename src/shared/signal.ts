/**
 * A signal from outside: `Jacqueline.exe --signal build-ok --text "3 errors"`,
 * run by a build script, a task, anything that can start a program. The
 * process that carries it hands it to the running app and exits. Pure, so the
 * parsing is tested without a second process.
 */

import { z } from 'zod';

export const SIGNAL_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;
export const SIGNAL_TEXT_MAX = 200;

export const signalNameSchema = z.string().regex(SIGNAL_NAME, 'a signal name is letters, digits, - _ and . — like build-ok');

export interface Signal {
  name: string;
  /** For a line's `{text}`; null when none was given. */
  text: string | null;
}

/** What a command line asks for: a signal, a broken one (with why), or none at all. */
export type SignalArgs = { kind: 'none' } | { kind: 'signal'; signal: Signal } | { kind: 'invalid'; error: string };

/** Reads `--signal <name>` / `--signal=<name>` and `--text <text>` / `--text=<text>` from argv. */
export function parseSignalArgs(argv: readonly string[]): SignalArgs {
  const name = valueOf(argv, '--signal');
  if (name === undefined) return { kind: 'none' };
  if (name === null || !SIGNAL_NAME.test(name)) return { kind: 'invalid', error: `not a valid signal name: ${name ?? '(missing)'}` };
  const text = valueOf(argv, '--text');
  const trimmed = text?.trim() ?? '';
  return { kind: 'signal', signal: { name, text: trimmed === '' ? null : trimmed.slice(0, SIGNAL_TEXT_MAX) } };
}

/** Whatever a second instance passed along, if it is a signal at all. Never trusted as it comes. */
export function signalFromData(data: unknown): Signal | null {
  if (typeof data !== 'object' || data === null) return null;
  const { signal } = data as { signal?: unknown };
  if (typeof signal !== 'object' || signal === null) return null;
  const { name, text } = signal as { name?: unknown; text?: unknown };
  if (typeof name !== 'string' || !SIGNAL_NAME.test(name)) return null;
  const clean = typeof text === 'string' && text.trim() !== '' ? text.trim().slice(0, SIGNAL_TEXT_MAX) : null;
  return { name, text: clean };
}

/** The flag's value; undefined when the flag is absent, null when it has none. */
function valueOf(argv: readonly string[], flag: string): string | null | undefined {
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i] ?? '';
    if (arg === flag) {
      const next = argv[i + 1];
      return next === undefined || next.startsWith('--') ? null : next;
    }
    if (arg.startsWith(`${flag}=`)) return arg.slice(flag.length + 1);
  }
  return undefined;
}

/** How a signal is written on a command line, quoted the way cmd and a VS Code task read it. */
export function signalCommand(executable: readonly string[], name: string): string {
  const quote = (part: string): string => (/[\s"]/.test(part) ? `"${part.replace(/"/g, '\\"')}"` : part);
  return [...executable.map(quote), '--signal', name].join(' ');
}
