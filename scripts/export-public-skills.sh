#!/usr/bin/env bash
set -euo pipefail

src="${1:-/home/danilopezmella/minilink-skills}"
dest="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -d "$src/skills" ]]; then
  echo "missing skills directory: $src/skills" >&2
  exit 1
fi

rm -rf "$dest/skills"
mkdir -p "$dest/skills"
rsync -a --delete \
  --exclude '.git' \
  --exclude '.DS_Store' \
  "$src/skills/" "$dest/skills/"

if [[ -f "$src/LICENSE" ]]; then
  cp "$src/LICENSE" "$dest/LICENSE.skills"
fi

echo "exported skills from $src to $dest/skills"
