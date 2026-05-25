/**
 * Kanban CLI integration tests.
 *
 * Tests the CLI the way skills call it: `kanban <command> --json`
 * then parse the JSON envelope { ok, data?, error? }.
 *
 * Run: cd docs/kanban/cli && npm test
 */

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const CLI = join(__dirname, 'kanban.ts');
const TSX = join(__dirname, 'node_modules', '.bin', 'tsx');

// ---------------------------------------------------------------------------
// Helper — runs CLI exactly how skills do
// ---------------------------------------------------------------------------

interface CliResult {
  ok: boolean;
  data?: any;
  error?: { code: string; message: string; details?: Record<string, unknown> };
}

function kanban(args: string, cwd: string): CliResult {
  try {
    const out = execSync(`${TSX} ${CLI} ${args} --json`, {
      cwd,
      encoding: 'utf-8',
      timeout: 30_000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return JSON.parse(out);
  } catch (err: any) {
    // CLI exits 1 on errors but still writes JSON to stdout
    if (err.stdout) {
      try {
        return JSON.parse(err.stdout);
      } catch { /* fall through */ }
    }
    throw new Error(`CLI crashed: ${err.stderr?.slice(0, 300) || err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('kanban CLI', () => {
  let projectDir: string;

  before(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'kanban-test-'));
    // Make it a git repo so init can detect branch
    execSync('git init -q', { cwd: projectDir });
    // init creates docs/kanban/ with board.json, config.json, cards/
    const r = kanban(`init --dir ${join(projectDir, 'docs', 'kanban')} --name TestProject`, projectDir);
    assert.equal(r.ok, true, 'init should succeed');
    assert.ok(r.data.created.includes('board.json'), 'should create board.json');
    assert.ok(r.data.created.includes('config.json'), 'should create config.json');
  });

  after(() => {
    rmSync(projectDir, { recursive: true, force: true });
  });

  // -----------------------------------------------------------------------
  // 1. Full lifecycle — the happy path skills follow
  // -----------------------------------------------------------------------
  it('lifecycle: add → list → move → comment → show → done', () => {
    // /plan-card calls: kanban add
    const add = kanban('add FEAT-LOGIN --title "User Login" --priority P1 --branch feat/login', projectDir);
    assert.equal(add.ok, true);
    assert.equal(add.data.id, 'FEAT-LOGIN');
    assert.equal(add.data.column, 'backlog');

    // /board calls: kanban list
    const list = kanban('list', projectDir);
    assert.equal(list.ok, true);
    assert.ok(list.data.backlog.some((c: any) => c.id === 'FEAT-LOGIN'));

    // /sprint calls: kanban move <ID> in-progress
    const move = kanban('move FEAT-LOGIN in-progress', projectDir);
    assert.equal(move.ok, true);
    assert.equal(move.data.from, 'backlog');
    assert.equal(move.data.to, 'in-progress');
    assert.equal(move.data.changed, true);

    // Agent adds context: kanban comment
    const comment = kanban('comment FEAT-LOGIN --body "Explored auth patterns, using JWT"', projectDir);
    assert.equal(comment.ok, true);
    assert.equal(comment.data.comment.author, 'cli');

    // /board <ID> calls: kanban show
    const show = kanban('show FEAT-LOGIN', projectDir);
    assert.equal(show.ok, true);
    assert.equal(show.data.column, 'in-progress');
    assert.ok(show.data.started, 'started timestamp auto-set on first move');
    assert.equal(show.data.comments.length, 1);

    // Idempotent move — skills can retry safely
    const same = kanban('move FEAT-LOGIN in-progress', projectDir);
    assert.equal(same.ok, true);
    assert.equal(same.data.changed, false);

    // /merge calls: kanban done
    const done = kanban('done FEAT-LOGIN --notes "Merged PR #42"', projectDir);
    assert.equal(done.ok, true);
    assert.ok(done.data.completed);

    // Verify in done
    const showDone = kanban('show FEAT-LOGIN', projectDir);
    assert.equal(showDone.ok, true);
    assert.ok(showDone.data.completed);

    // Cleanup
    kanban('remove FEAT-LOGIN', projectDir);
  });

  // -----------------------------------------------------------------------
  // 2. Dependency blocking — board correctness
  // -----------------------------------------------------------------------
  it('deps: blocked card excluded from ready, unblocked when dep progresses', () => {
    kanban('add DEP-A --title "Base Feature" --priority P1', projectDir);
    kanban('add DEP-B --title "Depends on A" --priority P2 --dep DEP-A', projectDir);

    // B is blocked → not in ready list
    const ready1 = kanban('ready', projectDir);
    assert.ok(ready1.data.some((c: any) => c.id === 'DEP-A'), 'A should be ready');
    assert.ok(!ready1.data.some((c: any) => c.id === 'DEP-B'), 'B should be blocked');

    // list also marks B as blocked
    const list = kanban('list', projectDir);
    const bInList = list.data.backlog.find((c: any) => c.id === 'DEP-B');
    assert.equal(bInList.blocked, true);

    // Move A to in-progress → B becomes unblocked
    kanban('move DEP-A in-progress', projectDir);
    const ready2 = kanban('ready', projectDir);
    assert.ok(ready2.data.some((c: any) => c.id === 'DEP-B'), 'B unblocked after A starts');

    // Move A to done → B still unblocked
    kanban('done DEP-A --notes "complete"', projectDir);
    const ready3 = kanban('ready', projectDir);
    assert.ok(ready3.data.some((c: any) => c.id === 'DEP-B'), 'B unblocked after A done');

    kanban('remove DEP-A', projectDir);
    kanban('remove DEP-B', projectDir);
  });

  // -----------------------------------------------------------------------
  // 3. Edit, aliases, blocked_reason — field operations skills need
  // -----------------------------------------------------------------------
  it('edit + aliases: short alias, field updates, external blockers', () => {
    kanban('add P6-VIEWER --title "3D Viewer" --short P6 --priority P6', projectDir);

    // Alias resolves in show
    const show = kanban('show P6', projectDir);
    assert.equal(show.ok, true);
    assert.equal(show.data.title, '3D Viewer');

    // Alias resolves in move
    kanban('move P6 up-next', projectDir);
    const show2 = kanban('show P6', projectDir);
    assert.equal(show2.data.column, 'up-next');

    // Edit: change title + add dep
    kanban('add BLOCKER --title "Prereq"', projectDir);
    const edit = kanban('edit P6-VIEWER --title "VTK 3D Viewer" --add-dep BLOCKER', projectDir);
    assert.equal(edit.ok, true);
    assert.equal(edit.data.changed, true);
    assert.equal(edit.data.card.title, 'VTK 3D Viewer');
    assert.deepEqual(edit.data.card.depends_on, ['BLOCKER']);

    // Remove dep
    kanban('edit P6-VIEWER --remove-dep BLOCKER', projectDir);
    const show3 = kanban('show P6', projectDir);
    assert.deepEqual(show3.data.depends_on, []);

    // External blocker (blocked_reason)
    kanban('edit P6-VIEWER --blocked-reason "Waiting on VTK WASM build"', projectDir);
    const ready = kanban('ready', projectDir);
    assert.ok(!ready.data.some((c: any) => c.id === 'P6-VIEWER'), 'blocked by reason');

    // Clear blocker
    kanban('edit P6-VIEWER --blocked-reason ""', projectDir);
    const ready2 = kanban('ready', projectDir);
    assert.ok(ready2.data.some((c: any) => c.id === 'P6-VIEWER'), 'unblocked');

    kanban('remove BLOCKER', projectDir);
    kanban('remove P6-VIEWER', projectDir);
  });

  // -----------------------------------------------------------------------
  // 4. Error handling — agents parse errors to recover
  // -----------------------------------------------------------------------
  it('errors: structured JSON with codes, details, and available options', () => {
    // Card not found
    const notFound = kanban('show GHOST', projectDir);
    assert.equal(notFound.ok, false);
    assert.equal(notFound.error!.code, 'CARD_NOT_FOUND');
    assert.ok(Array.isArray(notFound.error!.details!.aliases));

    // Invalid column
    kanban('add ERR-COL --title "test"', projectDir);
    const badCol = kanban('move ERR-COL fake-column', projectDir);
    assert.equal(badCol.ok, false);
    assert.equal(badCol.error!.code, 'INVALID_COLUMN');
    assert.ok(Array.isArray(badCol.error!.details!.available));

    // Duplicate card
    const dupe = kanban('add ERR-COL --title "duplicate"', projectDir);
    assert.equal(dupe.ok, false);
    assert.equal(dupe.error!.code, 'DUPLICATE');

    // Done card can't be moved
    kanban('done ERR-COL --notes "done"', projectDir);
    const moveDone = kanban('move ERR-COL backlog', projectDir);
    assert.equal(moveDone.ok, false);
    assert.equal(moveDone.error!.code, 'NOT_ACTIVE');

    kanban('remove ERR-COL', projectDir);
  });
});
