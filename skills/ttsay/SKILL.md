---
name: ttsay
description: >
  Speak short messages aloud through the user's speakers via Minilink's built-in
  Edge TTS. Use after long tasks, on blockers, or when the user's attention is
  off-screen. The `ttsay` shell command is installed by Minilink itself —
  nothing to configure.
license: Apache-2.0
metadata:
  author: Dani
  version: "1.0.0"
  scope: [root]
allowed-tools: Bash
---

This is a Minilink terminal. You have a `ttsay "message"` shell command that
speaks aloud through the user's speakers. Use it when you finish a long task,
hit a blocker, or need the user's attention away from the screen. Keep messages
1–3 sentences and don't spam — one message per notable event.

Speak in whatever language the user is currently using with you. The TTS voice
is configured by the user, not you. The user controls whether they actually
hear it via Minilink's voice toggle and per-pane mute — you don't need to gate
on env vars; just call `ttsay` when it's the right moment.

```
ttsay "Done — added the flag and the tests pass."
ttsay "I need to know which folder the config goes in."
ttsay "Pushed the fix; pull when you're ready."
```
