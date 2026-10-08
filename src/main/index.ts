import { app, dialog, globalShortcut, ipcMain, net, protocol } from 'electron';
import { pathToFileURL } from 'node:url';
import {
  mkdirSync,
  existsSync,
  statSync,
  copyFileSync,
  renameSync,
  rmSync,
  readFileSync,
  unlinkSync
} from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

import { IPC } from '@shared/ipc';
import {
  BUILTIN_PRESET_ID,
  type CueSources,
  type DebugSnapshot,
  type FrequencyProfile,
  type OverlaySettings,
  type Preset,
  type PresetAssetKind,
  type PresetAssetResult,
  type PresetAssetStatus,
  type Settings
} from '@shared/types';

import { EventBus } from './core/eventBus';
import {
  ALL_EVENT_TYPES,
  createEvent,
  defaultPriorityFor,
  EventType,
  type AppEvent
} from './core/events';
import {
  CooldownKey,
  CooldownLedger,
  createDurationResolver,
  FREQUENCY_MULTIPLIER
} from './core/cooldown';
import { RecentHistory } from './core/selector';
import {
  PhraseBankError,
  loadPhraseBank,
  loadPresetBank,
  parsePhraseBank,
  type PhraseBankIndex
} from './core/phraseBank';
import { TriggerEngine } from './core/triggerEngine';
import { SpeechDirector } from './core/speechDirector';
import { RuntimeState, type SnoozeChoice } from './core/runtimeState';
import {
  DEFAULT_BOOT_GRACE_MS,
  evaluateSuppression,
  type SuppressionState
} from './core/suppression';

import { SharedScheduler } from './monitors/Monitor';
import { SystemMonitor } from './monitors/systemMonitor';
import { ProcessMonitor } from './monitors/processMonitor';
import { IdleMonitor } from './monitors/idleMonitor';
import { ScheduleMonitor } from './monitors/scheduleMonitor';
import { SessionMonitor } from './monitors/sessionMonitor';
import { FileMonitor } from './monitors/fileMonitor';
import type { Monitor } from './monitors/Monitor';

import { OverlayWindow } from './window/overlayWindow';
import { debugWindow, settingsWindow } from './window/panelWindows';
import { CodexTray, isDevBuild, startTrayRefreshLoop } from './tray/tray';
import { PresenceProbe } from './system/presenceProbe';
import { processListerFor, systemQueriesFor } from './system/systemQueries';
import { SettingsStore, defaultSettings } from './settings/settings';
import { StateStore } from './settings/stateStore';
import { configureLogger, createLogger } from './log/logger';
import { NullVoiceEngine } from './voice/NullVoiceEngine';
import { AUDIO_SCHEME, PrerenderedVoiceEngine, audioDirHasFiles } from './voice/PrerenderedVoiceEngine';
import { CUE_EXTENSIONS, resolveCueSources, resolvePresetCueSources, type CueId } from './voice/cueAudio';
import type { VoiceEngine } from './voice/VoiceEngine';
import {
  VIDEO_EXTENSIONS,
  presetVideoFileName,
  resolvePresetVideoFile,
  type VideoExtension
} from './media/appearanceVideo';
import { paths } from './paths';

const log = createLogger('main');

/** The group the tray's "Say something now" draws from. */
const UNPROMPTED_GROUP = 'ambient.unprompted';
/** Phase 2's command palette gets a home now so it costs nothing later (§19). */
const COMMAND_PALETTE_ACCELERATOR = 'CommandOrControl+Alt+Shift+C';

/** Custom scheme a preset's appearance video (and its own cue sounds) load through, same reasoning as `AUDIO_SCHEME`. */
const ASSET_SCHEME = 'codex-asset';

/** A user-supplied video this large would cost real overlay-renderer memory (§ electron-measurement-traps). */
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;

// A Web Audio context in a page that never receives a click stays suspended
// under Chromium's default autoplay policy, and the overlay is click-through:
// it can never get that gesture. Without this the appear/disappear cues are
// silent in a packaged build while working fine in the design harness.
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

// Must run before `app.whenReady` — the overlay loads audio and preset assets
// through these schemes.
protocol.registerSchemesAsPrivileged([
  { scheme: AUDIO_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
]);

if (!app.requestSingleInstanceLock()) {
  app.exit(0);
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  await app.whenReady();

  configureLogger({ directory: paths.logDir(), level: isDevBuild() ? 'debug' : 'info' });
  app.setAppUserModelId('dev.codex.companion');

  /* ---------------------------------------------------------------- */
  /* Phrase bank — a schema violation is a fatal startup error (§6).   */
  /* ---------------------------------------------------------------- */
  let defaultBank: PhraseBankIndex;
  try {
    defaultBank = loadPhraseBank(paths.phraseBank());
    log.info(
      `phrase bank loaded: ${defaultBank.phraseCount} phrases in ${defaultBank.groupIds().length} groups`
    );
  } catch (err) {
    const message = err instanceof PhraseBankError ? err.message : String(err);
    log.error(message);
    dialog.showErrorBox('SHARD cannot start', message);
    app.exit(1);
    return;
  }

  /* ---------------------------------------------------------------- */
  /* Settings and persisted state                                      */
  /* ---------------------------------------------------------------- */
  const settingsStore = new SettingsStore(
    paths.settingsFile(),
    defaultSettings(safeDownloadsPath())
  );

  const ledger = new CooldownLedger(
    createDurationResolver(() => FREQUENCY_MULTIPLIER[settingsStore.current.frequencyProfile])
  );
  const history = new RecentHistory();
  const stateStore = new StateStore(paths.stateFile(), ledger, history);
  const bootAt = Date.now();
  const firstRun = stateStore.load(bootAt);

  /* ---------------------------------------------------------------- */
  /* Windows, tray, probes                                             */
  /* ---------------------------------------------------------------- */
  const runtime = new RuntimeState();
  const overlay = new OverlayWindow();
  overlay.create(OverlayWindow.preloadPath());
  overlay.setOffsets(settingsStore.current.overlay);
  overlay.setAudioOptions(audioOptionsFrom(settingsStore.current.overlay));

  // Files win over the synthesised cues, checked once here — same bargain as
  // the voice engine, and the same restart to pick a new shipped one up. A
  // preset's own cue files (checked per-preset in `resolveActivePreset`) win
  // over these in turn.
  const defaultCues = resolveCueSources(paths.cueDir());
  log.info(
    `default cues: appear ${defaultCues.appear ? 'file' : 'synthesised'}, ` +
      `disappear ${defaultCues.disappear ? 'file' : 'synthesised'}`
  );

  const probe = new PresenceProbe(paths.probeDir());
  probe.start();

  registerAudioProtocol();
  registerAssetProtocol();

  const getSuppression = (now: number): SuppressionState =>
    evaluateSuppression({
      now,
      muted: runtime.isMuted,
      snoozedUntil: normaliseSnooze(runtime.snoozeUntil(now)),
      quietHours: settingsStore.current.quietHours,
      suppressOnFullscreen: settingsStore.current.suppressOnFullscreen,
      fullscreenActive: probe.fullscreenActive,
      suppressOnMicrophoneUse: settingsStore.current.suppressOnMicrophoneUse,
      microphoneActive: probe.microphoneActive,
      bootAt,
      bootGraceMs: DEFAULT_BOOT_GRACE_MS
    });

  /* ---------------------------------------------------------------- */
  /* Voice engine — selection is automatic (§14.3)                     */
  /* ---------------------------------------------------------------- */
  // Criterion 12 says dropping a `<phraseId>.ogg` in here must be enough, so
  // the folder has to exist even when the build shipped it empty.
  try {
    mkdirSync(paths.audioDir(), { recursive: true });
  } catch (err) {
    log.warn(`cannot create audio directory: ${(err as Error).message}`);
  }

  // The prerendered engine needs the director to learn when playback ended,
  // and the director needs the engine to speak. One holder breaks the knot.
  const directorRef: { current: SpeechDirector | null } = { current: null };

  const voice: VoiceEngine = audioDirHasFiles(paths.audioDir())
    ? new PrerenderedVoiceEngine({
        audioDir: paths.audioDir(),
        awaitPlayback: (phraseId, timeoutMs) =>
          directorRef.current?.awaitPlaybackAck(phraseId, timeoutMs) ?? Promise.resolve(),
        logDebug: (message) => log.debug(message)
      })
    : new NullVoiceEngine();
  log.info(`voice engine: ${voice.available ? 'prerendered audio' : 'text only'}`);

  const director = new SpeechDirector({
    bank: defaultBank,
    ledger,
    history,
    voice,
    overlay,
    getSuppression,
    getConditionContext: (now) => ({
      uptimeMinutes: (now - bootAt) / 60_000,
      firstRun
    }),
    logDebug: (message) => log.debug(message),
    logInfo: (message) => log.info(message)
  });
  directorRef.current = director;
  director.start();

  /* ---------------------------------------------------------------- */
  /* Event pipeline                                                    */
  /* ---------------------------------------------------------------- */
  const bus = new EventBus();
  const triggers = new TriggerEngine(defaultBank);

  const dangling = triggers.danglingRules();
  if (dangling.length > 0) {
    log.error(
      `trigger rules reference missing phrase groups: ${dangling
        .map((entry) => `${entry.ruleId} → ${entry.groupId}`)
        .join(', ')}`
    );
  }

  // Now that the director and trigger engine exist, resolve and apply the
  // preset settings actually named at startup — this is what pushes the
  // real bank/cues/skin/name/video to the overlay for the first time.
  applyPreset(settingsStore.current.activePresetId);

  bus.on('*', (event: AppEvent) => {
    const now = Date.now();
    const candidates = triggers.match(event, {
      uptimeMinutes: (now - bootAt) / 60_000,
      firstRun
    });
    for (const candidate of candidates) {
      director.submit({
        origin: 'trigger',
        groupId: candidate.groupId,
        category: candidate.category,
        priority: candidate.priority,
        ruleId: candidate.ruleId,
        event: candidate.event,
        bypassBootGrace: candidate.event.type === EventType.sessionStartup
      });
    }
    stateStore.scheduleSave();
    pushDebugSnapshot();
  });

  /* ---------------------------------------------------------------- */
  /* Monitors                                                          */
  /* ---------------------------------------------------------------- */
  const scheduler = new SharedScheduler(5_000);
  const idleMonitor = new IdleMonitor(scheduler);

  const monitors: Record<string, Monitor> = {
    // Both of these read the machine through the probe host that is already
    // running — see `systemQueries` for what that replaced and why.
    system: new SystemMonitor(scheduler, systemQueriesFor(probe)),
    process: new ProcessMonitor(
      scheduler,
      () => settingsStore.current.watchedProcesses,
      processListerFor(probe)
    ),
    idle: idleMonitor,
    schedule: new ScheduleMonitor(
      scheduler,
      () => idleMonitor.isIdle,
      // The `global` stamp is exactly "when Codex last spoke", and it is
      // persisted, so a restart does not reset the silence timer.
      () => ledger.lastFiredAt(CooldownKey.global()),
      () => FREQUENCY_MULTIPLIER[settingsStore.current.frequencyProfile]
    ),
    session: new SessionMonitor(),
    file: new FileMonitor(() => settingsStore.current.watchedFolders)
  };

  const started = new Set<string>();
  // The file monitor reads its folders once, at start, so a change to the list
  // is applied by restarting it.
  let watchedFoldersKey = settingsStore.current.watchedFolders.join('\n');
  const applyMonitors = async (settings: Settings): Promise<void> => {
    const foldersKey = settings.watchedFolders.join('\n');
    const foldersChanged = foldersKey !== watchedFoldersKey;
    watchedFoldersKey = foldersKey;

    for (const [id, monitor] of Object.entries(monitors)) {
      const wanted = settings.monitors[id] !== false;
      if (wanted && !started.has(id)) {
        await monitor.start(bus);
        started.add(id);
        log.info(`monitor started: ${id}`);
      } else if (!wanted && started.has(id)) {
        await monitor.stop();
        started.delete(id);
        log.info(`monitor stopped: ${id}`);
      } else if (wanted && id === 'file' && foldersChanged) {
        await monitor.stop();
        await monitor.start(bus);
        log.info('monitor restarted: file (watched folders changed)');
      }
    }
  };
  // Settings change on every keystroke in the panel; overlapping runs would
  // each see the monitor as started and both restart it, doubling watchers.
  let monitorSync: Promise<void> = Promise.resolve();
  const syncMonitors = (settings: Settings): Promise<void> => {
    monitorSync = monitorSync
      .then(() => applyMonitors(settings))
      .catch((err) => log.warn(`monitor sync failed: ${String(err)}`));
    return monitorSync;
  };

  await syncMonitors(settingsStore.current);
  scheduler.start();

  /* ---------------------------------------------------------------- */
  /* Tray                                                              */
  /* ---------------------------------------------------------------- */
  const tray = new CodexTray({
    iconPath: CodexTray.defaultIconPath(paths.iconsDir()),
    state: runtime,
    getFrequency: () => settingsStore.current.frequencyProfile,
    isDev: isDevBuild(),
    actions: {
      saySomethingNow: () => {
        director.submit({
          origin: 'tray',
          groupId: UNPROMPTED_GROUP,
          category: 'ambient',
          priority: 'notable',
          bypassCooldowns: true,
          bypassSuppression: true
        });
      },
      setSnooze: (choice: SnoozeChoice) => runtime.setSnooze(choice, Date.now()),
      setFrequency: (profile: FrequencyProfile) =>
        settingsStore.update({ frequencyProfile: profile }),
      openSettings: () => settingsWindow.open(),
      openDebug: () => debugWindow.open(),
      quit: () => {
        quitting = true;
        app.quit();
      }
    }
  });
  tray.create();
  const stopTrayLoop = startTrayRefreshLoop(tray);

  runtime.onChange((state) => {
    overlay.sendState(state);
    tray.refresh();
    if (state.muted) director.interrupt();
  });

  settingsStore.onChange((settings) => {
    overlay.setOffsets(settings.overlay);
    overlay.setAudioOptions(audioOptionsFrom(settings.overlay));
    applyPreset(settings.activePresetId);
    void syncMonitors(settings);
    reconcileAutostart(settings.startWithSystem);
    settingsWindow.send(IPC.settingsUpdated, settings);
    tray.refresh();
  });

  reconcileAutostart(settingsStore.current.startWithSystem);

  /* ---------------------------------------------------------------- */
  /* IPC — every renderer→main payload is validated (§12)              */
  /* ---------------------------------------------------------------- */
  const speechAckSchema = z.object({ speechId: z.string().min(1) });

  ipcMain.on(IPC.overlaySetInteractive, (_event, payload: unknown) => {
    if (typeof payload !== 'boolean') return;
    overlay.setInteractive(payload);
  });

  ipcMain.on(IPC.speechFinished, (_event, payload: unknown) => {
    const parsed = speechAckSchema.safeParse(payload);
    if (!parsed.success) return;
    director.finish(parsed.data.speechId);
  });

  ipcMain.on(IPC.speechDismissed, (_event, payload: unknown) => {
    const parsed = speechAckSchema.safeParse(payload);
    if (!parsed.success) return;
    director.dismiss(parsed.data.speechId);
  });

  ipcMain.handle(IPC.settingsGet, () => settingsStore.current);

  ipcMain.handle(IPC.settingsSet, (_event, payload: unknown) => {
    if (!payload || typeof payload !== 'object') return settingsStore.current;
    return settingsStore.update(payload as Partial<Settings>);
  });

  const presetAssetKindSchema = z.enum(['bank', 'appearSound', 'disappearSound', 'video']);
  const presetIdSchema = z.object({ presetId: z.string().min(1) });

  ipcMain.handle(IPC.presetsPickAsset, async (_event, payload: unknown) => {
    const parsed = z.object({ presetId: z.string().min(1), kind: presetAssetKindSchema }).safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'invalid request' };
    return pickPresetAsset(parsed.data.presetId, parsed.data.kind);
  });

  ipcMain.handle(IPC.presetsClearAsset, (_event, payload: unknown) => {
    const parsed = z.object({ presetId: z.string().min(1), kind: presetAssetKindSchema }).safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'invalid request' };
    return clearPresetAsset(parsed.data.presetId, parsed.data.kind);
  });

  ipcMain.handle(IPC.presetsAssetStatus, (_event, payload: unknown) => {
    const parsed = presetIdSchema.safeParse(payload);
    if (!parsed.success) return { hasBank: false, hasAppear: false, hasDisappear: false, hasVideo: false };
    return assetStatusFor(parsed.data.presetId);
  });

  ipcMain.handle(IPC.presetsDelete, (_event, payload: unknown) => {
    const parsed = presetIdSchema.safeParse(payload);
    if (!parsed.success) return { ok: false, error: 'invalid request' };
    return deletePresetById(parsed.data.presetId);
  });

  ipcMain.handle(IPC.debugRequestSnapshot, () => buildDebugSnapshot());

  ipcMain.on(IPC.debugFireEvent, (_event, payload: unknown) => {
    const parsed = z.object({ type: z.string().min(1) }).safeParse(payload);
    if (!parsed.success) return;
    const type = parsed.data.type;
    bus.emit(createEvent(type, defaultPriorityFor(type), syntheticPayload(type), Date.now()));
  });

  /* ---------------------------------------------------------------- */
  /* Global shortcut seam (§19)                                        */
  /* ---------------------------------------------------------------- */
  try {
    const registered = globalShortcut.register(COMMAND_PALETTE_ACCELERATOR, () => {
      // Phase 2 opens the command palette here.
      log.debug('command palette shortcut pressed (no-op in Phase 1)');
    });
    if (!registered) log.warn(`could not register ${COMMAND_PALETTE_ACCELERATOR}`);
  } catch (err) {
    log.warn(`global shortcut registration failed: ${String(err)}`);
  }

  /* ---------------------------------------------------------------- */
  /* Lifecycle                                                         */
  /* ---------------------------------------------------------------- */
  let quitting = false;

  // The app never quits from window state.
  app.on('window-all-closed', () => {
    /* no-op by design */
  });

  app.on('second-instance', () => {
    // Deliberately does nothing: a second launch focuses nothing and exits.
  });

  app.on('before-quit', () => {
    quitting = true;
    stopTrayLoop();
    stateStore.save();
    director.stop();
    scheduler.stop();
    probe.stop();
    for (const monitor of Object.values(monitors)) void monitor.stop();
    globalShortcut.unregisterAll();
    tray.destroy();
  });

  process.on('exit', () => {
    if (!quitting) stateStore.save();
  });

  log.info(`Codex ready (first run: ${firstRun})`);

  /* ---------------------------------------------------------------- */
  /* Preset resolution and asset management                            */
  /* ---------------------------------------------------------------- */

  function findPreset(id: string): Preset {
    return (
      settingsStore.current.presets.find((p) => p.id === id) ??
      settingsStore.current.presets.find((p) => p.id === BUILTIN_PRESET_ID) ??
      settingsStore.current.presets[0]!
    );
  }

  /**
   * Everything the active preset determines, resolved from disk. A missing
   * override file at any of the three paths falls through to the shipped
   * default — the same "file present → used" bargain the cue sounds and the
   * prerendered voice engine already make.
   */
  function resolveActivePreset(id: string): {
    preset: Preset;
    bank: PhraseBankIndex;
    cues: CueSources;
    videoUrl: string | null;
  } {
    const preset = findPreset(id);

    const bankOverride = paths.presetBankFile(preset.id);
    let bank = defaultBank;
    if (existsSync(bankOverride)) {
      try {
        bank = loadPresetBank(defaultBank.bank, bankOverride);
      } catch (err) {
        log.error(`preset "${preset.id}" bank override invalid, using default: ${String(err)}`);
      }
    }

    const presetCues = resolvePresetCueSources(paths.presetDir(preset.id), preset.id, ASSET_SCHEME);
    const cues: CueSources = {
      appear: presetCues.appear ?? defaultCues.appear,
      disappear: presetCues.disappear ?? defaultCues.disappear
    };

    const videoFileName = presetVideoFileName(paths.presetDir(preset.id));
    const videoUrl = videoFileName ? `${ASSET_SCHEME}://video/${preset.id}/${videoFileName}` : null;

    return { preset, bank, cues, videoUrl };
  }

  /** Swaps in whichever preset is now active — startup and every settings change alike. */
  function applyPreset(id: string): void {
    const resolved = resolveActivePreset(id);
    director.setBank(resolved.bank);
    triggers.setBank(resolved.bank);
    overlay.setPreset({
      name: resolved.preset.name,
      skinId: resolved.preset.skinId,
      cues: resolved.cues,
      videoUrl: resolved.videoUrl
    });
  }

  /** Removes every `appear.*`/`disappear.*` file in a preset dir, so a new upload never leaves a stale sibling extension for `resolveCueSources` to prefer. */
  function clearCueFiles(dir: string, cueId: CueId): void {
    for (const ext of CUE_EXTENSIONS) {
      const file = join(dir, `${cueId}${ext}`);
      if (existsSync(file)) unlinkSync(file);
    }
  }

  /** Same reasoning as `clearCueFiles`: an upload switching container (`.webm` <-> `.mp4`) must not leave the old one behind for `resolvePresetVideoFile` to prefer. */
  function clearVideoFiles(dir: string): void {
    for (const ext of VIDEO_EXTENSIONS) {
      const file = join(dir, `appearance${ext}`);
      if (existsSync(file)) unlinkSync(file);
    }
  }

  function copyAtomic(source: string, destination: string): void {
    const tmp = `${destination}.tmp`;
    copyFileSync(source, tmp);
    renameSync(tmp, destination);
  }

  async function pickPresetAsset(
    presetId: string,
    kind: PresetAssetKind
  ): Promise<PresetAssetResult> {
    if (!settingsStore.current.presets.some((p) => p.id === presetId)) {
      return { ok: false, error: 'unknown preset' };
    }

    const filters =
      kind === 'bank'
        ? [{ name: 'Phrase bank', extensions: ['json'] }]
        : kind === 'video'
          ? [{ name: 'Video', extensions: ['webm', 'mp4'] }]
          : [{ name: 'Audio', extensions: ['ogg', 'wav', 'mp3'] }];

    const parentWindow = settingsWindow.browserWindow;
    const picked = parentWindow
      ? await dialog.showOpenDialog(parentWindow, { properties: ['openFile'], filters })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters });
    if (picked.canceled || picked.filePaths.length === 0) return { ok: false, error: 'cancelled' };
    const source = picked.filePaths[0]!;
    const ext = source.slice(source.lastIndexOf('.')).toLowerCase();

    const dir = paths.presetDir(presetId);
    try {
      mkdirSync(dir, { recursive: true });

      if (kind === 'bank') {
        if (ext !== '.json') return { ok: false, error: 'expected a .json file' };
        const raw = JSON.parse(readFileSync(source, 'utf8')) as unknown;
        parsePhraseBank(raw, source);
        copyAtomic(source, paths.presetBankFile(presetId));
      } else if (kind === 'video') {
        if (!(VIDEO_EXTENSIONS as readonly string[]).includes(ext)) {
          return { ok: false, error: 'expected a .webm or .mp4 file' };
        }
        if (statSync(source).size > MAX_VIDEO_BYTES) {
          return { ok: false, error: `Video is larger than ${MAX_VIDEO_BYTES / (1024 * 1024)} MB` };
        }
        clearVideoFiles(dir);
        copyAtomic(source, join(dir, `appearance${ext as VideoExtension}`));
      } else {
        if (!(CUE_EXTENSIONS as readonly string[]).includes(ext)) {
          return { ok: false, error: 'expected a .ogg, .wav or .mp3 file' };
        }
        const cueId: CueId = kind === 'appearSound' ? 'appear' : 'disappear';
        clearCueFiles(dir, cueId);
        copyAtomic(source, join(dir, `${cueId}${ext}`));
      }
    } catch (err) {
      const message = err instanceof PhraseBankError ? err.message : String((err as Error).message ?? err);
      return { ok: false, error: message };
    }

    if (presetId === settingsStore.current.activePresetId) applyPreset(presetId);
    return { ok: true };
  }

  function clearPresetAsset(
    presetId: string,
    kind: PresetAssetKind
  ): PresetAssetResult {
    if (!settingsStore.current.presets.some((p) => p.id === presetId)) {
      return { ok: false, error: 'unknown preset' };
    }

    const dir = paths.presetDir(presetId);
    if (kind === 'bank') {
      const file = paths.presetBankFile(presetId);
      if (existsSync(file)) unlinkSync(file);
    } else if (kind === 'video') {
      clearVideoFiles(dir);
    } else {
      clearCueFiles(dir, kind === 'appearSound' ? 'appear' : 'disappear');
    }

    if (presetId === settingsStore.current.activePresetId) applyPreset(presetId);
    return { ok: true };
  }

  function assetStatusFor(presetId: string): PresetAssetStatus {
    const dir = paths.presetDir(presetId);
    const hasCue = (cueId: CueId): boolean =>
      CUE_EXTENSIONS.some((ext) => existsSync(join(dir, `${cueId}${ext}`)));
    return {
      hasBank: existsSync(paths.presetBankFile(presetId)),
      hasAppear: hasCue('appear'),
      hasDisappear: hasCue('disappear'),
      hasVideo: resolvePresetVideoFile(dir) !== null
    };
  }

  function deletePresetById(id: string): PresetAssetResult {
    if (id === BUILTIN_PRESET_ID) return { ok: false, error: 'cannot delete the built-in preset' };
    const current = settingsStore.current;
    if (!current.presets.some((p) => p.id === id)) return { ok: false, error: 'unknown preset' };

    settingsStore.update({
      presets: current.presets.filter((p) => p.id !== id),
      activePresetId: current.activePresetId === id ? BUILTIN_PRESET_ID : current.activePresetId
    });

    try {
      rmSync(paths.presetDir(id), { recursive: true, force: true });
    } catch (err) {
      log.warn(`could not remove assets for deleted preset "${id}": ${String(err)}`);
    }

    return { ok: true };
  }

  function registerAssetProtocol(): void {
    protocol.handle(ASSET_SCHEME, async (request) => {
      try {
        const url = new URL(request.url);
        const knownPreset = (presetId: string): boolean =>
          settingsStore.current.presets.some((p) => p.id === presetId);

        if (url.host === 'cue' || url.host === 'video') {
          const [presetId, fileName] = decodeURIComponent(url.pathname.replace(/^\//, '')).split('/');
          if (!presetId || !fileName) return new Response('not found', { status: 404 });
          // Path traversal guard: the preset id and filename must each be a bare segment.
          if (
            presetId.includes('\\') ||
            presetId.includes('..') ||
            fileName.includes('/') ||
            fileName.includes('\\') ||
            fileName.includes('..')
          ) {
            return new Response('forbidden', { status: 403 });
          }
          if (!knownPreset(presetId)) return new Response('not found', { status: 404 });
          return await net.fetch(pathToFileURL(join(paths.presetDir(presetId), fileName)).toString());
        }

        return new Response('not found', { status: 404 });
      } catch (err) {
        log.debug(`asset protocol failed: ${String(err)}`);
        return new Response('not found', { status: 404 });
      }
    });
  }

  /* ---------------------------------------------------------------- */
  /* Helpers that need the closure                                     */
  /* ---------------------------------------------------------------- */

  function buildDebugSnapshot(): DebugSnapshot {
    const now = Date.now();
    const suppression = getSuppression(now);
    return {
      events: bus.recent(100).map((event) => ({
        id: event.id,
        type: event.type,
        at: event.at,
        priority: event.priority,
        payload: event.payload
      })),
      cooldowns: ledger.active(now),
      suppression: {
        suppressed: suppression.suppressed,
        reason: suppression.reasons.join(', ') || null,
        hardMute: suppression.hardMute
      },
      deferred: director.deferredSnapshot(),
      knownEventTypes: ALL_EVENT_TYPES,
      frequencyProfile: settingsStore.current.frequencyProfile
    };
  }

  function pushDebugSnapshot(): void {
    if (!debugWindow.browserWindow) return;
    debugWindow.send(IPC.debugSnapshot, buildDebugSnapshot());
  }

  // Keep the debug panel live even when the bus is quiet.
  const debugTimer = setInterval(() => pushDebugSnapshot(), 2_000);
  debugTimer.unref?.();
}

/* ------------------------------------------------------------------ */
/* Module-level helpers                                                */
/* ------------------------------------------------------------------ */

function normaliseSnooze(value: number | null): number | null {
  if (value === null) return null;
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function audioOptionsFrom(overlay: OverlaySettings): {
  volume: number;
  appearEnabled: boolean;
  disappearEnabled: boolean;
} {
  return {
    volume: overlay.cueVolume,
    appearEnabled: overlay.appearSoundEnabled,
    disappearEnabled: overlay.disappearSoundEnabled
  };
}

function safeDownloadsPath(): string {
  try {
    return app.getPath('downloads');
  } catch {
    return '';
  }
}

/** Sample payloads so debug-fired events exercise the same conditions. */
function syntheticPayload(type: string): Record<string, unknown> {
  switch (type) {
    case EventType.sessionIdleExit:
      return { awayMs: 45 * 60_000, synthetic: true };
    case EventType.systemCpuHigh:
    case EventType.systemCpuSustained:
      return { load: 93, synthetic: true };
    case EventType.systemMemoryHigh:
      return { usedPercent: 94, synthetic: true };
    case EventType.systemTemperatureHigh:
      return { celsius: 91, synthetic: true };
    case EventType.systemDiskLow:
      return { mount: 'C:', freeGb: 4.2, synthetic: true };
    case EventType.systemBatteryLow:
      return { percent: 14, synthetic: true };
    case EventType.processStarted:
    case EventType.processStopped:
      return { name: 'Code.exe', synthetic: true };
    case EventType.processLongRunning:
      return { name: 'Code.exe', hours: 5, synthetic: true };
    case EventType.scheduleWorkBreak:
      return { activeMinutes: 92, synthetic: true };
    case EventType.scheduleUptimeMilestone:
      return { hours: 24, synthetic: true };
    case EventType.fileDownloadComplete:
    case EventType.fileBuildComplete:
      return { name: 'artifact.zip', count: 1, synthetic: true };
    default:
      return { synthetic: true };
  }
}

/**
 * Serves `codex-audio://phrase/<id>.ogg` from `resources/audio`, and
 * `codex-audio://cue/<name>.<ext>` from `resources/audio/cues`. The host is
 * the only thing that picks the directory; any other host is refused.
 */
function registerAudioProtocol(): void {
  protocol.handle(AUDIO_SCHEME, async (request) => {
    try {
      const url = new URL(request.url);
      const root =
        url.host === 'phrase' ? paths.audioDir() : url.host === 'cue' ? paths.cueDir() : null;
      if (!root) return new Response('not found', { status: 404 });
      const fileName = decodeURIComponent(url.pathname.replace(/^\//, ''));
      // Path traversal guard: only a bare filename is ever valid here.
      if (fileName.includes('/') || fileName.includes('\\') || fileName.includes('..')) {
        return new Response('forbidden', { status: 403 });
      }
      const filePath = join(root, fileName);
      return await net.fetch(pathToFileURL(filePath).toString());
    } catch (err) {
      log.debug(`audio protocol failed: ${String(err)}`);
      return new Response('not found', { status: 404 });
    }
  });
}

/** §11 — read the real value and reconcile, rather than assuming. */
function reconcileAutostart(wanted: boolean): void {
  try {
    const current = app.getLoginItemSettings({ args: ['--hidden'] });
    if (current.openAtLogin === wanted) return;
    app.setLoginItemSettings({ openAtLogin: wanted, args: ['--hidden'] });
    log.info(`autostart set to ${wanted}`);
  } catch (err) {
    log.warn(`cannot reconcile autostart: ${String(err)}`);
  }
}
