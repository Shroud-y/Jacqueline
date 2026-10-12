import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_RANK: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface Logger {
  debug(message: string, ...rest: unknown[]): void;
  info(message: string, ...rest: unknown[]): void;
  warn(message: string, ...rest: unknown[]): void;
  error(message: string, ...rest: unknown[]): void;
  child(scope: string): Logger;
}

let minLevel: LogLevel = process.env.NODE_ENV === 'development' ? 'debug' : 'info';
let logFile: string | null = null;

export function configureLogger(options: { level?: LogLevel; directory?: string }): void {
  if (options.level) minLevel = options.level;
  if (options.directory) {
    try {
      mkdirSync(options.directory, { recursive: true });
      logFile = join(options.directory, 'shard.log');
    } catch {
      logFile = null;
    }
  }
}

function write(level: LogLevel, scope: string, message: string, rest: unknown[]): void {
  if (LEVEL_RANK[level] < LEVEL_RANK[minLevel]) return;

  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  const consoleFn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  consoleFn(line, ...rest);

  if (logFile && LEVEL_RANK[level] >= LEVEL_RANK.info) {
    try {
      appendFileSync(logFile, `${line}\n`, 'utf8');
    } catch {
      // Logging must never break the app.
    }
  }
}

export function createLogger(scope: string): Logger {
  return {
    debug: (message, ...rest) => write('debug', scope, message, rest),
    info: (message, ...rest) => write('info', scope, message, rest),
    warn: (message, ...rest) => write('warn', scope, message, rest),
    error: (message, ...rest) => write('error', scope, message, rest),
    child: (child) => createLogger(`${scope}:${child}`)
  };
}
