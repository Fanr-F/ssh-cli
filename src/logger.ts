import { configure, getLogger, type Logger, type LogRecord } from '@logtape/logtape';
import { appendFileSync } from 'fs';
import { join } from 'path';

// ── Log levels ──────────────────────────────────────────────────────────────
export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

// ── Log file path ───────────────────────────────────────────────────────────
const LOG_FILE = join(process.cwd(), 'ssh-cli.log');

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
  const preview = typeof data === 'string'
    ? data.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·')
    : data.toString('utf-8').replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/[^\x20-\x7E\n\r\t]/g, '·');
  
  log.debug(`[${direction}] (${typeof data === 'string' ? data.length : data.length}B): ${preview.substring(0, 500)}`);
}

export type { Logger } from '@logtape/logtape';
