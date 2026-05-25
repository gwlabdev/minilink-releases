---
name: board
description: >
  Quick Kanban board status viewer. Uses the kanban CLI to show board state.
  With an argument, shows that card's details.
  Usage: /board  or  /board KANBAN-PANEL
license: Apache-2.0
metadata:
  author: Dani
  version: "2.0"
  scope: [root]
allowed-tools: Bash, Read
---

## Overview

`/board` uses the kanban CLI (`docs/kanban/cli/kanban.ts`) to display board state.
No argument → full board. With argument → card detail.

**CLI location**: `docs/kanban/cli/kanban.ts` (relative to project root)

---

## Step 1: No argument — full board summary

Run:
```bash
npx tsx docs/kanban/cli/kanban.ts list
```

This prints the board grouped by column with blocked/ready indicators.

If you need machine-readable data (e.g., to render in a custom format):
```bash
npx tsx docs/kanban/cli/kanban.ts list --json
```

Returns `{ ok: true, data: { "backlog": [...], "in-progress": [...], "done": [...] } }`.

To show only actionable (unblocked) cards:
```bash
npx tsx docs/kanban/cli/kanban.ts ready
```

---

## Step 2: With argument — card detail

If an argument is provided (e.g. `/board P4B`):

Run:
```bash
npx tsx docs/kanban/cli/kanban.ts show {CARD_ID}
```

This resolves short aliases (P4B → P4B-TS-LINK), shows metadata + any card prose from `cards/*.md`.

For JSON output:
```bash
npx tsx docs/kanban/cli/kanban.ts show {CARD_ID} --json
```

Returns `{ ok: true, data: { id, title, column, branch, priority, depends_on, comments, prose } }`.

---

## Edge cases

| Scenario | Behavior |
|----------|----------|
| No board.json | Error: "No kanban board found". Suggest `/kanban-init`. |
| Card ID not found | CLI returns structured error with available card IDs and aliases |
| Empty board | Shows column headers with count 0 |
