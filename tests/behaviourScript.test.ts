import variant from '@jitl/quickjs-singlefile-cjs-release-sync';
import { newQuickJSWASMModuleFromVariant, type QuickJSWASMModule } from 'quickjs-emscripten-core';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { BehaviourScript, LIMITS, type ScriptActions } from '@main/engine/behaviourScript';

let module: QuickJSWASMModule;
let done: string[];
let states: string[];
let scripts: BehaviourScript[];
let running: Map<string, boolean>;

beforeAll(async () => {
  module = await newQuickJSWASMModuleFromVariant(variant);
});

beforeEach(() => {
  done = [];
  states = [];
  scripts = [];
  running = new Map();
  vi.useFakeTimers();
});

afterEach(() => {
  for (const script of scripts) script.dispose();
  vi.useRealTimers();
});

const actions: ScriptActions = {
  say: (what) => done.push(`say ${JSON.stringify(what)}`),
  sound: (file) => done.push(`sound ${file}`),
  show: (s, place) => done.push(place === 'random' ? `show ${s} random` : `show ${s}`),
  hide: (m) => done.push(`hide ${m}`),
  setMood: (mood) => done.push(`mood ${mood}`),
  setState: (state, seconds) => done.push(`state ${state} ${seconds}`),
  log: (message) => done.push(`log ${message}`),
  isRunning: (stem) => running.get(stem) ?? null,
  music: () => ({ playing: true, track: 'One', artist: 'Band', app: 'spotify' }),
  now: () => 1000
};

function load(source: string, state: string | null = null): BehaviourScript {
  const script = new BehaviourScript(module, source, state, actions, (change) => {
    if (change.state) states.push(change.state);
  });
  scripts.push(script);
  return script;
}

describe('behaviour scripts', () => {
  it('hears what it subscribed to, for the programs it named', () => {
    const script = load(`
      on('programStarted', 'Dota2.exe', (e) => say('greet'));
      on('clicked', () => say({ text: 'hi' }));
      on('returned', (e) => log('back after', e.minutes));
    `);
    expect([...script.needs.startStop]).toEqual(['dota2']);
    expect(script.needs.returned).toBe(true);
    expect(script.needs.focus).toBe(false);

    script.dispatch({ name: 'programStarted', program: 'code' });
    script.dispatch({ name: 'programStarted', program: 'dota2' });
    script.dispatch({ name: 'clicked' });
    script.dispatch({ name: 'returned', detail: { minutes: 12 } });
    expect(done).toEqual(['say {"group":"greet"}', 'say {"text":"hi"}', 'log back after 12']);
  });

  it('hears the music it asks for, and can ask what is playing', () => {
    const quiet = load(`on('clicked', () => {});`);
    expect(quiet.needs.music).toBe(false);

    const script = load(`
      on('trackChanged', (e) => log(e.track, e.artist, e.app));
      on('clicked', () => log(JSON.stringify(music())));
    `);
    expect(script.needs.music).toBe(true);
    script.dispatch({ name: 'trackChanged', detail: { track: 'Two', artist: 'Band', app: 'spotify' } });
    script.dispatch({ name: 'clicked' });
    expect(done).toEqual(['log Two Band spotify', 'log {"playing":true,"track":"One","artist":"Band","app":"spotify"}']);
  });

  it('starts watching the music the first time a script asks', () => {
    const script = load(`on('clicked', () => log(typeof music()));`);
    expect(script.needs.music).toBe(false);
    script.dispatch({ name: 'clicked' });
    expect(script.needs.music).toBe(true);
    expect(script.error).toBeNull();
  });

  it('does what the app does, within bounds', () => {
    load(`sound('beep.wav'); show(99999); hide(0); setMood('happy'); setMood(null); log({ a: 1 }, 'x');`);
    expect(done).toEqual(['sound beep.wav', 'show 3600', 'hide 1', 'mood happy', 'mood null', 'log {"a":1} x']);
  });

  it('comes out somewhere random when asked, and refuses a place it does not know', () => {
    load(`show(5, 'random'); show(5, 'usual');`);
    expect(done).toEqual(['show 5 random', 'show 5']);
    expect(load(`show(5, 'moon');`).error).toContain('show(seconds, place)');
  });

  it('hears signals: one by name, or every one, with the text that came along', () => {
    const script = load(`
      on('signal', 'build-ok', (e) => log('ok', e.name, e.text));
      on('signal', (e) => log('any', e.name, e.text === undefined));
    `);
    script.dispatch({ name: 'signal', signal: 'build-ok', detail: { name: 'build-ok', text: '3 tests' } });
    script.dispatch({ name: 'signal', signal: 'other', detail: { name: 'other' } });
    expect(done).toEqual(['log ok build-ok 3 tests', 'log any build-ok false', 'log any other true']);
    expect(load(`on('signal', 'two words', () => {});`).error).toContain('not a signal name');
  });

  it('hears game events: one by what happened, or all of them', () => {
    const script = load(`
      on('game', 'won', (e) => log('won', e.hero, e.kills));
      on('game', (e) => log('any', e.event));
    `);
    expect(script.needs.game).toBe(true);
    script.dispatch({ name: 'game', game: 'won', detail: { event: 'won', hero: 'Pudge', kills: 7 } });
    script.dispatch({ name: 'game', game: 'death', detail: { event: 'death' } });
    expect(done).toEqual(['log won Pudge 7', 'log any won', 'log any death']);
    expect(load(`on('game', 'rampage', () => {});`).error).toContain('not one of won, lost, kill, death');
  });

  it('changes state, within bounds', () => {
    load(`setState('nap', 99999); setState('nap', 0); setState('nap'); setState(null);`);
    expect(done).toEqual(['state nap 3600', 'state nap 1', 'state nap null', 'state null null']);
    expect(load(`setState('Bad State!');`).error).toContain('setState()');
  });

  it('runs timers no faster than allowed, and stops them on cancel', () => {
    load(`let n = 0; const id = every(10, () => { n++; log('tick', n); if (n === 2) cancel(id); }); after(0, () => log('later'));`);
    vi.advanceTimersByTime(LIMITS.afterMinMs);
    expect(done).toEqual(['log later']);
    vi.advanceTimersByTime(LIMITS.everyMinMs * 5);
    expect(done).toEqual(['log later', 'log tick 1', 'log tick 2']);
  });

  it('keeps its state across a restart', () => {
    const first = load(`on('clicked', () => { state.clicks = (state.clicks || 0) + 1; });`);
    first.dispatch({ name: 'clicked' });
    first.dispatch({ name: 'clicked' });
    expect(states.at(-1)).toBe('{"clicks":2}');
    const second = load(`on('clicked', () => log(state.clicks));`, states.at(-1) ?? null);
    second.dispatch({ name: 'clicked' });
    expect(done.at(-1)).toBe('log 2');
  });

  it('answers whether a program runs once it is watched', () => {
    const script = load(`on('clicked', () => log(running('obs.exe')));`);
    script.dispatch({ name: 'clicked' });
    expect(script.needs.running.has('obs')).toBe(true);
    running.set('obs', true);
    script.dispatch({ name: 'clicked' });
    expect(done).toEqual(['log null', 'log true']);
  });

  it('says where it went wrong, and keeps going after an ordinary error', () => {
    const script = load(`
      on('clicked', () => {
        nope();
      });
      on('startup', () => log('still here'));
    `);
    script.dispatch({ name: 'clicked' });
    expect(script.error).toMatch(/^Line 3: ReferenceError/);
    script.dispatch({ name: 'startup' });
    expect(done.at(-1)).toBe('log still here');
    expect(script.running).toBe(true);
  });

  it('stops a handler that never ends, and the whole script after three in a row', () => {
    vi.useRealTimers();
    const script = load(`on('clicked', () => { while (true) {} });`);
    script.dispatch({ name: 'clicked' });
    expect(script.error).toContain('took longer than');
    expect(script.running).toBe(true);
    script.dispatch({ name: 'clicked' });
    script.dispatch({ name: 'clicked' });
    expect(script.running).toBe(false);
    expect(script.error).toContain('Stopped after 3 times');
  });

  it('stops a script that eats memory', () => {
    vi.useRealTimers();
    const script = load(`on('clicked', () => { const a = []; while (true) a.push('x'.repeat(1000)); });`);
    script.dispatch({ name: 'clicked' });
    expect(script.error).toMatch(/used more than|took longer than/);
  });

  it('refuses events and arguments it does not know', () => {
    const script = load(`on('everySecond', () => {});`);
    expect(script.error).toContain('no event called "everySecond"');
    const other = load(`on('programStarted', () => {});`);
    expect(other.error).toContain('which program');
    const mood = load(`setMood('Bad Mood!');`);
    expect(mood.error).toContain('setMood()');
  });

  it('has nothing of the machine to reach', () => {
    load(`log(typeof require, typeof process, typeof fetch, typeof setTimeout, typeof std, typeof os);`);
    expect(done).toEqual(['log undefined undefined undefined undefined undefined undefined']);
  });
});
