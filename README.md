# Minilink Releases

Public distribution repo for Minilink.

This repository contains final public artifacts only:

- Minilink desktop installers in GitHub Releases
- Public snapshots of companion agent workflow skills under `skills/`
- Checksums for release assets

The Minilink application source code and day-to-day skill development repos are
private. The skills published here are separate companion workflow tools, not
part of the Minilink app source.

## Downloads

Get the latest installers from:

https://github.com/gwlabdev/minilink-releases/releases

## Skills

The `skills/` directory is a release snapshot copied from the private
`minilink-skills` development repo. It is intentionally copied, not symlinked,
so the public repo is self-contained and does not expose private history.

Published skills:

- `board`
- `kanban-init`
- `merge`
- `plan-card`
- `sprint`

### Install

Install with the open-source [`skills`](https://github.com/vercel-labs/skills)
CLI:

```bash
npx skills add gwlabdev/minilink-releases -g
```

`-g` installs globally into each detected agent's skills directory, following
that agent's convention. Without `-g`, the skills install into the current
project.

Useful variations:

```bash
# One skill only
npx skills add gwlabdev/minilink-releases -s sprint -g

# One agent only
npx skills add gwlabdev/minilink-releases -g -a codex

# Project-scoped install
npx skills add gwlabdev/minilink-releases
```

After installing, restart the agent so it reloads its skills.

### Workflow

Use the kanban skills as a repo-local workflow:

```text
1. /kanban-init
2. /plan-card "Add the feature"
3. /board
4. /sprint CARD-ID
5. Open a PR
6. /merge CARD-ID
```

If a project does not have `docs/kanban/config.json`, run `/kanban-init` first.
`/plan-card`, `/sprint`, and `/merge` depend on that project-local config.

## Website

https://gwlab.dev
