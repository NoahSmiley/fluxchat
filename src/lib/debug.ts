/**
 * Debug logging utility for Flux.
 *
 * Toggle via Settings or by running in the DevTools console:
 *   localStorage.setItem("flux-debug", "true")
 *
 * Logs are stored in a ring buffer so you can dump them at any time:
 *   window.__fluxDebugLogs          — the raw array
 *   window.__fluxDumpLogs()         — copy all logs to clipboard as text
 */

const MAX_LOG_ENTRIES = 2000;

interface LogEntry {
  ts: string;
  scope: string;
  msg: string;
  data?: unknown;
}

const logBuffer: LogEntry[] = [];

function isEnabled(): boolean {
  try {
    return localStorage.getItem("flux-debug") === "true";
  } catch {
    return false;
  }
}

export function setDebugEnabled(enabled: boolean) {
  localStorage.setItem("flux-debug", enabled ? "true" : "false");
  if (enabled) {
    console.log(
      "%c[Flux Debug] Enabled — logs will appear here and in window.__fluxDebugLogs",
      "color: #5865f2; font-weight: bold",
    );
  } else {
    console.log("%c[Flux Debug] Disabled", "color: #999");
  }
}

export function getDebugEnabled(): boolean {
  return isEnabled();
}

function pushEntry(entry: LogEntry) {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_LOG_ENTRIES) {
    logBuffer.splice(0, logBuffer.length - MAX_LOG_ENTRIES);
  }
}

export function dbg(scope: string, msg: string, data?: unknown) {
  const ts = new Date().toISOString();
  const entry: LogEntry = { ts, scope, msg, ...(data !== undefined ? { data } : {}) };
  pushEntry(entry);

  if (!isEnabled()) return;

  const prefix = `%c[${scope}]%c ${msg}`;
  const scopeStyle = "color: #5865f2; font-weight: bold";
  const msgStyle = "color: inherit; font-weight: normal";

  if (data !== undefined) {
    console.log(prefix, scopeStyle, msgStyle, data);
  } else {
    console.log(prefix, scopeStyle, msgStyle);
  }
}

/** Dump all buffered logs as a formatted string (useful for pasting into a bug report). */
export function dumpLogs(): string {
  return logBuffer
    .map((e) => {
      const line = `[${e.ts}] [${e.scope}] ${e.msg}`;
      if (e.data !== undefined) {
        try {
          return `${line} ${JSON.stringify(e.data)}`;
        } catch {
          return `${line} [unserializable]`;
        }
      }
      return line;
    })
    .join("\n");
}

/** Get the raw log buffer (latest entries). */
export function getLogs(): readonly LogEntry[] {
  return logBuffer;
}

// Expose on window for easy DevTools access
const W = window as any;
W.__fluxDebugLogs = logBuffer;
W.__fluxDumpLogs = () => {
  const text = dumpLogs();
  navigator.clipboard.writeText(text).then(
    () => console.log(`Copied ${logBuffer.length} log entries to clipboard.`),
    () => console.log(text),
  );
  return `${logBuffer.length} entries`;
};
