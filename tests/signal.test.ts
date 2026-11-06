import { describe, expect, it } from 'vitest';
import { parseSignalArgs, signalCommand, signalFromData, SIGNAL_TEXT_MAX } from '@shared/signal';

const exe = ['C:/Program Files/Jacqueline/Jacqueline.exe'];

describe('parseSignalArgs', () => {
  it('finds no signal on an ordinary start', () => {
    expect(parseSignalArgs([...exe, '--hidden'])).toEqual({ kind: 'none' });
  });

  it('reads a name, and the text that may come with it, either way they are written', () => {
    expect(parseSignalArgs([...exe, '--signal', 'build-ok'])).toEqual({ kind: 'signal', signal: { name: 'build-ok', text: null } });
    expect(parseSignalArgs([...exe, '--signal=build.failed', '--text', '  3 errors '])).toEqual({ kind: 'signal', signal: { name: 'build.failed', text: '3 errors' } });
    expect(parseSignalArgs([...exe, '--text=hi', '--signal', 'x'])).toEqual({ kind: 'signal', signal: { name: 'x', text: 'hi' } });
  });

  it('cuts a long text short and drops an empty one', () => {
    const long = parseSignalArgs([...exe, '--signal', 'x', '--text', 'a'.repeat(500)]);
    expect(long.kind === 'signal' && long.signal.text?.length).toBe(SIGNAL_TEXT_MAX);
    expect(parseSignalArgs([...exe, '--signal', 'x', '--text', '   '])).toEqual({ kind: 'signal', signal: { name: 'x', text: null } });
  });

  it('calls a signal with no name, or a name that is not one, broken — never "none"', () => {
    expect(parseSignalArgs([...exe, '--signal']).kind).toBe('invalid');
    expect(parseSignalArgs([...exe, '--signal', '--text', 'x']).kind).toBe('invalid');
    expect(parseSignalArgs([...exe, '--signal', 'two words']).kind).toBe('invalid');
    expect(parseSignalArgs([...exe, '--signal', '-dash-first']).kind).toBe('invalid');
  });
});

describe('signalFromData', () => {
  it('takes a signal that came through the lock, and nothing else', () => {
    expect(signalFromData({ signal: { name: 'build-ok', text: 'yes' } })).toEqual({ name: 'build-ok', text: 'yes' });
    expect(signalFromData({ signal: { name: 'build-ok' } })).toEqual({ name: 'build-ok', text: null });
    expect(signalFromData({})).toBeNull();
    expect(signalFromData(null)).toBeNull();
    expect(signalFromData({ signal: { name: '../x' } })).toBeNull();
    expect(signalFromData({ signal: { name: 'x', text: 'b'.repeat(999) } })?.text).toHaveLength(SIGNAL_TEXT_MAX);
  });
});

describe('signalCommand', () => {
  it('quotes what has spaces in it', () => {
    expect(signalCommand(exe, 'build-ok')).toBe('"C:/Program Files/Jacqueline/Jacqueline.exe" --signal build-ok');
    expect(signalCommand(['C:/e/electron.exe', 'E:/repo'], 'x')).toBe('C:/e/electron.exe E:/repo --signal x');
  });
});
