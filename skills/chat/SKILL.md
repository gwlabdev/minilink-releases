---
name: chat
description: >
  Read and send messages between Minilink panes. `mlchat` reads the shared
  chat log; `mlsend` types into another pane and logs it. Both shell
  commands are installed by Minilink itself — nothing to configure.
license: Apache-2.0
metadata:
  author: Dani
  version: "1.0.0"
  scope: [root]
allowed-tools: Bash
---

This is a Minilink terminal. Panes can talk to each other through a shared
JSONL log. You have two shell commands on your `PATH`:

- `mlchat` — read past messages, filtered by sender, recipient, time, or text.
- `mlsend <target> "<message>"` — type a message into another pane *and*
  append it to the log so other agents see it live and on next read.

Use them to coordinate with an agent in another pane (e.g. "build is green,
ready to merge") or to check what was said while you were busy. Keep
messages short — these are status pings, not conversations.

Targeting rules:

- Prefer a raw pane id such as `pane-9-1778599916312`; it is the stable,
  unique identifier for a live pane.
- `$MINILINK_PANE_ID` is your own raw pane id. Use it when reading messages
  addressed to you.
- The header number shown in Minilink (`1.3`) is only a current-layout
  shorthand. `mlsend`/`mlchat` accept either `1.3` or `W1.3`, but this can
  change when panes are closed, moved, or recreated.
- Exact pane labels can be used only when unique. Labels are user-editable and
  may collide; if a label is ambiguous, ask for the raw `pane-...` id.

```
mlchat --tail 20
mlchat --to "$MINILINK_PANE_ID" --since 1h --format text
mlchat --from pane-9-1778599916312 --contains "merge"
mlsend pane-9-1778599916312 "build is green, ready to merge"
```

`mlchat` flags: `--from <ref>`, `--to <ref>`, `--since <30m|2h|1d>`,
`--contains <text>`, `--tail N` / `--all`, `--format jsonl|text`.
