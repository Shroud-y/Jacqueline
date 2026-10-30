/**
 * The sealed page a character's visual script runs in:
 * `jacqueline-script://<id>/` serves a blank page, a small runtime, and the
 * script itself.
 *
 * Why a scheme of its own: every character window lives in one renderer
 * process, and a script loaded into its window could reach the others — and
 * the bridge to the app. Framed from a different origin and with `sandbox`,
 * the script has an opaque origin: it cannot touch its parent, and the page's
 * own Content-Security-Policy (sent as a header here) gives it no network,
 * no frames, no forms. What it can do is draw in its layer and talk to the
 * window it sits in through `postMessage`, which the window answers only with
 * what the runtime documents.
 */

import { readFileSync } from 'node:fs';
import { protocol } from 'electron';
import { ASSET_SCHEME, SCRIPT_SCHEME } from '@shared/assetUrl';
import { characterIdSchema } from '@shared/character';
import { createLogger } from '../app/logger';
import type { CharacterStore } from './store';

const log = createLogger('scripts');

const CSP = [
  "default-src 'none'",
  `script-src ${SCRIPT_SCHEME}:`,
  `style-src 'unsafe-inline' ${ASSET_SCHEME}:`,
  `img-src data: blob: ${ASSET_SCHEME}:`,
  `media-src blob: ${ASSET_SCHEME}:`,
  `font-src ${ASSET_SCHEME}:`,
  "connect-src 'none'",
  "frame-src 'none'",
  "form-action 'none'",
  "base-uri 'none'"
].join('; ');

const PAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}</style></head>
<body><script src="runtime.js"></script><script src="script.js"></script></body></html>`;

/**
 * What the script finds as `jacqueline`. Classic script, not a module: the
 * page has an opaque origin, and a module would be fetched in CORS mode.
 */
export function runtimeSource(id: string): string {
  return `(() => {
  'use strict';
  const ID = ${JSON.stringify(id)};
  const listeners = new Map();
  let state = { speaking: false, line: null, preview: false, playing: true };
  const emit = (event, detail) => {
    for (const fn of listeners.get(event) || []) {
      try { fn(detail); } catch (err) { console.error(err); }
    }
  };
  const api = {
    /** 'speech' (the line), 'speechEnd', 'click', 'pause', 'resume', 'state'. Returns a function that stops listening. */
    on(event, fn) {
      if (typeof fn !== 'function') return () => {};
      const set = listeners.get(event) || new Set();
      set.add(fn);
      listeners.set(event, set);
      return () => set.delete(fn);
    },
    /** Sets data-mood on the character's window, for its stylesheet. null clears it. */
    setMood(mood) {
      parent.postMessage({ jacqueline: 'mood', mood: mood == null ? null : String(mood) }, '*');
    },
    /** The address of one of the character's own files. */
    asset(name) {
      return '${ASSET_SCHEME}://' + ID + '/' + encodeURIComponent(String(name));
    },
    get state() {
      return Object.assign({}, state);
    }
  };
  Object.defineProperty(window, 'jacqueline', { value: Object.freeze(api) });
  addEventListener('message', (event) => {
    if (event.source !== parent || !event.data || typeof event.data.jacqueline !== 'string') return;
    const type = event.data.jacqueline;
    if (type === 'state') {
      const before = state;
      state = Object.assign({}, state, event.data.state);
      if (state.line && (!before.line || before.line.id !== state.line.id)) emit('speech', state.line);
      if (before.speaking && !state.speaking) emit('speechEnd', {});
      if (before.playing !== state.playing) emit(state.playing ? 'resume' : 'pause', {});
      emit('state', Object.assign({}, state));
    } else if (type === 'click') {
      emit('click', {});
    }
  });
  // Once the character's script has run and registered what it listens to.
  addEventListener('DOMContentLoaded', () => parent.postMessage({ jacqueline: 'ready' }, '*'));
})();
`;
}

export interface ScriptHostDeps {
  store: CharacterStore;
  /** False for a character whose script the user has not allowed. */
  isAllowed: (id: string) => boolean;
}

/** Must run after `app.whenReady`; the scheme itself is registered with the asset scheme. */
export function handleScriptHost({ store, isAllowed }: ScriptHostDeps): void {
  protocol.handle(SCRIPT_SCHEME, (request) => {
    const url = new URL(request.url);
    const id = url.hostname;
    const character = characterIdSchema.safeParse(id).success ? store.get(id) : null;
    const file = character?.appearance.script ?? null;
    if (!character || !file || !isAllowed(id)) return notFound();

    const headers = {
      'Content-Security-Policy': CSP,
      // Edited and saved: the next load must see it.
      'Cache-Control': 'no-store'
    };
    switch (url.pathname) {
      case '/':
      case '/index.html':
        return new Response(PAGE, { headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
      case '/runtime.js':
        return new Response(runtimeSource(id), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
      case '/script.js': {
        const path = store.assetPath(id, file);
        if (!path) return notFound();
        try {
          return new Response(readFileSync(path, 'utf8'), { headers: { ...headers, 'Content-Type': 'text/javascript; charset=utf-8' } });
        } catch (err) {
          log.warn(`cannot read the script of "${id}": ${String(err)}`);
          return notFound();
        }
      }
      default:
        return notFound();
    }
  });
}

function notFound(): Response {
  return new Response('not found', { status: 404 });
}
