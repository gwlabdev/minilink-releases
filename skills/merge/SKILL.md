---
name: merge
description: >
  Review and merge a card's PR. Performs a full code review (diff analysis,
  test verification, change summary, issue detection) with user approval gate
  before merging. Then moves card to DONE on the board via CLI.
  Usage: /merge CARD-ID  or  /merge P1
license: Apache-2.0
metadata:
  author: Dani
  version: "5.0"
  scope: [root]
allowed-tools: Read, Edit, Bash, Glob, Grep, AskUserQuestion, Agent
---

## Overview

`/merge {CARD_ID}` reviews the open PR for a Kanban card, presents a structured review summary for approval, merges it, and moves it to DONE via the kanban CLI.

**CLI**: `npx tsx docs/kanban/cli/kanban.ts` (from project root)

**Flow:** review diff → deep modules audit → auto-fix findings → merge → `kanban done` → commit

**v5.0 change:** No more user confirmation gate. Findings are auto-fixed based on learned patterns from minilink2 sprint (user chose "fix first" 100% of the time across 9 PRs).

---

## Step 0: Load project config

**REQUIRED:** If `docs/kanban/config.json` does not exist, STOP immediately:

> Kanban board not initialized. Run `/kanban-init` first.

Read `docs/kanban/config.json`. Extract settings with these defaults:

| Setting | Config path | Default |
|---------|------------|---------|
| Project name | `project.name` | Git repo directory name |
| Main branch | `project.mainBranch` | `"main"` |
| Test command | `commands.test` | `""` |

After loading config, validate `project.mainBranch`:
- If missing/undefined: detect with `git symbolic-ref --short HEAD 2>/dev/null || echo main`

---

## Step 1: Read card via CLI

```bash
npx tsx docs/kanban/cli/kanban.ts show {CARD_ID} --json
```

Extract from response:
- `data.id` — full card ID (alias resolved)
- `data.branch` — git branch for PR lookup
- `data.column` — current status
- `data.title` — card title

**Guard rails:**
- If `ok` is `false`: print error and stop.
- If card is already done (`data.completed` exists): warn and stop.
- If no branch set: error and stop.

---

## Step 2: Check prerequisites

```bash
command -v gh >/dev/null 2>&1
```
If `gh` not available: error `"gh CLI is required. Install from https://cli.github.com/"` and stop.

---

## Step 3: Find open PR

```bash
gh pr list --head {BRANCH} --state open --json number,url,title --jq '.[0]'
```

- If no open PR found: error `"No open PR for branch {BRANCH}. Create one first."` and stop.
- Extract `number`, `url`, and `title` from the result.

---

## Step 4: Review the PR (Deep Modules Audit)

This is the **critical review gate**. The review MUST include a real Ousterhout deep-modules audit — not a cosmetic checklist.

### 4a: Collect diff and comments

Run in parallel:

```bash
gh pr diff {number} --name-only          # file list
gh pr diff {number}                       # full diff
gh pr view {number} --json comments --jq '.comments[].body'  # comments
```

### 4b: Deep Modules Audit (MANDATORY)

**CRITICAL: This is not optional. Every PR merge MUST go through this audit.**

Spawn a dedicated **Agent** (subagent_type: `general-purpose`) to perform the audit. The agent MUST:

1. **Read each changed/new file IN FULL** — not just the diff hunks. The agent needs the complete file to judge interface depth and module structure.

2. **Evaluate each file against ALL 7 Ousterhout principles**, giving a concrete PASS/WARN/FAIL with specific line references for any non-PASS:

   | Principle | What to check |
   |-----------|---------------|
   | **Interface depth** | Is the interface simple relative to the implementation? A 2-prop component hiding 200 lines of logic = deep (good). A 10-param function doing 20 lines = shallow (bad). |
   | **Information hiding** | Does the module hide internal complexity? Or does it leak store details, API shapes, or internal state to callers? |
   | **Pass-through** | Are there methods/props that just forward to something else without adding value? Unused exports count here too. |
   | **Temporal decomposition** | Is code split by when-it-executes (bad) vs by what-information-it-hides (good)? |
   | **Exception handling** | Are errors handled at the right level? Aggregated or leaked up? Silent swallowing? |
   | **General vs special** | Are utilities too specific? Are specialized modules too generic? |
   | **Complexity red flags** | `any` types, string matching instead of domain types/enums, God objects, feature envy, duplicated constants across files, dead code, unnecessary abstractions |

3. **Check cross-cutting concerns**:
   - Does the PR introduce duplication (same constant/type/logic in multiple files)?
   - Do modified files stay under 500 LOC? If approaching 400+, flag it.
   - Does the module layering follow the matryoshka pattern?
   - Are new interfaces minimal? Could they be simpler?

4. **Return a structured report** with:
   - Summary table: file × principle → PASS/WARN/FAIL
   - Specific findings with line references for every WARN and FAIL
   - Action items ranked by severity

**Agent prompt template:**

```
Perform a thorough deep-modules audit (Ousterhout's "A Philosophy of Software Design")
on PR #{number} for the {project} project. This is a RESEARCH task — do NOT modify files.

Changed files: {list from 4a}

For each file, READ IT IN FULL (not just the diff), then evaluate against Ousterhout's
7 principles: interface depth, information hiding, pass-through, temporal decomposition,
exception handling, general vs special, complexity red flags.

Return a structured report with PASS/WARN/FAIL per principle per file, with specific
line references for any issues. Include cross-cutting concerns (duplication, LOC budget,
module layering, interface minimality).
```

**DO NOT** skip this step. **DO NOT** fake it by listing checkmarks without reading files. The whole point is to catch real architectural issues before they land on the main branch.

### 4c: Present review summary

Combine the diff overview with the audit results:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  PR REVIEW: #{number} — {title}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Branch:     {BRANCH} → {mainBranch}
  Card:       {CARD_ID}
  Stats:      {N files}, +{additions}, -{deletions}

  KEY CHANGES:
  - {bullet summary of major changes}

  DEEP MODULES AUDIT:
  {summary table from agent: file × overall verdict}

  FINDINGS:
  - FAIL: {description + file:line}  (if any)
  - WARN: {description + file:line}  (if any)
  - or "All PASS — no issues found"

  ACTION ITEMS:
  - {ranked list of things to fix, or "None — clean to merge"}

  TESTS:
  - {test files added/modified, or "No test changes"}

  COMMENTS:
  - {unresolved PR comments, or "None"}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

### 4d: Act on findings (auto-fix or merge)

**Decision tree — DO NOT ask the user. Act automatically based on findings:**

| Audit result | Action |
|-------------|--------|
| **All PASS** (no WARN, no FAIL) | Merge immediately — skip to Step 5 |
| **Only LOW WARNs** (cosmetic, no functional impact) | Merge immediately — note WARNs in summary |
| **Any MEDIUM+ WARN or FAIL** | **Auto-fix in the worktree**, run tests, push, then merge |

**Auto-fix process** (when findings exist):
1. Check out the PR branch (or use existing worktree)
2. Fix ALL findings — not just FAILs. Fix WARNs too. The user wants zero tech debt landing on main.
3. Run the project's test command to verify fixes don't break anything
4. Commit with descriptive message listing what was fixed
5. Push to the PR branch
6. Proceed to Step 5 (merge)

**What to fix (ranked by priority):**
- FAIL: Always fix. These are bugs or architectural violations.
- WARN (MEDIUM+): Always fix. Duplicated types, missing error handlers, leaked internals, hardcoded values.
- WARN (LOW): Fix if trivial (< 5 min). Skip if it requires significant refactoring.

**When to ask the user (rare):**
- Only if a fix is genuinely ambiguous (two equally valid approaches, needs product decision)
- Only if fixing would change public API or behavior in a non-obvious way
- NEVER ask "should I fix or merge as-is?" — always fix first

**Learned patterns from minilink2 v1.0 sprint (9 PRs):**
- User ALWAYS chose "fix first" when findings existed (100% of the time)
- User NEVER chose "merge as-is" or "abort"
- User wants ALL findings fixed, including WARNs (e.g., "no hardcoded colors", "extract to shared types")
- Spike/PoC code gets more latitude but still fix real bugs

---

## Step 5: Merge the PR

```bash
gh pr merge {number} --merge --delete-branch
```

- If merge fails due to conflicts: error `"PR #{number} has merge conflicts. Resolve them first, then re-run /merge {CARD_ID}."` and stop.
- If merge fails for other reasons: print the error and stop.

---

## Step 6: Update local repo

```bash
git checkout {mainBranch}
git pull origin {mainBranch}
```

This ensures the local repo has the merged changes before updating board files.

---

## Step 7: Move card to DONE via CLI

```bash
npx tsx docs/kanban/cli/kanban.ts done {CARD_ID} --notes "Merged PR #{number}" --json
```

Verify `ok === true`. This moves the card from active to done, sets the completion date, and records the PR number.

---

## Step 8: Update card file status

If `docs/kanban/cards/{CARD_ID}.md` exists, update the status field:
- Replace `**Status**: {anything}` with `**Status**: DONE`
- Add `**Completed**: {today's date}`

---

## Step 9: Commit and push

```bash
git add docs/kanban/board.json docs/kanban/cards/{CARD_ID}.md
git commit -m "kanban: complete {CARD_ID}"
git push
```

---

## Step 10: Clean up worktree (if exists)

Check if a worktree exists for this card:
```bash
git worktree list | grep {CARD_ID_lowercase}
```

If found, inform the user:
```
Note: Worktree still exists at {path}. Remove it when ready with:
  git worktree remove {path}
```

Do NOT auto-remove — let the user decide.

---

## Step 11: Print summary

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  MERGE COMPLETE: {CARD_ID}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  Card:     {CARD_ID}
  PR:       #{number} — merged and branch deleted
  Board:    Moved to DONE ({date})

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Edge cases

| Scenario | Behavior |
|----------|----------|
| No open PR | Error: "No open PR for branch {branch}" and stop |
| `gh` not installed | Error: "gh CLI required" and stop |
| Merge conflicts | Error: "PR has conflicts, resolve first" and stop |
| Card already DONE | Warn and stop |
| Card not found | CLI returns error with suggestions |
| User aborts after review | Stop gracefully, no changes made |
| Large diff (>1000 lines) | Still review fully, but note the size in summary |
| Card not in IN REVIEW | Warn but proceed (might be in IN PROGRESS) |
