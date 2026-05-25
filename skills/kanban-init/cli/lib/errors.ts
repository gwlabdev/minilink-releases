/**
 * Structured CLI errors — from kanban-md pattern.
 *
 * Every error has a machine-readable code, human-readable message,
 * and optional details object. In --json mode, agents can parse these
 * programmatically to understand what went wrong.
 */

import type { CliError, CliResult } from './types.js';

export function fail(code: string, message: string, details?: Record<string, unknown>): never {
  const err: CliError = { code, message };
  if (details) err.details = details;
  throw err;
}

export function isCliError(err: unknown): err is CliError {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    'message' in err
  );
}

// ---------------------------------------------------------------------------
// Output helpers
// ---------------------------------------------------------------------------

export function outputJson<T>(data: T): void {
  const result: CliResult<T> = { ok: true, data };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

export function outputJsonError(err: CliError): void {
  const result: CliResult = { ok: false, error: err };
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}
