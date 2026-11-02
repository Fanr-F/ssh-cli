import { configure, getLogger, type Logger, type LogRecord } from '@logtape/logtape';
import { appendFileSync, chmodSync, mkdirSync, renameSync, statSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { getConfigDir } from './storage/config';

// ── Log levels ──────────────────────────────────────────────────────────────
export type LogLevel = 'trace' | 'debug' | 'info' | 'warning' | 'error' | 'fatal';

// ── Log file path ───────────────────────────────────────────────────────────
// Keep logs next to the config, not in whatever directory the executable was
// launched from (which may be read-only for a packaged binary).
const LOG_FILE = join(getConfigDir(), 'ssh-cli.log');
const LOG_BACKUP_FILE = `${LOG_FILE}.1`;
/** Rotate the log once it exceeds this size (keeps one previous file). */
const MAX_LOG_BYTES = 2 * 1024 * 1024;

let logBytes = 0;

/** Create the private config directory and log file if needed. */
function ensureLogFile(): void {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true, mode: 0o700 });
    try { chmodSync(dirname(LOG_FILE), 0o700); } catch {}
    appendFileSync(LOG_FILE, '', { mode: 0o600 });
    try { chmodSync(LOG_FILE, 0o600); } catch {}
    logBytes = statSync(LOG_FILE).size;
  } catch {
    // If the home directory is unavailable, individual writes will fail
    // silently; the TUI must not crash because logging is unavailable.
  }
}

/**
 * Keep the log file from growing without bound across sessions and during a
 * long-running session. Called at startup and whenever the tracked size
 * crosses the limit.
 */
function rotateLogIfNeeded(): void {
  try {
    const size = statSync(LOG_FILE).size;
    if (size <= MAX_LOG_BYTES) {
      logBytes = size;
      return;
    }
    try { unlinkSync(LOG_BACKUP_FILE); } catch {}
    renameSync(LOG_FILE, LOG_BACKUP_FILE);
    logBytes = 0;
  } catch {
    // File does not exist yet or cannot be rotated — logging continues as usual.
  }
}

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/\b(password|passwd|passphrase|token|secret|api[_-]?key)\b(\s*[:=]\s*)([^\s]+)/gi, '$1$2***'],
  [/\b(sshpass\s+-p\s+)(\S+)/gi, '$1***'],
  [/\b(Bearer\s+)([A-Za-z0-9._~+/=-]+)/gi, '$1***'],
];

/** Mask common secret shapes before a preview is written to disk. */
export function redactSensitive(text: string): string {
  return REDACTION_PATTERNS.reduce(
    (result, [pattern, replacement]) => result.replace(pattern, replacement),
    text,
  );
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
    if (logBytes > MAX_LOG_BYTES) rotateLogIfNeeded();
    appendFileSync(LOG_FILE, line, { mode: 0o600 });
    logBytes += Buffer.byteLength(line);
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

  ensureLogFile();
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
      {
        // LogTape's own meta logger writes to the console by default, which
        // would corrupt the TUI. Keep it effectively silent.
        category: ['logtape', 'meta'],
        lowestLevel: 'fatal',
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
  // SSH I/O is opt-in even at debug level: terminal traffic can contain
  // passwords typed into sudo/ssh prompts and other sensitive output.
  if (!log.isEnabledFor('debug') || process.env.SSH_CLI_LOG_IO !== '1') return;

  const raw = typeof data === 'string' ? data : data.toString('utf-8');
  const preview = redactSensitive(
    raw
      .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')
      .replace(/[^\x20-\x7E\n\r\t]/g, '·'),
  );

  log.debug(`[${direction}] (${data.length}B): ${preview.substring(0, 500)}`);
}

export type { Logger } from '@logtape/logtape';
