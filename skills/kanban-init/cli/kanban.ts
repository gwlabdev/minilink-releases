#!/usr/bin/env -S npx tsx
/**
 * kanban — CLI for managing Kanban board state.
 *
 * Replaces markdown regex parsing with structured JSON operations.
 * Designed for Claude Code skills to call instead of editing BOARD.md.
 *
 * Usage:
 *   npx tsx kanban.ts <command> [args] [flags]
 *
 * Commands:
 *   list [--ready] [--column COL] [--json]   Show board summary
 *   ready [--json]                            Unblocked cards sorted by priority
 *   show <ID> [--json]                        Card detail + prose
 *   add <ID> --title T [--column C] [...]     Add a card
 *   move <ID> <COLUMN>                        Move card between columns
 *   done <ID> [--notes "..."]                 Move to done
 *   edit <ID> [--title T] [--add-dep D] ...   Update card fields
 *   remove <ID>                               Remove from board
 *   comment <ID> --body "..." [--author A]    Add a comment
 *   migrate [--dir PATH]                      Parse BOARD.md → board.json
 *   init [--name N] [--columns c1,c2,...]     Bootstrap full kanban setup
 */

import {
  findKanbanDir,
  readBoard,
  writeBoard,
  resolveCardId,
  readCardMd,
  isReady,
  getUnmetDeps,
  getCardColumn,
} from './lib/board-io.js';
import { fail, isCliError, outputJson, outputJsonError } from './lib/errors.js';
import type { BoardJson, CardMeta, DoneMeta, Comment } from './lib/types.js';
import { DEFAULT_COLUMNS, today } from './lib/types.js';

// ---------------------------------------------------------------------------
// Arg parsing (minimal, no deps)
// ---------------------------------------------------------------------------

interface ParsedArgs {
  command: string;
  positionals: string[];
  flags: Record<string, string | boolean>;
}

function parseArgs(argv: string[]): ParsedArgs {
  const args = argv.slice(2); // skip node + script
  const command = args[0] ?? 'list';
  const positionals: string[] = [];
  const flags: Record<string, string | boolean> = {};

  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = args[i + 1];
      // next !== undefined handles empty string "" as a valid value
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positionals.push(a);
    }
  }

  return { command, positionals, flags };
}

function flag(flags: Record<string, string | boolean>, key: string): string | undefined {
  const v = flags[key];
  return typeof v === 'string' ? v : undefined;
}

function boolFlag(flags: Record<string, string | boolean>, key: string): boolean {
  return flags[key] === true;
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList(kanbanDir: string, { positionals: _p, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  const readyOnly = boolFlag(flags, 'ready');
  const columnFilter = flag(flags, 'column');

  if (readyOnly) return cmdReady(kanbanDir, { command: 'ready', positionals: [], flags });

  // Group cards by column
  const byColumn = new Map<string, Array<{ id: string; card: CardMeta }>>();
  for (const col of board.columns) byColumn.set(col, []);

  for (const [id, card] of Object.entries(board.cards)) {
    const list = byColumn.get(card.column);
    if (list) list.push({ id, card });
  }

  if (json) {
    const data: Record<string, Array<{ id: string; title: string; blocked: boolean }>> = {};
    for (const [col, items] of byColumn) {
      if (columnFilter && col !== columnFilter) continue;
      data[col] = items.map(({ id, card }) => ({
        id,
        title: card.title,
        blocked: !isReady(board, card),
      }));
    }
    // Include done count
    data['done'] = Object.entries(board.done).map(([id, d]) => ({
      id,
      title: d.title,
      blocked: false,
    }));
    return outputJson(data);
  }

  // Human-readable output
  for (const [col, items] of byColumn) {
    if (columnFilter && col !== columnFilter) continue;
    if (items.length === 0 && col !== 'done') continue;

    const header = col.toUpperCase().replace(/-/g, ' ');
    console.log(`\n  ${header}  (${items.length})`);
    for (const { id, card } of items) {
      const ready = isReady(board, card);
      const dot = ready ? '\x1b[32m●\x1b[0m' : '\x1b[31m●\x1b[0m';
      const desc = card.description || card.title;
      console.log(`    ${dot} ${id}  ${desc}`);
    }
  }

  // Done summary
  const doneCount = Object.keys(board.done).length;
  if (doneCount > 0 && !columnFilter) {
    console.log(`\n  DONE  (${doneCount})`);
  }
  console.log();
}

function cmdReady(kanbanDir: string, { flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');

  // Filter: not blocked, not done, sorted by priority
  const ready: Array<{ id: string; card: CardMeta }> = [];
  for (const [id, card] of Object.entries(board.cards)) {
    if (isReady(board, card)) {
      ready.push({ id, card });
    }
  }

  // Sort by priority (P1 < P2 < P3, etc. — lower number = higher priority)
  ready.sort((a, b) => {
    const pa = a.card.priority.replace(/\D/g, '') || '99';
    const pb = b.card.priority.replace(/\D/g, '') || '99';
    return parseInt(pa) - parseInt(pb);
  });

  if (json) {
    return outputJson(
      ready.map(({ id, card }) => ({
        id,
        title: card.title,
        column: card.column,
        priority: card.priority,
        description: card.description,
      }))
    );
  }

  if (ready.length === 0) {
    console.log('\n  No unblocked cards.\n');
    return;
  }

  console.log(`\n  READY TO WORK  (${ready.length})`);
  for (const { id, card } of ready) {
    const col = card.column.toUpperCase().replace(/-/g, ' ');
    console.log(`    ${card.priority || '--'}  ${id}  [${col}]  ${card.description || card.title}`);
    // Show latest comment (agent memory preview)
    const lastComment = card.comments?.[card.comments.length - 1];
    if (lastComment) {
      const preview = lastComment.body.split('\n')[0].slice(0, 60);
      console.log(`         \x1b[90m→ ${preview}\x1b[0m`);
    }
  }
  console.log();
}

function cmdShow(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban show <CARD-ID>');

  const id = resolveCardId(board, positionals[0]);

  // Check active cards first, then done
  const card = board.cards[id];
  const done = board.done[id];

  if (json) {
    return outputJson({ id, ...(card ?? done), prose: readCardMd(kanbanDir, id) });
  }

  if (card) {
    const ready = isReady(board, card);
    const unmet = getUnmetDeps(board, card);
    console.log(`\n  ${card.title || id}`);
    console.log(`  Status: ${card.column.toUpperCase()}${ready ? '' : ' (BLOCKED)'}`);
    console.log(`  Branch: ${card.branch}`);
    console.log(`  Priority: ${card.priority}`);
    if (card.depends_on.length > 0) {
      console.log(`  Depends on: ${card.depends_on.join(', ')}`);
    }
    if (unmet.length > 0) {
      console.log(`  \x1b[31mUnmet deps: ${unmet.join(', ')}\x1b[0m`);
    }
    if (card.blocked_reason) {
      console.log(`  \x1b[31mBlocked: ${card.blocked_reason}\x1b[0m`);
    }
    if (card.comments && card.comments.length > 0) {
      console.log(`  Comments: ${card.comments.length}`);
      const last = card.comments[card.comments.length - 1];
      console.log(`    Latest (${last.author}, ${last.created}): ${last.body.split('\n')[0]}`);
    }
    console.log(`  Description: ${card.description}`);
  } else if (done) {
    console.log(`\n  ${done.title || id}`);
    console.log(`  Status: DONE (${done.completed})`);
    console.log(`  Notes: ${done.notes}`);
  } else {
    fail('CARD_NOT_FOUND', `Card "${positionals[0]}" not found`);
  }

  // Show prose if card.md exists
  const prose = readCardMd(kanbanDir, id);
  if (prose) {
    console.log(`\n  --- Card File ---`);
    console.log(prose);
  }
  console.log();
}

function cmdMove(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length < 2) fail('MISSING_ARG', 'Usage: kanban move <CARD-ID> <COLUMN>');

  const id = resolveCardId(board, positionals[0]);
  const targetCol = positionals[1].toLowerCase();
  const card = board.cards[id];
  if (!card) fail('NOT_ACTIVE', `Card "${id}" is in DONE, cannot move`);

  // Validate column exists
  if (!board.columns.includes(targetCol) && targetCol !== 'done') {
    fail('INVALID_COLUMN', `Column "${targetCol}" not found`, {
      available: board.columns,
    });
  }

  // Idempotent: already there → success without writing
  if (card.column === targetCol) {
    if (json) return outputJson({ id, column: targetCol, changed: false });
    console.log(`  ${id} already in ${targetCol.toUpperCase()}`);
    return;
  }

  // Move to done → use cmdDone
  if (targetCol === 'done') {
    return cmdDone(kanbanDir, { command: 'done', positionals: [positionals[0]], flags });
  }

  // Implicit timestamps
  const oldCol = card.column;
  const firstCol = board.columns[0];
  if (!card.started && oldCol === firstCol && targetCol !== firstCol) {
    card.started = today();
  }

  card.column = targetCol;

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, from: oldCol, to: targetCol, changed: true });
  console.log(`  ${id}: ${oldCol} → ${targetCol}`);
}

function cmdDone(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban done <CARD-ID> [--notes "..."]');

  const id = resolveCardId(board, positionals[0]);
  const card = board.cards[id];
  if (!card) fail('NOT_ACTIVE', `Card "${id}" is already in DONE or not found`);

  const notes = flag(flags, 'notes') ?? '';

  // Move to done
  const doneMeta: DoneMeta = {
    title: card.title,
    completed: today(),
    notes,
    branch: card.branch || undefined,
  };

  board.done[id] = doneMeta;
  delete board.cards[id];

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, completed: doneMeta.completed, notes });
  console.log(`  ${id} → DONE (${doneMeta.completed})${notes ? ` — ${notes}` : ''}`);
}

function cmdAdd(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban add <CARD-ID> --title "..."');

  const id = positionals[0].toUpperCase();
  if (board.cards[id]) fail('DUPLICATE', `Card "${id}" already exists`);

  const title = flag(flags, 'title') ?? id;
  const column = flag(flags, 'column') ?? board.columns[0];
  const branch = flag(flags, 'branch') ?? '';
  const priority = flag(flags, 'priority') ?? '';
  const desc = flag(flags, 'desc') ?? flag(flags, 'description') ?? '';
  const depsRaw = flag(flags, 'dep') ?? flag(flags, 'deps') ?? '';
  const depends_on = depsRaw ? depsRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
  const short = flag(flags, 'short');

  if (!board.columns.includes(column)) {
    fail('INVALID_COLUMN', `Column "${column}" not found`, { available: board.columns });
  }

  const card: CardMeta = {
    title,
    column,
    branch,
    priority,
    depends_on,
    description: desc,
    created: today(),
  };

  board.cards[id] = card;
  if (short) board.cardIndex[short] = id;

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, ...card });
  console.log(`  + ${id} added to ${column.toUpperCase()}`);
}

function cmdEdit(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban edit <CARD-ID> [--title T] ...');

  const id = resolveCardId(board, positionals[0]);
  const card = board.cards[id];
  if (!card) fail('NOT_ACTIVE', `Card "${id}" is in DONE, cannot edit`);

  let changed = false;

  const t = flag(flags, 'title');
  if (t !== undefined) { card.title = t; changed = true; }

  const b = flag(flags, 'branch');
  if (b !== undefined) { card.branch = b; changed = true; }

  const p = flag(flags, 'priority');
  if (p !== undefined) { card.priority = p; changed = true; }

  const d = flag(flags, 'desc') ?? flag(flags, 'description');
  if (d !== undefined) { card.description = d; changed = true; }

  const addDep = flag(flags, 'add-dep');
  if (addDep) {
    const deps = addDep.split(',').map((s) => s.trim()).filter(Boolean);
    for (const dep of deps) {
      if (!card.depends_on.includes(dep)) {
        card.depends_on.push(dep);
        changed = true;
      }
    }
  }

  const rmDep = flag(flags, 'remove-dep');
  if (rmDep) {
    const deps = rmDep.split(',').map((s) => s.trim()).filter(Boolean);
    card.depends_on = card.depends_on.filter((d) => !deps.includes(d));
    changed = true;
  }

  const br = flag(flags, 'blocked-reason');
  if (br !== undefined) {
    card.blocked_reason = br || undefined;
    changed = true;
  }

  const short = flag(flags, 'short');
  if (short) { board.cardIndex[short] = id; changed = true; }

  if (!changed) {
    if (json) return outputJson({ id, changed: false });
    console.log(`  No changes specified for ${id}`);
    return;
  }

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, changed: true, card });
  console.log(`  ${id} updated`);
}

function cmdRemove(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban remove <CARD-ID>');

  const id = resolveCardId(board, positionals[0]);

  let removed = false;
  if (board.cards[id]) {
    delete board.cards[id];
    removed = true;
  }
  if (board.done[id]) {
    delete board.done[id];
    removed = true;
  }

  // Clean up cardIndex entries pointing to this ID
  for (const [alias, target] of Object.entries(board.cardIndex)) {
    if (target === id) delete board.cardIndex[alias];
  }

  if (!removed) fail('CARD_NOT_FOUND', `Card "${id}" not found`);

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, removed: true });
  console.log(`  ${id} removed`);
}

function cmdComment(kanbanDir: string, { positionals, flags }: ParsedArgs): void {
  const board = readBoard(kanbanDir);
  const json = boolFlag(flags, 'json');
  if (positionals.length === 0) fail('MISSING_ARG', 'Usage: kanban comment <CARD-ID> "text" or --body "text"');

  const id = resolveCardId(board, positionals[0]);
  const card = board.cards[id];
  if (!card) fail('NOT_ACTIVE', `Card "${id}" not found in active cards`);

  // Accept body as positional (remaining args joined) or --body flag
  const body = flag(flags, 'body') ?? (positionals.slice(1).join(' ') || '');
  if (!body) fail('MISSING_ARG', 'Comment body required: kanban comment <ID> "text" or --body "text"');

  const author = flag(flags, 'author') ?? 'cli';

  const comment: Comment = { body, author, created: new Date().toISOString() };
  if (!card.comments) card.comments = [];
  card.comments.push(comment);

  writeBoard(kanbanDir, board);

  if (json) return outputJson({ id, comment });
  console.log(`  Comment added to ${id} by ${author}`);
}

function cmdInit(kanbanDir: string, { flags }: ParsedArgs): void {
  const json = boolFlag(flags, 'json');
  const created: string[] = [];
  const skipped: string[] = [];

  // --- Detect project root -----------------------------------------------------
  // When --dir is used, scan from cwd (the user runs init from the project root)
  // Otherwise, kanbanDir is cwd/docs/kanban, so go up two levels
  const projectRoot = flag(flags, 'dir')
    ? process.cwd()
    : resolve(kanbanDir, '..', '..');

  // --- Detect project info ---------------------------------------------------
  const projectName = flag(flags, 'name') ?? detectProjectName(projectRoot);
  const mainBranch = detectMainBranch();
  const branchPrefix = flag(flags, 'branch-prefix') ?? 'feat/';
  const cardIdStyle = flag(flags, 'style') ?? 'SLUG_ONLY';

  // --- Scan project structure ------------------------------------------------
  const detected = scanProject(projectRoot);

  // --- Columns ---------------------------------------------------------------
  const columnsRaw = flag(flags, 'columns');
  const columns = columnsRaw
    ? columnsRaw.split(',').map((s) => s.trim())
    : [...DEFAULT_COLUMNS].filter((c) => c !== 'done');

  // --- Create directories ----------------------------------------------------
  mkdirSync(`${kanbanDir}/cards`, { recursive: true });
  mkdirSync(`${kanbanDir}/assets`, { recursive: true });

  // --- Create config.json (skip if exists) -----------------------------------
  const configPath = `${kanbanDir}/config.json`;
  if (!existsSync(configPath)) {
    const config = {
      project: {
        name: projectName,
        mainBranch,
        branchPrefix,
      },
      worktrees: {
        enabled: false,
      },
      commands: {
        test: detected.testCommand,
        dev: detected.devCommands,
      },
      domains: detected.domains,
      riskThresholds: { low: 400, medium: 500 },
      cardIdStyle,
    };
    writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');
    created.push('config.json');
  } else {
    skipped.push('config.json (already exists)');
  }

  // --- Create board.json (skip if exists) ------------------------------------
  const boardPath = `${kanbanDir}/board.json`;
  if (!existsSync(boardPath)) {
    const board: BoardJson = {
      version: 1,
      columns,
      cards: {},
      done: {},
      cardIndex: {},
    };
    writeBoard(kanbanDir, board);
    created.push('board.json');
  } else {
    skipped.push('board.json (already exists)');
  }

  // --- Output ----------------------------------------------------------------
  const result = {
    kanbanDir,
    projectName,
    mainBranch,
    branchPrefix,
    cardIdStyle,
    columns,
    created,
    skipped,
    detected,
  };

  if (json) return outputJson(result);

  console.log(`\n  Kanban initialized for ${projectName}`);
  console.log(`  ─────────────────────────────────────────`);
  console.log(`  Directory:  ${kanbanDir}/`);
  console.log(`  Branch:     ${mainBranch}`);
  console.log(`  Prefix:     ${branchPrefix}`);
  console.log(`  Style:      ${cardIdStyle}`);
  console.log(`  Columns:    ${columns.join(', ')}`);

  if (detected.stack.length > 0)
    console.log(`  Stack:      ${detected.stack.join(', ')}`);
  if (detected.testCommand)
    console.log(`  Test:       ${detected.testCommand}`);
  if (detected.devCommands.length > 0)
    console.log(`  Dev:        ${detected.devCommands.join('; ')}`);
  if (detected.domains.length > 0)
    console.log(`  Domains:    ${detected.domains.length} detected`);
  for (const d of detected.domains) {
    console.log(`    • ${d.name}: ${d.keywords.slice(0, 4).join(', ')}`);
  }

  if (created.length > 0) console.log(`  Created:    ${created.join(', ')}`);
  if (skipped.length > 0) console.log(`  Skipped:    ${skipped.join(', ')}`);
  console.log();
  console.log(`  Next steps:`);
  console.log(`    kanban add MY-CARD --title "First feature"   # add a card`);
  console.log(`    kanban list                                  # view board`);
  console.log(`    kanban move MY-CARD in-progress              # start work`);
  console.log();
}

// ---------------------------------------------------------------------------
// Project scanning — auto-detect stack, commands, and domains
// ---------------------------------------------------------------------------

interface DetectedDomain {
  name: string;
  keywords: string[];
  globs: string[];
}

interface ScanResult {
  stack: string[];
  testCommand: string;
  devCommands: string[];
  domains: DetectedDomain[];
}

/** Scan project root to detect tech stack, commands, and domain areas. */
function scanProject(root: string): ScanResult {
  const stack: string[] = [];
  const domains: DetectedDomain[] = [];
  let testCommand = '';
  const devCommands: string[] = [];

  // --- Detect tech stack from marker files -----------------------------------
  const markers: Array<{ file: string; tech: string }> = [
    { file: 'package.json', tech: 'Node.js' },
    { file: 'Cargo.toml', tech: 'Rust' },
    { file: 'pyproject.toml', tech: 'Python' },
    { file: 'requirements.txt', tech: 'Python' },
    { file: 'go.mod', tech: 'Go' },
    { file: 'tsconfig.json', tech: 'TypeScript' },
    { file: 'src-tauri/tauri.conf.json', tech: 'Tauri' },
    { file: 'next.config.js', tech: 'Next.js' },
    { file: 'next.config.ts', tech: 'Next.js' },
    { file: 'next.config.mjs', tech: 'Next.js' },
    { file: 'vite.config.ts', tech: 'Vite' },
    { file: 'vite.config.js', tech: 'Vite' },
    { file: 'docker-compose.yml', tech: 'Docker' },
    { file: 'docker-compose.yaml', tech: 'Docker' },
    { file: 'Dockerfile', tech: 'Docker' },
    { file: '.github/workflows', tech: 'GitHub Actions' },
  ];

  for (const m of markers) {
    if (existsSync(join(root, m.file))) {
      if (!stack.includes(m.tech)) stack.push(m.tech);
    }
  }

  // --- Detect commands from package.json -------------------------------------
  const pkgPath = join(root, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFs(pkgPath, 'utf-8'));
      const scripts = pkg.scripts ?? {};

      // Test command
      if (scripts.test && !scripts.test.includes('no test specified')) {
        testCommand = 'npm test';
      }

      // Dev command
      if (scripts['tauri:dev']) devCommands.push('npm run tauri:dev');
      else if (scripts.dev) devCommands.push('npm run dev');
      else if (scripts.start) devCommands.push('npm start');
    } catch { /* malformed package.json */ }
  }

  // Check for frontend/package.json (monorepo)
  const frontPkg = join(root, 'frontend', 'package.json');
  if (existsSync(frontPkg)) {
    try {
      const pkg = JSON.parse(readFs(frontPkg, 'utf-8'));
      if (pkg.scripts?.dev) devCommands.push('cd frontend && npm run dev');
    } catch { /* skip */ }
  }

  // Check for backend Python
  const backendDir = join(root, 'backend');
  if (existsSync(backendDir)) {
    // pytest — check multiple locations + requirements.txt
    const hasPytest = existsSync(join(backendDir, 'conftest.py'))
      || existsSync(join(backendDir, 'pytest.ini'))
      || existsSync(join(backendDir, 'tests', 'conftest.py'))
      || existsSync(join(root, 'pytest.ini'))
      || existsSync(join(root, 'conftest.py'))
      || fileContains(join(backendDir, 'requirements.txt'), 'pytest')
      || fileContains(join(root, 'requirements.txt'), 'pytest')
      || fileContains(join(root, 'pyproject.toml'), 'pytest');
    if (hasPytest && !testCommand) {
      testCommand = 'cd backend && pytest --tb=short -q';
    }
    // Python dev server
    if (existsSync(join(backendDir, 'serve.py')))
      devCommands.push('cd backend && python serve.py');
    else if (existsSync(join(backendDir, 'manage.py')))
      devCommands.push('cd backend && python manage.py runserver');
    else if (existsSync(join(backendDir, 'app.py')))
      devCommands.push('cd backend && python app.py');
  }

  // Cargo test
  if (existsSync(join(root, 'Cargo.toml')) && !testCommand) {
    testCommand = 'cargo test';
  }

  // Go test
  if (existsSync(join(root, 'go.mod')) && !testCommand) {
    testCommand = 'go test ./...';
  }

  // --- Detect domains from directory structure -------------------------------

  // Each entry: [directories to check, domain name, keywords, glob pattern]
  const domainChecks: Array<{
    dirs: string[];
    name: string;
    keywords: string[];
    glob: string;
  }> = [
    // Frontend areas
    {
      dirs: ['src/components', 'frontend/src/components', 'app/components'],
      name: 'Components',
      keywords: ['component', 'ui', 'view', 'panel', 'modal'],
      glob: '{src,frontend/src,app}/components/**',
    },
    {
      dirs: ['src/hooks', 'frontend/src/hooks'],
      name: 'Hooks',
      keywords: ['hook', 'use', 'state', 'effect'],
      glob: '{src,frontend/src}/hooks/**',
    },
    {
      dirs: ['src/store', 'src/stores', 'frontend/src/store', 'frontend/src/stores'],
      name: 'State Management',
      keywords: ['store', 'state', 'slice', 'action', 'reducer'],
      glob: '{src,frontend/src}/{store,stores}/**',
    },
    {
      dirs: ['src/lib', 'src/utils', 'frontend/src/lib', 'frontend/src/utils'],
      name: 'Utilities',
      keywords: ['util', 'helper', 'lib', 'format', 'parse'],
      glob: '{src,frontend/src}/{lib,utils}/**',
    },
    {
      dirs: ['src/contexts', 'frontend/src/contexts'],
      name: 'Contexts',
      keywords: ['context', 'provider', 'theme', 'settings'],
      glob: '{src,frontend/src}/contexts/**',
    },
    {
      dirs: ['src/themes', 'src/styles'],
      name: 'Themes & Styles',
      keywords: ['theme', 'style', 'design', 'color', 'css'],
      glob: 'src/{themes,styles}/**',
    },
    // Backend areas
    {
      dirs: ['backend/routers', 'backend/routes', 'server/routes', 'api/routes'],
      name: 'API Routes',
      keywords: ['api', 'endpoint', 'route', 'handler', 'controller'],
      glob: '{backend,server,api}/{routers,routes}/**',
    },
    {
      dirs: ['backend/core', 'backend/services', 'server/services'],
      name: 'Core Logic',
      keywords: ['core', 'service', 'model', 'engine', 'builder'],
      glob: '{backend,server}/{core,services}/**',
    },
    {
      dirs: ['backend/models', 'backend/schemas'],
      name: 'Data Models',
      keywords: ['model', 'schema', 'type', 'entity'],
      glob: '{backend}/{models,schemas}/**',
    },
    // Rust / Tauri
    {
      dirs: ['src-tauri/src'],
      name: 'Rust Backend',
      keywords: ['rust', 'tauri', 'command', 'pty', 'native'],
      glob: 'src-tauri/src/**',
    },
    // Agent / AI
    {
      dirs: ['src-tauri/agent', 'agent', 'src/agent'],
      name: 'AI Agent',
      keywords: ['agent', 'ai', 'chat', 'tool', 'llm'],
      glob: '{src-tauri/agent,agent,src/agent}/**',
    },
    // Tests
    {
      dirs: ['tests', '__tests__', 'test', 'backend/tests'],
      name: 'Tests',
      keywords: ['test', 'spec', 'fixture', 'mock'],
      glob: '{tests,__tests__,test,backend/tests}/**',
    },
    // Pages (Next.js / app router)
    {
      dirs: ['app', 'pages', 'src/app', 'src/pages'],
      name: 'Pages',
      keywords: ['page', 'route', 'layout', 'middleware'],
      glob: '{app,pages,src/app,src/pages}/**',
    },
  ];

  for (const check of domainChecks) {
    // Find which directory actually exists for this domain
    const foundDirs: string[] = [];
    for (const dir of check.dirs) {
      if (existsSync(join(root, dir))) {
        foundDirs.push(dir);
      }
    }
    if (foundDirs.length === 0) continue;

    // Build specific globs from the actual directories found
    const globs = foundDirs.length === 1
      ? [`${foundDirs[0]}/**`]
      : [`{${foundDirs.join(',')}}/**`];

    // Count files to gauge domain importance
    let fileCount = 0;
    for (const dir of foundDirs) {
      try {
        fileCount += countFiles(join(root, dir));
      } catch { /* permission error, skip */ }
    }

    if (fileCount > 0) {
      domains.push({
        name: check.name,
        keywords: check.keywords,
        globs,
      });
    }
  }

  return { stack, testCommand, devCommands, domains };
}

/** Count files (non-recursively) in a directory. Quick heuristic. */
function countFiles(dir: string): number {
  try {
    return readdirSync(dir).filter((f) => !f.startsWith('.')).length;
  } catch {
    return 0;
  }
}

/** Check if a file exists and contains a string (case-insensitive). */
function fileContains(path: string, needle: string): boolean {
  try {
    if (!existsSync(path)) return false;
    return readFs(path, 'utf-8').toLowerCase().includes(needle.toLowerCase());
  } catch {
    return false;
  }
}

/** Detect project name from root directory. */
function detectProjectName(root: string): string {
  // Try package.json name first
  try {
    const pkg = JSON.parse(readFs(join(root, 'package.json'), 'utf-8'));
    if (pkg.name && !pkg.name.startsWith('@')) return pkg.name;
    if (pkg.name) return pkg.name.split('/').pop() ?? root.split('/').pop() ?? 'my-project';
  } catch { /* no package.json */ }

  // Fall back to directory name
  return root.split('/').pop() ?? 'my-project';
}

/** Detect main branch (master or main). */
function detectMainBranch(): string {
  try {
    const head = execSyncRaw('git symbolic-ref --short HEAD', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (head === 'master' || head === 'main') return head;

    const branches = execSyncRaw('git branch --list master main', {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
    if (branches.includes('master')) return 'master';
    if (branches.includes('main')) return 'main';
    return 'main';
  } catch {
    return 'main';
  }
}

// ---------------------------------------------------------------------------
// Migrate command (BOARD.md + cards/*.md → board.json)
// ---------------------------------------------------------------------------

import { readdirSync, mkdirSync, existsSync, writeFileSync } from 'fs';
import { readFileSync as readFs } from 'fs';
import { resolve, join } from 'path';
import { execSync as execSyncRaw } from 'child_process';

function cmdMigrate(kanbanDir: string, { flags }: ParsedArgs): void {
  const json = boolFlag(flags, 'json');
  const boardMdPath = `${kanbanDir}/BOARD.md`;
  const boardMd = readFs(boardMdPath, 'utf-8');

  // Parse BOARD.md sections
  const lines = boardMd.split('\n');

  type Section = { heading: string; lines: string[] };
  const sections: Section[] = [];
  let current: Section | null = null;

  for (const line of lines) {
    if (line.startsWith('## ')) {
      current = { heading: line.replace(/^##\s+/, '').trim(), lines: [] };
      sections.push(current);
    } else if (current) {
      current.lines.push(line);
    }
  }

  // Parse card index table
  const cardIndex: Record<string, string> = {};
  const indexSection = sections.find((s) => s.heading.toLowerCase().startsWith('card index'));
  if (indexSection) {
    for (const line of indexSection.lines) {
      const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (m && !m[1].startsWith('-') && m[1] !== 'Short') {
        cardIndex[m[1].trim()] = m[2].trim();
      }
    }
  }

  // Parse card references from sections
  function parseCardRefs(sectionLines: string[]): Array<{ id: string; description: string }> {
    const refs: Array<{ id: string; description: string }> = [];
    for (const line of sectionLines) {
      const bold = line.match(/^-\s+\*\*(.+?)\*\*\s*[—–-]\s*(.+)$/);
      if (bold) {
        refs.push({ id: bold[1].trim(), description: bold[2].trim() });
      } else {
        const plain = line.match(/^-\s+(\S+)\s*[—–-]\s*(.+)$/);
        if (plain) {
          refs.push({ id: plain[1].trim(), description: plain[2].trim() });
        }
      }
    }
    return refs;
  }

  // Parse done table
  function parseDoneRefs(sectionLines: string[]): Array<{ id: string; completed: string; notes: string }> {
    const refs: Array<{ id: string; completed: string; notes: string }> = [];
    for (const line of sectionLines) {
      const m = line.match(/^\|\s*(.+?)\s*\|\s*(.+?)\s*\|\s*(.+?)\s*\|$/);
      if (m && !m[1].startsWith('-') && m[1] !== 'Card') {
        refs.push({ id: m[1].trim(), completed: m[2].trim(), notes: m[3].trim() });
      }
    }
    return refs;
  }

  // Map sections to columns
  const columnMap: Record<string, string> = {
    'in progress': 'in-progress',
    'up next': 'up-next',
    'ready': 'ready',
    'backlog': 'backlog',
    'in review': 'in-review',
  };

  const cards: Record<string, CardMeta> = {};
  const done: Record<string, DoneMeta> = {};

  for (const section of sections) {
    const h = section.heading.toLowerCase().replace(/\s*\(.*\)/, '');
    const col = columnMap[h];

    if (col) {
      const refs = parseCardRefs(section.lines);
      for (const ref of refs) {
        cards[ref.id] = {
          title: ref.description,
          column: col,
          branch: '',
          priority: '',
          depends_on: [],
          description: ref.description,
          created: today(),
        };
      }
    } else if (h.startsWith('done')) {
      const refs = parseDoneRefs(section.lines);
      for (const ref of refs) {
        done[ref.id] = {
          title: ref.notes.split(',')[0] || ref.id,
          completed: ref.completed,
          notes: ref.notes,
        };
      }
    }
  }

  // Enrich cards from card .md files (metadata + prose)
  const cardsDir = `${kanbanDir}/cards`;
  let enriched = 0;
  try {
    const cardFiles = readdirSync(cardsDir).filter((f) => f.endsWith('.md'));
    for (const file of cardFiles) {
      const cardId = file.replace(/\.md$/, '');
      const content = readFs(`${cardsDir}/${file}`, 'utf-8');
      const card = cards[cardId];
      if (!card) continue;

      // Parse metadata from **Key**: Value lines
      for (const line of content.split('\n')) {
        const meta = line.match(/^\*\*(.+?)\*\*:\s*(.+)$/);
        if (!meta) continue;
        const key = meta[1].trim().toLowerCase();
        const val = meta[2].trim();

        if (key === 'branch') card.branch = val.replace(/`/g, '');
        else if (key === 'priority') card.priority = val;
        else if (key === 'dependencies') {
          if (!val.toLowerCase().startsWith('none')) {
            card.depends_on = val
              .split(',')
              .map((s) => s.trim().replace(/\s*\(.*?\)\s*$/, ''))
              .filter((s) => Boolean(s) && s.toLowerCase() !== 'none');
          } else {
            card.depends_on = [];
          }
        }
      }

      // Extract title from heading
      const titleLine = content.split('\n').find((l) => l.startsWith('# '));
      if (titleLine) {
        const fullTitle = titleLine.replace(/^#\s+/, '').trim();
        card.title = fullTitle;
      }

      enriched++;
    }
  } catch {
    // No cards directory — that's fine
  }

  // Include all standard columns that are used OR have a section in BOARD.md
  const usedColumns = new Set(Object.values(cards).map((c) => c.column));
  const boardSections = new Set(
    sections.map((s) => columnMap[s.heading.toLowerCase().replace(/\s*\(.*\)/, '')] ?? '').filter(Boolean)
  );
  const columns = ['backlog', 'ready', 'up-next', 'in-progress', 'in-review'].filter(
    (c) => usedColumns.has(c) || boardSections.has(c)
  );

  const board: BoardJson = {
    version: 1,
    columns,
    cards,
    done,
    cardIndex,
  };

  writeBoard(kanbanDir, board);

  const stats = {
    cards: Object.keys(cards).length,
    done: Object.keys(done).length,
    enriched,
    aliases: Object.keys(cardIndex).length,
    columns,
  };

  if (json) return outputJson(stats);
  console.log(`\n  Migrated to board.json:`);
  console.log(`    ${stats.cards} active cards`);
  console.log(`    ${stats.done} done cards`);
  console.log(`    ${stats.enriched} enriched from card .md files`);
  console.log(`    ${stats.aliases} short aliases`);
  console.log(`    Columns: ${columns.join(', ')}`);
  console.log();
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main(): void {
  const parsed = parseArgs(process.argv);
  const dirOverride = flag(parsed.flags, 'dir');
  const json = boolFlag(parsed.flags, 'json');

  try {
    // init can run on a fresh project with no board.json yet
    if (parsed.command === 'init') {
      let initDir: string;
      try {
        initDir = findKanbanDir(dirOverride);
      } catch {
        initDir = dirOverride
          ? resolve(dirOverride)
          : join(process.cwd(), 'docs', 'kanban');
      }
      mkdirSync(initDir, { recursive: true });
      return cmdInit(initDir, parsed);
    }

    const kanbanDir = findKanbanDir(dirOverride);

    switch (parsed.command) {
      case 'list':
      case 'ls':
        return cmdList(kanbanDir, parsed);
      case 'ready':
        return cmdReady(kanbanDir, parsed);
      case 'show':
        return cmdShow(kanbanDir, parsed);
      case 'move':
      case 'mv':
        return cmdMove(kanbanDir, parsed);
      case 'done':
        return cmdDone(kanbanDir, parsed);
      case 'add':
        return cmdAdd(kanbanDir, parsed);
      case 'edit':
        return cmdEdit(kanbanDir, parsed);
      case 'remove':
      case 'rm':
        return cmdRemove(kanbanDir, parsed);
      case 'comment':
        return cmdComment(kanbanDir, parsed);
      case 'migrate':
        return cmdMigrate(kanbanDir, parsed);
      default:
        fail('UNKNOWN_COMMAND', `Unknown command: ${parsed.command}`, {
          available: ['list', 'ready', 'show', 'move', 'done', 'add', 'edit', 'remove', 'comment', 'migrate', 'init'],
        });
    }
  } catch (err) {
    if (isCliError(err)) {
      if (json) {
        outputJsonError(err);
        process.exit(1);
      }
      console.error(`\n  Error [${err.code}]: ${err.message}`);
      if (err.details) {
        for (const [k, v] of Object.entries(err.details)) {
          console.error(`    ${k}: ${Array.isArray(v) ? v.join(', ') : v}`);
        }
      }
      console.error();
      process.exit(1);
    }
    throw err;
  }
}

main();
