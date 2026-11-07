import { app, clipboard, dialog, powerMonitor, screen, shell } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { newQuickJSWASMModuleFromVariant, type QuickJSSyncVariant } from 'quickjs-emscripten-core';

import { ASSET_EXTENSIONS, type Character } from '@shared/character';
import { IPC } from '@shared/ipc';
import { parseSignalArgs, signalFromData } from '@shared/signal';
import type { Settings, SettingsView } from '@shared/types';

import { configureLogger, createLogger } from './app/logger';
import { characterMenu, trayMenu, trayTooltip, type MenuAction, type MenuState } from './app/menus';
import { LEGACY_LOGIN_ITEM, migrateFromShard } from './app/migrate';
import { paths } from './app/paths';
import { SettingsStore } from './app/settings';
import { AppTray } from './app/tray';
import { handleAssetProtocol, registerAssetScheme } from './characters/assetProtocol';
import { registerEditorIpc } from './characters/editorIpc';
import { handleScriptHost } from './characters/scriptHost';
import { ScriptTrust } from './characters/scriptTrust';
import { isPresent } from './characters/presence';
import { isWithinClockWindow, minutesOfDay, msUntilClockChange } from './engine/timeOfDay';
import { pickLine, runActions, type ActionDeps } from './engine/actions';
import { BehaviourScripts } from './engine/behaviourScripts';
import { clock, musicSlots } from './engine/ruleEngine';
import { fillSlots } from './engine/slots';
import { SpeechDirector } from './engine/director';
import { RuleRunner } from './engine/ruleRunner';
import { RecentHistory } from './engine/selector';
import { CharacterStore } from './characters/store';
import { Visibility } from './characters/visibility';
import { watchMediaSessions } from './sensors/mediaSessions';
import { PresenceWatcher } from './sensors/presenceWatcher';
import { loadDesktopSensors } from './sensors/win32';
import { CharacterWindows } from './windows/characterWindows';
import { EditorWindow } from './windows/editorWindow';

const log = createLogger('main');

// Must run before `app.whenReady` — character windows load their assets through it.
registerAssetScheme();

// A signal is carried to the app that is already running and goes no further:
// with nobody running, there is nobody it is for, and a build script must not
// start the app behind the user's back.
const signalArgs = parseSignalArgs(process.argv);
const carried =
  signalArgs.kind === 'signal' ? { signal: signalArgs.signal } : signalArgs.kind === 'invalid' ? { signalRefused: signalArgs.error } : {};
if (!app.requestSingleInstanceLock(carried) || signalArgs.kind !== 'none') {
  app.exit(0);
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  // Before anything reads from the folder: SHARD's characters become Jacqueline's.
  let migrated: string[] = [];
  let migrateError: string | null = null;
  try {
    migrated = migrateFromShard(app.getPath('appData'), app.getPath('userData'));
  } catch (err) {
    migrateError = String(err);
  }
  configureLogger({ directory: paths.logDir(), level: app.isPackaged ? 'info' : 'debug' });
  if (migrated.length > 0) log.info(`carried over from SHARD: ${migrated.join(', ')}`);
  if (migrateError) log.error(`cannot carry over SHARD's characters: ${migrateError}`);
  // Also the name the start-with-Windows entry is written under.
  app.setAppUserModelId('dev.jacqueline.app');

  const settings = new SettingsStore(paths.settingsFile());
  const settingsView = (): SettingsView => settingsViewOf(settings.current);
  const characters = new CharacterStore(paths.charactersRoot());
  handleAssetProtocol(characters);
  const scriptTrust = new ScriptTrust(paths.scriptTrustFile());
  handleScriptHost({ store: characters, isAllowed: (id) => scriptTrust.isAllowed(id) });

  const entries = characters.list();
  const broken = entries.filter((entry) => !entry.ok).length;
  log.info(`characters: ${entries.length}${broken > 0 ? ` (${broken} unreadable)` : ''} in ${paths.charactersRoot()}`);

  const presence = new PresenceWatcher({
    loadSensors: loadDesktopSensors,
    activity: {
      idleSeconds: () => powerMonitor.getSystemIdleTime(),
      onLockChange: (listener) => {
        const lock = (): void => listener(true);
        const unlock = (): void => listener(false);
        powerMonitor.on('lock-screen', lock);
        powerMonitor.on('unlock-screen', unlock);
        return () => {
          powerMonitor.off('lock-screen', lock);
          powerMonitor.off('unlock-screen', unlock);
        };
      }
    },
    // Windows answers in physical pixels; the windows are placed in Electron's scaled ones.
    toScreen: (rect) => screen.screenToDipRect(null, rect)
  });
  const visibility = new Visibility();
  // Someone hidden for now needs nothing watched on their behalf: with
  // everyone hidden, every sensor and timer goes with them.
  const watched = (): Character[] =>
    characters.list().flatMap((entry) => (entry.ok && !visibility.isHidden(entry.id) ? [entry.character] : []));

  // Muted, or inside quiet hours: nothing is said or played by anyone.
  const isSilenced = (): boolean => {
    const { muted, quietHours } = settings.current;
    return muted || (quietHours.enabled && isWithinClockWindow(minutesOfDay(Date.now()), quietHours.from, quietHours.to));
  };

  const windows = new CharacterWindows(characters, join(__dirname, '../preload/stage.js'), {
    isPresent: (character, anchor) =>
      !visibility.isHidden(character.id) && isPresent(character, presence.facts, anchor),
    isWatching: () => presence.watching,
    onMenu: (id) => {
      const character = characters.get(id);
      if (character) tray.popUp(characterMenu(character), screen.getCursorScreenPoint());
    },
    // A click while it is talking is "enough, thank you"; otherwise it is a click.
    onClick: (id) => (director.isSpeaking(id) ? director.dismiss(id) : rules.event({ type: 'clicked', characterId: id })),
    speechFor: (id) => director.current(id),
    isOnStage: (id) => director.isOnStage(id),
    isMusicPlaying: () => rules.musicNow()?.playing === true,
    isSilenced,
    scriptAllowed: (id) => scriptTrust.isAllowed(id)
  });

  const director = new SpeechDirector();
  // Who was speaking at the last change: a line ending is something a behaviour script hears.
  const speaking = new Set<string>();
  director.onChange((id) => {
    windows.refresh();
    const now = director.isSpeaking(id);
    if (speaking.has(id) && !now) scripts.speechEnded(id);
    if (now) speaking.add(id);
    else speaking.delete(id);
  });

  // Behaviour: rules fire, their actions run, lines go to the director.
  const history = new RecentHistory();
  const actionDeps: ActionDeps = {
    isSilenced,
    say: (character, text) => {
      log.info(`"${character.name}" says: ${text}`);
      director.say(character.id, text);
    },
    playSound: (character, file) => windows.playSound(character.id, file, character.audio.volume),
    show: (character, ms, place) => windows.showFor(character.id, ms, place),
    hide: (character, ms) => visibility.hideFor(character.id, ms),
    setState: (character, state, ms) => windows.setState(character.id, state, ms),
    log: (message) => log.info(message),
    history,
    rng: Math.random
  };
  const rules = new RuleRunner({
    loadSensors: loadDesktopSensors,
    watchMedia: watchMediaSessions,
    onMusic: () => windows.refresh(),
    idleSeconds: () => powerMonitor.getSystemIdleTime(),
    onFired: (fired) => runActions(fired, actionDeps),
    onEvent: (event) => scripts.event(event)
  });

  // Behaviour scripts: what they do goes the way a rule's actions do, mute and quiet hours included.
  const scripts = new BehaviourScripts({
    // Required, not imported: a plain require works the same from the dev folder and from inside the
    // packaged app's asar. Only now, when some character first needs it — it is 24 MB once loaded.
    loadModule: () => {
      const variant = createRequire(__filename)('@jitl/quickjs-singlefile-cjs-release-sync') as { default: QuickJSSyncVariant };
      return newQuickJSWASMModuleFromVariant(variant.default);
    },
    assetPath: (id, file) => characters.assetPath(id, file),
    isAllowed: (id) => scriptTrust.isAllowed(id),
    stateDir: paths.scriptStateDir(),
    actionsFor: (id) => {
      const current = (): Character | null => characters.get(id);
      return {
        say: (what) => {
          const character = current();
          if (!character || isSilenced()) return;
          const music = rules.musicNow();
          const slots = { name: character.name, time: clock(Date.now()), ...musicSlots(music?.playing ? music : null) };
          if ('group' in what) {
            const picked = pickLine(character, what.group, slots, actionDeps);
            if (!picked) return void log.info(`"${character.name}" script: nothing to say from "${what.group}"`);
            actionDeps.say(character, picked.text, picked.line);
            if (picked.line.audio) windows.playSound(id, picked.line.audio, character.audio.volume);
          } else {
            actionDeps.say(character, fillSlots(what.text, slots) ?? what.text, { id: 'script', text: what.text });
          }
        },
        sound: (file) => {
          const character = current();
          if (character && !isSilenced()) windows.playSound(id, file, character.audio.volume);
        },
        show: (seconds, place) => windows.showFor(id, seconds * 1000, place),
        hide: (minutes) => visibility.hideFor(id, minutes * 60_000),
        setMood: (mood) => windows.setMood(id, mood),
        setState: (state, seconds) => {
          if (!windows.setState(id, state, seconds === null ? null : seconds * 1000)) log.info(`"${current()?.name ?? id}" script: it has no state "${state}"`);
        },
        log: (message) => log.info(`"${current()?.name ?? id}" script: ${message}`),
        isRunning: (stem) => rules.isRunning(stem),
        music: () => rules.musicNow(),
        now: () => Date.now()
      };
    },
    onNeeds: (needs) =>
      rules.setExtraNeeds({ startStop: needs.startStop, running: needs.running, focus: needs.focus, time: needs.minute, returned: needs.returned, music: needs.music }),
    onStatus: (id, status) => editor.send(IPC.editorScriptStatus, { id, status })
  });
  // Someone hidden for now does nothing either.
  const acting = (): Character[] =>
    characters.list().flatMap((entry) => (entry.ok && entry.character.enabled && !visibility.isHidden(entry.id) ? [entry.character] : []));
  rules.setCharacters(acting());
  scripts.setCharacters(acting());
  presence.onChange(() => windows.refresh());
  presence.setCharacters(watched());
  windows.start();

  reconcileAutostart(settings.current.startWithSystem);
  settings.onChange((next) => reconcileAutostart(next.startWithSystem));

  const editor = new EditorWindow(join(__dirname, '../preload/editor.js'), join(paths.iconsDir(), 'app.ico'));
  registerEditorIpc(characters, {
    pickFile: async (kinds) => {
      const options = {
        properties: ['openFile' as const],
        filters: [{ name: 'Files', extensions: kinds.flatMap((kind) => ASSET_EXTENSIONS[kind].map((ext) => ext.slice(1))) }]
      };
      const parent = editor.browserWindow;
      const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    openFolder: async (id) => {
      const failure = await shell.openPath(paths.characterDir(id));
      return failure ? { ok: false, error: failure } : { ok: true };
    },
    setPreview: (id) => windows.setPreview(id),
    // Tried from the editor: now, in place of whatever it was saying, mute or not.
    sayNow: (character, text, line) => {
      director.dismiss(character.id);
      director.say(character.id, text);
      if (line.audio) windows.playSound(character.id, line.audio, character.audio.volume);
    },
    runNow: (fired) => {
      director.dismiss(fired.character.id);
      runActions(fired, { ...actionDeps, isSilenced: () => false });
    },
    pickZip: async () => {
      const options = { properties: ['openFile' as const], filters: [{ name: 'Jacqueline character', extensions: ['zip'] }] };
      const parent = editor.browserWindow;
      const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
      return picked.canceled ? null : (picked.filePaths[0] ?? null);
    },
    pickSavePath: async (suggestedName) => {
      const options = { defaultPath: join(app.getPath('documents'), suggestedName), filters: [{ name: 'Jacqueline character', extensions: ['zip'] }] };
      const parent = editor.browserWindow;
      const picked = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options);
      return picked.canceled || !picked.filePath ? null : picked.filePath;
    },
    revealFile: (path) => shell.showItemInFolder(path),
    scriptAllowed: (id) => scriptTrust.isAllowed(id),
    blockScript: (id) => scriptTrust.block(id),
    allowScript: (id) => scriptTrust.allow(id),
    scriptStatus: (id) => scripts.status(id),
    restartScript: (id) => scripts.restart(id),
    openPath: async (path) => {
      const failure = await shell.openPath(path);
      return failure ? { ok: false, error: failure } : { ok: true };
    },
    openRoot: async () => {
      const failure = await shell.openPath(paths.charactersRoot());
      return failure ? { ok: false, error: failure } : { ok: true };
    },
    settings: settingsView,
    updateSettings: (patch) => settings.update(patch),
    // A development run is electron.exe with the project beside it; the installed app is its own exe.
    executable: () => (app.isPackaged ? [process.execPath] : [process.execPath, app.getAppPath()]),
    copyText: (text) => clipboard.writeText(text),
    runningPrograms: async () => {
      const sensors = await loadDesktopSensors();
      if (!sensors) return [];
      return [...sensors.runningApps()].map((stem) => `${stem}.exe`).sort((a, b) => a.localeCompare(b));
    }
  });
  editor.onClosed = () => windows.setPreview(null);

  const menuState = (): MenuState => ({
    everyoneHidden: visibility.everyoneHidden,
    muted: settings.current.muted,
    isSnoozed: (id) => visibility.isSnoozed(id)
  });

  const dispatch = (action: MenuAction): void => {
    switch (action.type) {
      case 'setEnabled': {
        const character = characters.get(action.id);
        if (!character) return;
        // Switched on by hand means wanted now, whatever it was hidden for.
        if (action.enabled) visibility.show(action.id);
        const result = characters.save({ ...character, enabled: action.enabled });
        if (!result.ok) log.warn(`could not switch "${action.id}": ${result.error}`);
        return;
      }
      case 'hide':
        return visibility.hide(action.id, action.choice);
      case 'show':
        return visibility.show(action.id);
      case 'setEveryoneHidden':
        return visibility.setEveryoneHidden(action.hidden);
      case 'setMuted':
        settings.update({ muted: action.muted });
        return;
      case 'openEditor':
        return editor.open();
      case 'openCharactersFolder':
        void shell.openPath(paths.charactersRoot()).then((failure) => {
          if (failure) log.warn(`cannot open the characters folder: ${failure}`);
        });
        return;
      case 'quit':
        return app.quit();
    }
  };

  const tray = new AppTray({
    iconPath: AppTray.defaultIconPath(paths.iconsDir()),
    menu: () => trayMenu(characters.list(), menuState()),
    tooltip: () => trayTooltip(menuState()),
    dispatch,
    // The quick way to clear the screen, and to get everyone back.
    onClick: () => visibility.toggleEveryone()
  });
  tray.create();

  const resync = (): void => {
    presence.setCharacters(watched());
    const active = acting();
    rules.setCharacters(active);
    scripts.setCharacters(active);
    // Whoever is off, gone or hidden stops mid-sentence.
    const activeIds = new Set(active.map((character) => character.id));
    for (const entry of characters.list()) if (!activeIds.has(entry.id)) director.forget(entry.id);
    windows.refresh();
    tray.refresh();
    editor.send(IPC.editorChanged, characters.list());
  };
  characters.onChange(resync);
  scriptTrust.onChange(resync);
  visibility.onChange(resync);
  // Quiet hours start and end on their own: what is sounding has to hear about it. Armed only while they are on.
  let quietTimer: NodeJS.Timeout | null = null;
  const armQuietHours = (): void => {
    if (quietTimer) clearTimeout(quietTimer);
    quietTimer = null;
    const { enabled, from, to } = settings.current.quietHours;
    if (!enabled) return;
    const wait = msUntilClockChange(Date.now(), from, to);
    if (wait === null) return;
    quietTimer = setTimeout(() => {
      windows.refresh();
      armQuietHours();
    }, wait);
    quietTimer.unref?.();
  };
  armQuietHours();

  settings.onChange((next) => {
    if (next.muted) director.silenceAll();
    tray.refresh();
    windows.refresh();
    armQuietHours();
    editor.send(IPC.editorSettingsChanged, settingsView());
  });

  // Started again while already running: that is someone looking for the
  // app, and the editor is the only window it has to show them.
  app.on('second-instance', (_event, argv, _cwd, data) => {
    // Started with a signal: that is a script talking to the characters, not someone looking for the editor.
    const signal = signalFromData(data);
    if (signal) {
      log.info(`signal ${signal.name}${signal.text ? `: ${signal.text}` : ''}`);
      rules.event({ type: 'signal', name: signal.name, text: signal.text });
      return;
    }
    // A broken signal is still not a reason to open the editor. Its reason comes through the lock: by
    // the time Chromium hands argv over here, it has moved the arguments about.
    const refused = (data as { signalRefused?: unknown } | null)?.signalRefused;
    if (typeof refused === 'string') return void log.warn(`signal refused: ${refused.slice(0, 300)}`);
    if (parseSignalArgs(argv).kind !== 'none') return;
    editor.open();
  });
  if (process.argv.includes('--editor')) editor.open();

  // The app lives in the tray; it never quits from window state.
  app.on('window-all-closed', () => {
    /* no-op by design */
  });

  app.on('before-quit', () => {
    editor.destroy();
    rules.stop();
    scripts.stop();
    director.silenceAll();
    windows.stop();
    presence.stop();
    visibility.stop();
    tray.destroy();
  });

  // Once the windows have had a moment to come up, so a sound has somewhere to play.
  setTimeout(() => rules.event({ type: 'startup' }), 3_000).unref?.();

  log.info('Jacqueline ready');
}

/** Settings as the editor shows them. */
function settingsViewOf(settings: Settings): SettingsView {
  return { settings, autostartAvailable: app.isPackaged };
}

/** Reads the real value and reconciles, rather than assuming. */
function reconcileAutostart(wanted: boolean): void {
  // A development run is `electron.exe` with the project as an argument. The
  // login item it would register is the bare binary — which opens Electron's
  // welcome window at every login — under the same name as the installed
  // app's entry, which it would overwrite.
  if (!app.isPackaged) return;
  try {
    // SHARD's own entry, under its old name, would start an exe that is no longer there.
    app.setLoginItemSettings({ openAtLogin: false, name: LEGACY_LOGIN_ITEM });
  } catch (err) {
    log.warn(`cannot remove SHARD's old autostart entry: ${String(err)}`);
  }
  try {
    const current = app.getLoginItemSettings({ args: ['--hidden'] });
    if (current.openAtLogin === wanted) return;
    app.setLoginItemSettings({ openAtLogin: wanted, args: ['--hidden'] });
    log.info(`autostart set to ${wanted}`);
  } catch (err) {
    log.warn(`cannot reconcile autostart: ${String(err)}`);
  }
}
