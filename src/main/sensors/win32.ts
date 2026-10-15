/**
 * What the desktop is doing, asked of Windows directly from this process.
 *
 * This replaces a long-lived PowerShell host that answered the same questions
 * over stdin in 11–45 ms each and could not start until 90 s after launch.
 * Measured here: the window in front in 4 µs, every running process in 8 ms,
 * and a change of foreground window arrives as an event rather than being
 * polled for at all.
 *
 * `koffi` is only loaded when something asks for these — a character that is
 * simply always on screen never pays for it.
 */

import { basename } from 'node:path';
import type { Rect } from '@shared/layout';
import { createLogger } from '../app/logger';
import { appStem } from '../characters/presence';

const log = createLogger('win32');

export interface DesktopSensors {
  /** Stem of the executable that owns the window in front; null when there is none or it cannot be read. */
  foregroundApp(): string | null;
  /**
   * The display the window in front covers completely, in physical pixels;
   * null when it is not fullscreen.
   */
  fullscreenDisplay(): Rect | null;
  /** Stems of every running executable. */
  runningApps(): Set<string>;
  /** Calls back whenever a different window comes to the front. */
  onForegroundChange(listener: () => void): () => void;
}

const EVENT_SYSTEM_FOREGROUND = 0x0003;
const WINEVENT_OUTOFCONTEXT = 0x0000;
const PROCESS_QUERY_LIMITED_INFORMATION = 0x1000;
const TH32CS_SNAPPROCESS = 0x2;
const MONITOR_DEFAULTTONEAREST = 2;

/** The desktop and the shell are always "fullscreen" and never mean it. */
const SHELL_CLASSES = new Set(['Progman', 'WorkerW', 'Shell_TrayWnd', 'Windows.UI.Core.CoreWindow']);

interface RectStruct {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

let shared: Promise<DesktopSensors | null> | null = null;

/**
 * Null anywhere but Windows, and on Windows if the library will not load.
 * Loaded once, however many ask: presence and rules share the same bindings.
 */
export function loadDesktopSensors(): Promise<DesktopSensors | null> {
  shared ??= load();
  return shared;
}

async function load(): Promise<DesktopSensors | null> {
  if (process.platform !== 'win32') return null;
  try {
    const koffi = (await import('koffi')).default;
    return createSensors(koffi);
  } catch (err) {
    log.error(`desktop sensors unavailable: ${String(err)}`);
    return null;
  }
}

type Koffi = (typeof import('koffi'))['default'];

function createSensors(koffi: Koffi): DesktopSensors {
  const user32 = koffi.load('user32.dll');
  const kernel32 = koffi.load('kernel32.dll');

  const RECT = koffi.struct('RECT', { left: 'int32_t', top: 'int32_t', right: 'int32_t', bottom: 'int32_t' });
  const MONITORINFO = koffi.struct('MONITORINFO', {
    cbSize: 'uint32_t',
    rcMonitor: RECT,
    rcWork: RECT,
    dwFlags: 'uint32_t'
  });
  const PROCESSENTRY32W = koffi.struct('PROCESSENTRY32W', {
    dwSize: 'uint32_t',
    cntUsage: 'uint32_t',
    th32ProcessID: 'uint32_t',
    th32DefaultHeapID: 'uintptr_t',
    th32ModuleID: 'uint32_t',
    cntThreads: 'uint32_t',
    th32ParentProcessID: 'uint32_t',
    pcPriClassBase: 'int32_t',
    dwFlags: 'uint32_t',
    szExeFile: koffi.array('char16_t', 260)
  });
  const WinEventProc = koffi.proto(
    'void __stdcall WinEventProc(void* hook, uint32_t event, void* hwnd, int32_t idObject, int32_t idChild, uint32_t thread, uint32_t time)'
  );

  const GetForegroundWindow = user32.func('void* __stdcall GetForegroundWindow()');
  const GetWindowThreadProcessId = user32.func('uint32_t __stdcall GetWindowThreadProcessId(void* hwnd, _Out_ uint32_t* pid)');
  const GetClassNameW = user32.func('int __stdcall GetClassNameW(void* hwnd, void* buffer, int max)');
  const GetWindowRect = user32.func('bool __stdcall GetWindowRect(void* hwnd, _Out_ RECT* rect)');
  const MonitorFromWindow = user32.func('void* __stdcall MonitorFromWindow(void* hwnd, uint32_t flags)');
  const GetMonitorInfoW = user32.func('bool __stdcall GetMonitorInfoW(void* monitor, _Inout_ MONITORINFO* info)');
  const SetWinEventHook = user32.func(
    'void* __stdcall SetWinEventHook(uint32_t min, uint32_t max, void* module, WinEventProc* callback, uint32_t pid, uint32_t thread, uint32_t flags)'
  );
  const UnhookWinEvent = user32.func('bool __stdcall UnhookWinEvent(void* hook)');

  const OpenProcess = kernel32.func('void* __stdcall OpenProcess(uint32_t access, bool inherit, uint32_t pid)');
  const QueryFullProcessImageNameW = kernel32.func(
    'bool __stdcall QueryFullProcessImageNameW(void* process, uint32_t flags, void* buffer, _Inout_ uint32_t* size)'
  );
  const CloseHandle = kernel32.func('bool __stdcall CloseHandle(void* handle)');
  const CreateToolhelp32Snapshot = kernel32.func('void* __stdcall CreateToolhelp32Snapshot(uint32_t flags, uint32_t pid)');
  const Process32FirstW = kernel32.func('bool __stdcall Process32FirstW(void* snapshot, _Inout_ PROCESSENTRY32W* entry)');
  const Process32NextW = kernel32.func('bool __stdcall Process32NextW(void* snapshot, _Inout_ PROCESSENTRY32W* entry)');

  const textBuffer = Buffer.alloc(1040);

  // A window's title changes far more often than its owner, and the name
  // costs a process handle: looked up once per pid.
  let cachedPid = 0;
  let cachedStem: string | null = null;

  const processes = (): { pid: number; stem: string }[] => {
    const found: { pid: number; stem: string }[] = [];
    const snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
    if (!snapshot) return found;
    try {
      const entry: { dwSize: number; th32ProcessID?: number; szExeFile?: string } = {
        dwSize: koffi.sizeof(PROCESSENTRY32W)
      };
      let more = Process32FirstW(snapshot, entry) as boolean;
      while (more) {
        if (entry.szExeFile) found.push({ pid: entry.th32ProcessID ?? 0, stem: appStem(String(entry.szExeFile)) });
        more = Process32NextW(snapshot, entry) as boolean;
      }
    } finally {
      CloseHandle(snapshot);
    }
    return found;
  };

  const stemOfPid = (pid: number): string | null => {
    const handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, pid);
    if (handle) {
      try {
        const size = [textBuffer.length / 2];
        if (QueryFullProcessImageNameW(handle, 0, textBuffer, size)) {
          return appStem(basename(textBuffer.toString('utf16le', 0, (size[0] ?? 0) * 2)));
        }
      } finally {
        CloseHandle(handle);
      }
    }
    // Refused for elevated and protected processes; the process list still names them.
    return processes().find((entry) => entry.pid === pid)?.stem ?? null;
  };

  return {
    foregroundApp(): string | null {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return null;
      const pid = [0];
      GetWindowThreadProcessId(hwnd, pid);
      if (!pid[0]) return null;
      if (pid[0] !== cachedPid) {
        cachedPid = pid[0];
        cachedStem = stemOfPid(pid[0]);
      }
      return cachedStem;
    },

    fullscreenDisplay(): Rect | null {
      const hwnd = GetForegroundWindow();
      if (!hwnd) return null;

      const length = GetClassNameW(hwnd, textBuffer, 256) as number;
      if (SHELL_CLASSES.has(textBuffer.toString('utf16le', 0, length * 2))) return null;

      const rect = {} as RectStruct;
      if (!GetWindowRect(hwnd, rect)) return null;

      const info = { cbSize: koffi.sizeof(MONITORINFO) } as { cbSize: number; rcMonitor?: RectStruct };
      if (!GetMonitorInfoW(MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST), info) || !info.rcMonitor) return null;
      const monitor = info.rcMonitor;

      const covers =
        rect.left <= monitor.left && rect.top <= monitor.top && rect.right >= monitor.right && rect.bottom >= monitor.bottom;
      if (!covers) return null;
      return { x: monitor.left, y: monitor.top, width: monitor.right - monitor.left, height: monitor.bottom - monitor.top };
    },

    runningApps(): Set<string> {
      return new Set(processes().map((entry) => entry.stem));
    },

    onForegroundChange(listener: () => void): () => void {
      // Delivered on this thread's message loop, which Electron's main
      // process pumps anyway: no hook thread, no polling.
      const callback = koffi.register(() => {
        try {
          listener();
        } catch (err) {
          log.warn(`foreground listener threw: ${String(err)}`);
        }
      }, koffi.pointer(WinEventProc));
      const hook = SetWinEventHook(EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_FOREGROUND, null, callback, 0, 0, WINEVENT_OUTOFCONTEXT);
      if (!hook) log.warn('could not hook foreground changes');
      return () => {
        if (hook) UnhookWinEvent(hook);
        koffi.unregister(callback);
      };
    }
  };
}
