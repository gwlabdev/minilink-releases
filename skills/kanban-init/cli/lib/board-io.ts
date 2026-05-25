/**
 * Board I/O — read/write board.json, find kanban directory from cwd.
 *
 * Patterns adopted:
 * - kanban-md: walk up from cwd to find kanban dir
 * - kanban-md: sorted keys + 2-space indent for clean git diffs
 * - kanban-md: lenient loading (warn on issues, don't crash)
 * - Flux: storage adapter concept (start with JSON, extensible later)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname, resolve } from 'path';
import type { BoardJson, CardMeta } from './types.js';

// ---------------------------------------------------------------------------
// Find kanban directory
// ---------------------------------------------------------------------------

/**
 * Walk up from startDir looking for docs/kanban/board.json or docs/kanban/config.json.
 * Also accepts --dir flag override.
 */
export function findKanbanDir(startDir?: string): string {
  const start = startDir ?? process.cwd();
  let dir = resolve(start);
  const root = '/';

  while (dir !== root) {
    const candidate = join(dir, 'docs', 'kanban');
    if (
      existsSync(join(candidate, 'board.json')) ||
      existsSync(join(candidate, 'config.json'))
    ) {
      return candidate;
    }
    dir = dirname(dir);
  }

  throw { code: 'NO_BOARD', message: `No kanban board found walking up from ${start}` };
}

// ---------------------------------------------------------------------------
// Read / Write board.json
// ---------------------------------------------------------------------------

export function readBoard(kanbanDir: string): BoardJson {
  const path = join(kanbanDir, 'board.json');
  if (!existsSync(path)) {
    throw { code: 'NO_BOARD_JSON', message: `No board.json at ${path}` };
  }
  const raw = readFileSync(path, 'utf-8');
  return JSON.parse(raw) as BoardJson;
}

export function writeBoard(kanbanDir: string, board: BoardJson): void {
  const path = join(kanbanDir, 'board.json');
  // Sorted keys + 2-space indent for clean git diffs
  const json = JSON.stringify(board, sortedReplacer, 2) + '\n';
  writeFileSync(path, json, 'utf-8');
}

/** JSON replacer that sorts object keys for deterministic output. */
function sortedReplacer(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b))
    );
  }
  return value;
}

// ---------------------------------------------------------------------------
// Resolve card ID (supports short aliases)
// ---------------------------------------------------------------------------

/**
 * Resolve a card ID input to the full card ID.
 * Checks: exact match in cards → exact match in done → cardIndex alias → case-insensitive search.
 */
export function resolveCardId(board: BoardJson, input: string): string {
  const upper = input.toUpperCase();

  // Exact match in active cards
  if (board.cards[upper]) return upper;
  if (board.cards[input]) return input;

  // Exact match in done
  if (board.done[upper]) return upper;
  if (board.done[input]) return input;

  // Short alias lookup
  if (board.cardIndex[upper]) return board.cardIndex[upper];
  if (board.cardIndex[input]) return board.cardIndex[input];

  // Case-insensitive search in cards
  for (const id of Object.keys(board.cards)) {
    if (id.toUpperCase() === upper) return id;
  }
  for (const id of Object.keys(board.done)) {
    if (id.toUpperCase() === upper) return id;
  }

  throw {
    code: 'CARD_NOT_FOUND',
    message: `Card "${input}" not found`,
    details: {
      available: [...Object.keys(board.cards), ...Object.keys(board.done)],
      aliases: Object.keys(board.cardIndex),
    },
  };
}

// ---------------------------------------------------------------------------
// Read card prose (.md file)
// ---------------------------------------------------------------------------

export function readCardMd(kanbanDir: string, cardId: string): string | null {
  const path = join(kanbanDir, 'cards', `${cardId}.md`);
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf-8');
}

// ---------------------------------------------------------------------------
// Dependency helpers
// ---------------------------------------------------------------------------

/** Get the column of a card (checks both active and done). */
export function getCardColumn(board: BoardJson, cardId: string): string | null {
  if (board.cards[cardId]) return board.cards[cardId].column;
  if (board.done[cardId]) return 'done';
  return null;
}

/** Check if all dependencies of a card are satisfied (done or in-progress). */
export function isReady(board: BoardJson, card: CardMeta): boolean {
  if (card.blocked_reason) return false;
  if (card.depends_on.length === 0) return true;
  return card.depends_on.every((dep) => {
    const col = getCardColumn(board, dep);
    return col === 'done' || col === 'in-progress';
  });
}

/** Check if ALL dependencies are at terminal status (done). Stricter than isReady. */
export function allDepsDone(board: BoardJson, card: CardMeta): boolean {
  if (card.depends_on.length === 0) return true;
  return card.depends_on.every((dep) => getCardColumn(board, dep) === 'done');
}

/** Get list of unmet dependency IDs. */
export function getUnmetDeps(board: BoardJson, card: CardMeta): string[] {
  return card.depends_on.filter((dep) => {
    const col = getCardColumn(board, dep);
    return col !== 'done' && col !== 'in-progress';
  });
}
