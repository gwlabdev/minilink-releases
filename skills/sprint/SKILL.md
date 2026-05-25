---
name: sprint
description: >
  Kanban-to-worktree automation. Reads a card via CLI, creates branch + worktree,
  moves card to IN PROGRESS, and launches the agent inline in the current
  Minilink pane. The agent starts in plan mode (one approval gate), then
  runs the rest of the workflow autonomously: implement → test → commit →
  push → PR → board update.
  Works with any project that has docs/kanban/config.json.
  Usage: /sprint CARD-ID  or  /sprint P1
license: Apache-2.0
metadata:
  author: Dani
  version: "3.5"
  scope: [root]
allowed-tools: Read, Bash, Glob
---

## Overview

`/sprint {CARD_ID}` automates the full sprint setup for a Kanban card:
1. Read card metadata via CLI
2. Move card to IN PROGRESS via CLI
3. Create git branch + worktree
4. Launch the agent CLI inline in the current pane

All project-specific settings come from `docs/kanban/config.json`.

**CLI**: `npx tsx docs/kanban/cli/kanban.ts` (from project root)

---

## Step 0: Load project config

**REQUIRED:** If `docs/kanban/config.json` does not exist, STOP immediately:

> Kanban board not initialized. Run `/kanban-init` first.

Read `docs/kanban/config.json`. Extract settings with these defaults:

| Setting | Config path | Default |
|---------|------------|---------|
| Project name | `project.name` | Git repo directory name |
| Main branch | `project.mainBranch` | `"main"` |
| Branch prefix | `project.branchPrefix` | `"feat/"` |
| Worktrees enabled | `worktrees.enabled` | `false` |
| Worktree base dir | `worktrees.baseDir` | `"~/{project-name}-worktrees"` |
| Port base backend | `worktrees.ports.baseBackend` | None (skip port config) |
| Port base frontend | `worktrees.ports.baseFrontend` | None (skip port config) |
| Env file | `worktrees.ports.envFile` | None |
| Env vars | `worktrees.ports.envVars` | `{}` |
| Prompt template | `promptTemplate` | Use skill default at `assets/prompt-template-default.md` |
| Test command | `commands.test` | `""` |

After loading config, validate critical fields:
- If `project.mainBranch` is missing/undefined: detect with
  `git symbolic-ref --short HEAD 2>/dev/null || echo main`
- If `project.branchPrefix` is missing/undefined: use `"feat/"`

**Resolve `projectRoot`** — all paths derive from this:
```bash
projectRoot=$(git rev-parse --show-toplevel)
```

---

## Step 1: Read card via CLI

```bash
npx tsx docs/kanban/cli/kanban.ts show {CARD_ID} --json
```

Parse the JSON response. Extract:
- `data.id` — full card ID (alias resolved)
- `data.branch` — git branch name
- `data.column` — current column
- `data.title` — card title
- `data.depends_on` — dependency list

**Guard rails:**
- If `ok` is `false`: print the error and stop.
- If `data.column` is in done: warn and stop.
- If branch is empty: derive as `{branchPrefix}{lowercase-card-id}`.
  Verify result does not contain "undefined". If branchPrefix was missing, use `"feat/"`.

---

## Step 2: Move card to IN PROGRESS

```bash
npx tsx docs/kanban/cli/kanban.ts move {CARD_ID} in-progress --json
```

This is **idempotent** — if already in-progress, returns `{ changed: false }` without error.
The CLI also auto-sets the `started` timestamp on first move out of backlog.

---

## Step 3: Commit card move (before branch creation)

The board state change must be committed to the main branch **before** creating the feature branch, so the worktree will contain updated board state.

```bash
git add docs/kanban/board.json
git commit -m "kanban: start {CARD_ID}" --allow-empty
```

If nothing changed (idempotent move), skip the commit silently.

---

## Step 4: Git setup (idempotent)

Resolve `workDir` — the **absolute** path where Claude Code will run:
- **If worktrees enabled**: expand `~` in `baseDir`, then `workDir = {expanded-baseDir}/{lowercase-card-id}`
- **If worktrees disabled**: `workDir = {projectRoot}`

```bash
# Expand a leading ~ in baseDir using parameter expansion (no eval —
# the value comes from config.json on disk, but treating it as code is
# unnecessary risk).
baseDir="{worktrees.baseDir}"
expandedBase="${baseDir/#\~/$HOME}"

# Build workDir
workDir="{expandedBase}/{lowercase-card-id}"

# Create branch from main branch (only if branch doesn't exist)
git branch {branch} {mainBranch} 2>/dev/null || true

# Create worktree (only if worktrees enabled and directory doesn't exist)
if [ worktrees.enabled ] && [ ! -d "{workDir}" ]; then
  git worktree add "{workDir}" {branch}
fi

# Sync worktree with main branch (picks up card files, board changes)
cd "{workDir}" && git merge {mainBranch} --no-edit 2>/dev/null; cd "{projectRoot}"
```

### OS-aware path formatting

When printing paths for the user (report, manual commands), use the OS-native format:
- **Windows** (`win32`): Use backslashes, e.g. `C:\Users\gwm\gwlink-worktrees\p25-cln-bc`
- **WSL**: Treat as Linux — always use native Linux paths (`/home/user/...`), **never** UNC paths (`//wsl.localhost/...`). Detect via `uname -r | grep -qi microsoft`.
- **macOS/Linux**: Use forward slashes as-is, e.g. `~/gwlink-worktrees/p25-cln-bc`

The agent already knows the platform from its environment. No shell conversion needed — just format the string directly when building user-facing output. **Use the native-formatted path in ALL user-facing output** (printed commands, reports). Use `{workDir}` only in bash commands (git worktree, cd before launching the agent).

### WSL path safety

On WSL, paths can accidentally resolve to UNC format (`//wsl.localhost/Ubuntu-24.04/...`) which causes `Permission denied` errors with git worktree. **Always sanitize paths:**

```bash
# Expand ~ safely (no eval) and strip any UNC prefix
baseDir="{worktrees.baseDir}"
expandedBase="${baseDir/#\~/$HOME}"
expandedBase="${expandedBase#//wsl.localhost/*/}"  # strip UNC prefix if present
if [[ "$expandedBase" != /* ]]; then
  expandedBase="/$expandedBase"  # ensure absolute
fi
```

**Rule:** If any resolved path starts with `//wsl.localhost`, replace it with the equivalent `/home/...` Linux-native path before passing to `git worktree add`.

**If worktrees are disabled** (`worktrees.enabled: false`):
- Still create the branch
- Skip worktree creation entirely
- `workDir` is `{projectRoot}` — Claude Code runs in the main repo on that branch

---

## Step 4.5: Create port config (if configured)

Only if `worktrees.ports.enabled` is `true` AND worktrees are enabled.

Extract `N` from the card ID (first number found, or count worktrees + 1).

```
BACKEND_PORT = ports.baseBackend + N
FRONTEND_PORT = ports.baseFrontend + N
```

Write the env file inside the worktree with computed ports.

---

## Step 5: Launch the agent CLI

Sprint launches do **not** generate or write a `.sprint-prompt.md` file. The two sources the agent needs already exist on disk:

1. The card spec at `docs/kanban/cards/{CARD_ID}.md` — written by `/plan-card`.
2. The sprint workflow rules at `docs/kanban/{config.promptTemplate}` (typically `docs/kanban/assets/prompt-template.md`) — agent-neutral file with the run/commit/push/PR/board flow plus any project rules.

The skill passes a short pointer prompt that names both files and tells the agent how to behave end-to-end:

```
You are implementing card {CARD_ID} for {PROJECT_NAME}.

Read in order:
1. docs/kanban/cards/{CARD_ID}.md — the card specification (Summary, Touch Points, Acceptance Criteria, Testing gate).
2. docs/kanban/{config.promptTemplate} — the sprint workflow (plan-mode → implement → test → commit → push → PR → board update).

Workflow:
1. Enter plan mode and present an implementation plan.
2. Wait for the user to approve the plan. THIS is the only approval gate.
3. After approval, run every remaining step in the workflow autonomously
   without asking for further confirmation: implement, test, commit, push,
   open the PR, and update the board to IN REVIEW. Do NOT stop and ask
   "what next?" — execute the full workflow until the Sprint Summary is
   printed.
```

### Launching the agent CLI

Two critical requirements:
1. **Pointer prompt, not inlined content** — pass the short text above, never the full rendered prompt. The file on disk is the source of truth.
2. **Unset CLAUDECODE** — Claude Code refuses to run inside another Claude Code session. Since this skill may run from Claude Code, the env var `CLAUDECODE` is set. Must `unset CLAUDECODE` before launching.

Build the launch pointer once (single-line, agent-neutral) and reuse:

```
LAUNCH_PROMPT="You are implementing card {CARD_ID} for {PROJECT_NAME}. Read docs/kanban/cards/{CARD_ID}.md (the spec) and docs/kanban/{config.promptTemplate} (the workflow). Start in plan mode and present a plan; that is the ONLY approval gate. After the user approves, run every remaining workflow step autonomously without asking — implement, test, commit, push, open the PR, and move the card to IN REVIEW. Do not stop to ask 'what next?' until the Sprint Summary is printed."
```

Pick the launch mode by inspecting the environment:

**1. Inside Minilink** (`$MINILINK_PANE_ID` is set — the expected case):

Minilink manages panes natively. Run the agent inline in the current
pane; it takes over the shell once the skill finishes. If the user
wants the original `/sprint` pane to stay visible, they can split a
Minilink pane (`Ctrl+Shift+N`/`T`) before running the skill.

```bash
cd "{workDir}" && unset CLAUDECODE && claude --dangerously-skip-permissions "$LAUNCH_PROMPT"
```

**2. Outside Minilink** (no `$MINILINK_PANE_ID`):

Print the launch command using the OS-native path format and tell the
user to run it in whichever terminal/window they prefer. Do not spawn
windows yourself — Minilink is the only host this skill manages.

```
cd "{nativePath}"; unset CLAUDECODE; claude --dangerously-skip-permissions "$LAUNCH_PROMPT"
```

---

## Step 6: Report to user

```
Sprint started for {CARD_ID}

  Project:  {project.name}
  Worktree: {nativePath} (or "main repo" if worktrees disabled)
  Branch:   {branch}
  Board:    Moved to IN PROGRESS

Agent CLI is taking over this pane.
```

---

## Edge cases

| Scenario | Behavior |
|----------|----------|
| Branch already exists | Skip `git branch`, reuse existing |
| Worktree already exists | Skip `git worktree add`, just launch |
| Card not found | CLI returns structured error with suggestions |
| Card already IN PROGRESS | Move is idempotent, still launch Claude Code |
| Inside Minilink (`$MINILINK_PANE_ID` set) | Run agent inline in the current pane. |
| Outside Minilink | Print the launch command for the user to run manually. |
| No config.json | STOP — tell user to run `/kanban-init` first |
| Worktrees disabled | Create branch only, run in main repo |
| CLAUDECODE env var set | Always `unset CLAUDECODE` before launching Claude CLI |
| WSL environment | Always use native Linux paths, never UNC (`//wsl.localhost/...`) |
| Prompt files | Card spec + project workflow already exist on disk; the skill writes nothing extra |
| Workflow file missing | If `docs/kanban/{config.promptTemplate}` doesn't exist, fall back to `assets/prompt-template-default.md` from the skill and warn the user |
