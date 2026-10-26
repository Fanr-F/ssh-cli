import { configure, getLogger, type Logger, type LogRecord } from '@logtape/logtape';
import { appendFileSync, renameSync, statSync, unlinkSync } from 'fs';
import { join } from 'path';

// ── Log levels ──────────────────────────────────────────────────────────────
export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

// ── Log file path ───────────────────────────────────────────────────────────
const LOG_FILE = join(process.cwd(), 'ssh-cli.log');
const LOG_BACKUP_FILE = `${LOG_FILE}.1`;
/** Rotate the log once it exceeds this size (keeps one previous file). */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

/**
 * Keep the log file from growing without bound across sessions.
 * Called once at startup, before the first write.
 */
function rotateLogIfNeeded(): void {
  try {
    if (statSync(LOG_FILE).size <= MAX_LOG_BYTES) return;
    try { unlinkSync(LOG_BACKUP_FILE); } catch {}
    renameSync(LOG_FILE, LOG_BACKUP_FILE);
  } catch {
    // File does not exist yet or cannot be rotated — logging continues as usual.
  }
}

/**
 * Write a formatted log line directly to ssh-cli.log.
 */
function writeToFile(record: LogRecord): void {
  const ts = new Date(record.timestamp).toISOString();
  const level = record.level.toUpperCase().padEnd(7);
  const category = record.category.join('.');
  const msg = record.message
    .map(m => (typeof m === 'string' ? m : JSON.stringify(m)))
    .join('');
  const line = `[${ts}] [${level}] [${category}] ${msg}\n`;
  try {
    appendFileSync(LOG_FILE, line);
  } catch {}
}

// ── Module loggers ──────────────────────────────────────────────────────────
let configured = false;

/**
 * Configure the logging system. Call once at app startup.
 */
export async function setupLogger(options?: { level?: LogLevel }): Promise<void> {
  if (configured) return;
  configured = true;

  rotateLogIfNeeded();

  const logLevel = options?.level ?? (process.env.DEBUG ? 'debug' : 'info');

  // Configure LogTape — file sink only (TUI project, no console output)
  await configure({
    sinks: {
      file: (record: LogRecord) => writeToFile(record),
    },
    loggers: [
      {
        category: ['ssh-cli'],
        lowestLevel: logLevel,
        sinks: ['file'],
      },
    ],
  });
}

/**
 * Create a logger for a specific module.
 * Usage: const log = createLogger('ssh');
 */
export function createLogger(module: string): Logger {
  return getLogger(['ssh-cli', module]);
}

/**
 * Legacy-compatible debug logger (for gradual migration).
 */
export function logDebug(msg: string): void {
  const log = getLogger(['ssh-cli', 'app']);
  log.debug(msg);
}

/**
 * Legacy-compatible IO logger (for gradual migration).
 */
export function logIO(direction: 'IN' | 'OUT', data: string | Buffer): void {
  const log = getLogger(['ssh-cli', 'io']);
  // Strip ANSI escapes and build a preview only when debug logging is active.
  // This runs for every SSH chunk, so on the default `info` level it would
  // otherwise allocate and discard a string per chunk for no benefit.
  if (!log.isEnabledFor('debug')) return;
  const preview = typeof data === 'string'
    ? data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·')
    : data.toString('utf-8').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·');
  
  log.debug(`[${direction}] (${typeof data === 'string' ? data.length : data.length}B): ${preview.substring(0, 500)}`);
}

export type { Logger } from '@logtape/logtape';
