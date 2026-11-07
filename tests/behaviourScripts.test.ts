import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { newQuickJSWASMModuleFromVariant } from 'quickjs-emscripten-core';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { defaultCharacter, type Character } from '@shared/character';
import { BEHAVIOUR_STARTER } from '@shared/scriptTemplate';
import type { ScriptNeeds } from '@main/engine/behaviourScript';
import { BehaviourScripts, type ScriptStatus } from '@main/engine/behaviourScripts';

let dir: string;
let said: string[];
let needs: ScriptNeeds[];
let statuses: [string, ScriptStatus | null][];
let blocked: Set<string>;
let scripts: BehaviourScripts;

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 50));

function character(id: string, source: string | null, patch: Partial<Character> = {}): Character {
  if (source !== null) {
    mkdirSync(join(dir, id), { recursive: true });
    writeFileSync(join(dir, id, 'behaviour.js'), source);
  }
  return { ...defaultCharacter(id, id), behaviourScript: source === null ? null : 'behaviour.js', ...patch };
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'jacqueline-scripts-'));
  said = [];
  needs = [];
  statuses = [];
  blocked = new Set();
  scripts = new BehaviourScripts({
    loadModule: () => newQuickJSWASMModuleFromVariant(variant),
    assetPath: (id, file) => join(dir, id, file),
    isAllowed: (id) => !blocked.has(id),
    stateDir: join(dir, 'state'),
    actionsFor: (id) => ({
      say: (what) => said.push(`${id}: ${'group' in what ? what.group : what.text}`),
      sound: () => undefined,
      show: () => undefined,
      hide: () => undefined,
      setMood: () => undefined,
      signal: () => undefined,
      setState: () => undefined,
      log: () => undefined,
      isRunning: () => null,
      music: () => null,
      now: () => 0
    }),
    onNeeds: (next) => needs.push(next),
    onStatus: (id, status) => statuses.push([id, status])
  });
});

afterEach(() => {
  scripts.stop();
  rmSync(dir, { recursive: true, force: true });
});

describe('every character’s behaviour script', () => {
  it('runs for characters that are on and allowed, and hears clicks only for its own character', async () => {
    blocked.add('rin');
    scripts.setCharacters([
      character('teto', `on('clicked', () => say('teto'));`),
      character('miku', `on('clicked', () => say('miku'));`, { enabled: false }),
      character('rin', `on('clicked', () => say('rin'));`)
    ]);
    await settle();
    expect(scripts.status('teto')).toEqual({ running: true, error: null });
    expect(scripts.status('miku')).toBeNull();
    expect(scripts.status('rin')).toBeNull();

    scripts.event({ type: 'clicked', characterId: 'teto' });
    scripts.event({ type: 'clicked', characterId: 'miku' });
    expect(said).toEqual(['teto: teto']);
  });

  it('hands what it subscribed to over as needs, and drops them when it stops', async () => {
    scripts.setCharacters([character('teto', `on('programStarted', 'obs.exe', () => {}); on('minute', () => {});`)]);
    await settle();
    expect([...(needs.at(-1)?.startStop ?? [])]).toEqual(['obs']);
    expect(needs.at(-1)?.minute).toBe(true);
    scripts.setCharacters([]);
    await settle();
    expect(needs.at(-1)?.startStop.size).toBe(0);
    expect(statuses.at(-1)).toEqual(['teto', null]);
  });

  it('turns rule events into the events a script hears, startup once they are up', async () => {
    scripts.setCharacters([
      character('teto', `on('minute', (e) => say(e.time)); on('returned', (e) => say('back ' + e.minutes)); on('startup', () => say('up'));`)
    ]);
    scripts.event({ type: 'startup' });
    await settle();
    scripts.event({ type: 'time', at: '09:30' });
    scripts.event({ type: 'returned', awayMinutes: 12.4 });
    scripts.event({ type: 'every', characterId: 'teto', ruleId: 'r' });
    expect(said).toEqual(['teto: up', 'teto: 09:30', 'teto: back 12']);
  });

  it('keeps its state on disk, outside the character', async () => {
    scripts.setCharacters([character('teto', `on('clicked', () => { state.n = (state.n || 0) + 1; });`)]);
    await settle();
    scripts.event({ type: 'clicked', characterId: 'teto' });
    expect(readFileSync(join(dir, 'state', 'teto.json'), 'utf8')).toBe('{"n":1}');
    scripts.restart('teto');
    await settle();
    scripts.event({ type: 'clicked', characterId: 'teto' });
    expect(readFileSync(join(dir, 'state', 'teto.json'), 'utf8')).toBe('{"n":2}');
  });

  it('runs the template as it ships', async () => {
    scripts.setCharacters([character('teto', BEHAVIOUR_STARTER)]);
    await settle();
    expect(scripts.status('teto')).toEqual({ running: true, error: null });
    for (let i = 0; i < 10; i += 1) scripts.event({ type: 'clicked', characterId: 'teto' });
    expect(said).toEqual(['teto: That is 10 clicks, {name} is counting.']);
  });
});
