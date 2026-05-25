/**
 * Kanban CLI types — source of truth for board.json schema.
 *
 * Design decisions (from kanban-md + Flux research):
 * - Slug IDs (P4A-TS-UPLOAD) not numeric — human-readable
 * - depends_on as string[] — explicit, no regex parsing
 * - comments[] for agent memory — immutable history trail
 * - blocked_reason separate from dependency blocking
 * - Implicit timestamps (started/completed auto-set from moves)
 */

// ---------------------------------------------------------------------------
// Board JSON (the file on disk)
// ---------------------------------------------------------------------------

export interface BoardJson {
  version: 1;
  columns: string[];
  cards: Record<string, CardMeta>;
  done: Record<string, DoneMeta>;
  /** Short alias → full card ID. e.g. { "P4A": "P4A-TS-UPLOAD" } */
  cardIndex: Record<string, string>;
}

export interface CardMeta {
  title: string;
  column: string;
  branch: string;
  priority: string;
  depends_on: string[];
  description: string;
  created: string;
  /** Auto-set on first move out of first column */
  started?: string;
  /** External blocker, separate from dependency blocking */
  blocked_reason?: string;
  /** Agent memory — immutable comment trail */
  comments?: Comment[];
}

export interface DoneMeta {
  title: string;
  completed: string;
  notes: string;
  branch?: string;
}

export interface Comment {
  body: string;
  author: string;
  created: string;
}

// ---------------------------------------------------------------------------
// CLI output envelope (--json mode)
// ---------------------------------------------------------------------------

export interface CliResult<T = unknown> {
  ok: boolean;
  data?: T;
  error?: CliError;
}

export interface CliError {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const DEFAULT_COLUMNS = [
  'backlog',
  'ready',
  'up-next',
  'in-progress',
  'in-review',
  'done',
] as const;

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
