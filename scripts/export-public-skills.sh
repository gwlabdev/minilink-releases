#!/usr/bin/env bash
set -euo pipefail

src="${1:-/home/danilopezmella/minilink-skills}"
dest="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
public_skills=(
  board
  kanban-init
  merge
  plan-card
  sprint
)

if [[ ! -d "$src/skills" ]]; then
  echo "missing skills directory: $src/skills" >&2
  exit 1
fi

rm -rf "$dest/skills"
mkdir -p "$dest/skills"

for skill in "${public_skills[@]}"; do
  if [[ ! -d "$src/skills/$skill" ]]; then
    echo "missing approved skill: $src/skills/$skill" >&2
    exit 1
  fi

  rsync -a --delete \
    --exclude '.git' \
    --exclude '.DS_Store' \
    "$src/skills/$skill/" "$dest/skills/$skill/"
done

if [[ -f "$src/LICENSE" ]]; then
  cp "$src/LICENSE" "$dest/LICENSE.skills"
fi

echo "exported approved skills from $src to $dest/skills"
