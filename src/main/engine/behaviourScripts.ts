/**
 * The behaviour scripts of every character that has one: a sandbox each,
 * started when the character is on and its script allowed, stopped when not,
 * started again whenever the file is saved. QuickJS itself is loaded only
 * once some character needs it.
 */

import { existsSync, mkdirSync, readFileSync, renameSync, watch, writeFileSync, type FSWatcher } from 'node:fs';
import { join } from 'node:path';
import type { QuickJSWASMModule } from 'quickjs-emscripten-core';
import type { Character } from '@shared/character';
import { createLogger } from '../app/logger';
import { BehaviourScript, type ScriptActions, type ScriptEvent, type ScriptNeeds } from './behaviourScript';
import type { RuleEvent } from './ruleEngine';

const log = createLogger('scripts');

export interface ScriptStatus {
  running: boolean;
  error: string | null;
}

export interface BehaviourScriptsDeps {
  loadModule: () => Promise<QuickJSWASMModule>;
  assetPath: (id: string, file: string) => string | null;
  isAllowed: (id: string) => boolean;
  /** Where each script's `state` is kept, outside the character's own folder. */
  stateDir: string;
  /** What the script does, carried out for this character. */
  actionsFor: (id: string) => ScriptActions;
  onNeeds: (needs: ScriptNeeds) => void;
  onStatus: (id: string, status: ScriptStatus | null) => void;
}

interface Live {
  file: string;
  script: BehaviourScript;
  watcher: FSWatcher | null;
  reload: NodeJS.Timeout | null;
}

export class BehaviourScripts {
  private readonly live = new Map<string, Live>();
  private module: QuickJSWASMModule | null = null;
  private loading: Promise<QuickJSWASMModule | null> | null = null;
  private wanted = new Map<string, string>();
  private settled: Promise<void> = Promise.resolve();
  private stopped = false;

  constructor(private readonly deps: BehaviourScriptsDeps) {}

  /** Whose scripts run. Called again whenever any character changes. */
  setCharacters(characters: readonly Character[]): void {
    this.wanted = new Map(
      characters.flatMap((character) =>
        character.enabled && character.behaviourScript && this.deps.isAllowed(character.id) && this.deps.assetPath(character.id, character.behaviourScript)
          ? [[character.id, character.behaviourScript] as const]
          : []
      )
    );
    this.settled = this.sync();
  }

  /** An event from the desktop, for every script that listens for it. `startup` waits for the scripts to be up. */
  event(event: RuleEvent): void {
    const translated = translate(event);
    if (!translated) return;
    const deliver = (): void => {
      for (const [id, live] of this.live) {
        if (event.type === 'clicked' && event.characterId !== id) continue;
        live.script.dispatch(translated);
      }
    };
    if (event.type === 'startup') void this.settled.then(deliver);
    else deliver();
  }

  /** A character's line is over. */
  speechEnded(id: string): void {
    this.live.get(id)?.script.dispatch({ name: 'speechEnd' });
  }

  status(id: string): ScriptStatus | null {
    const live = this.live.get(id);
    return live ? { running: live.script.running, error: live.script.error } : null;
  }

  /** From scratch: a script stopped for its limits gets another go. */
  restart(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    this.close(id);
    this.settled = this.sync();
  }

  stop(): void {
    this.stopped = true;
    for (const id of [...this.live.keys()]) this.close(id);
  }

  /* ------------------------------------------------------------------ */

  private async sync(): Promise<void> {
    for (const [id, live] of this.live) if (this.wanted.get(id) !== live.file) this.close(id);
    const missing = [...this.wanted].filter(([id]) => !this.live.has(id));
    if (missing.length > 0) {
      const module = await this.loadModule();
      if (!module || this.stopped) return;
      for (const [id, file] of missing) if (this.wanted.get(id) === file && !this.live.has(id)) this.open(id, file, module);
    }
    this.publishNeeds();
  }

  private loadModule(): Promise<QuickJSWASMModule | null> {
    if (this.module) return Promise.resolve(this.module);
    this.loading ??= this.deps.loadModule().then(
      (module) => (this.module = module),
      (err: unknown) => {
        log.error(`cannot load the script engine: ${String(err)}`);
        return null;
      }
    );
    return this.loading;
  }

  private open(id: string, file: string, module: QuickJSWASMModule): void {
    const path = this.deps.assetPath(id, file);
    if (!path) return;
    let source: string;
    try {
      source = readFileSync(path, 'utf8');
    } catch (err) {
      log.warn(`cannot read the behaviour script of "${id}": ${String(err)}`);
      return;
    }
    const script = new BehaviourScript(module, source, this.readState(id), this.deps.actionsFor(id), (change) => {
      if (change.state !== undefined) this.writeState(id, change.state);
      if (change.needs) this.publishNeeds();
      if (change.status) this.deps.onStatus(id, this.status(id));
    });
    const live: Live = { file, script, watcher: null, reload: null };
    this.live.set(id, live);
    try {
      // Saved in an editor: started again on what was saved, in one go however the editor writes.
      live.watcher = watch(path, () => {
        if (live.reload) clearTimeout(live.reload);
        live.reload = setTimeout(() => {
          if (this.live.get(id) !== live) return;
          this.close(id);
          this.settled = this.sync();
        }, 150);
      });
      live.watcher.on('error', () => live.watcher?.close());
    } catch {
      // Not followed; still runs.
    }
    log.info(`behaviour script of "${id}" started`);
    this.deps.onStatus(id, this.status(id));
  }

  private close(id: string): void {
    const live = this.live.get(id);
    if (!live) return;
    if (live.reload) clearTimeout(live.reload);
    live.watcher?.close();
    live.script.dispose();
    this.live.delete(id);
    this.deps.onStatus(id, null);
    this.publishNeeds();
  }

  private publishNeeds(): void {
    const needs: ScriptNeeds = { startStop: new Set(), running: new Set(), focus: false, minute: false, returned: false, music: false };
    for (const { script } of this.live.values()) {
      if (!script.running) continue;
      for (const stem of script.needs.startStop) needs.startStop.add(stem);
      for (const stem of script.needs.running) needs.running.add(stem);
      needs.focus ||= script.needs.focus;
      needs.minute ||= script.needs.minute;
      needs.returned ||= script.needs.returned;
      needs.music ||= script.needs.music;
    }
    this.deps.onNeeds(needs);
  }

  private statePath(id: string): string {
    return join(this.deps.stateDir, `${id}.json`);
  }

  private readState(id: string): string | null {
    const path = this.statePath(id);
    if (!existsSync(path)) return null;
    try {
      const text = readFileSync(path, 'utf8');
      JSON.parse(text);
      return text;
    } catch {
      return null;
    }
  }

  private writeState(id: string, json: string): void {
    try {
      mkdirSync(this.deps.stateDir, { recursive: true });
      const path = this.statePath(id);
      writeFileSync(`${path}.tmp`, json, 'utf8');
      renameSync(`${path}.tmp`, path);
    } catch (err) {
      log.warn(`cannot keep the state of "${id}"'s script: ${String(err)}`);
    }
  }
}

/** A rule event, as a script hears it. */
function translate(event: RuleEvent): ScriptEvent | null {
  switch (event.type) {
    case 'programStarted':
    case 'programStopped':
    case 'programFocused':
      return { name: event.type, program: event.program };
    case 'time':
      return { name: 'minute', detail: { time: event.at } };
    case 'returned':
      return { name: 'returned', detail: { minutes: Math.round(event.awayMinutes) } };
    case 'startup':
      return { name: 'startup' };
    case 'clicked':
      return { name: 'clicked' };
    case 'musicStarted':
    case 'musicStopped':
    case 'trackChanged':
      return { name: event.type, detail: { track: event.track, artist: event.artist, app: event.app } };
    case 'every':
      return null;
  }
}
