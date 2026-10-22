#!/bin/sh
# Publish a canonical schema product from schemas/<product> to its reference
# mirror at github.com/mediafranca/<product>. One-way: the mirror is made
# byte-identical to the canonical directory, then committed and tagged.
#
#   scripts/publish-schemas.sh <product>            dry run: show what changes
#   scripts/publish-schemas.sh <product> --push     commit, tag v<version>, push
#
# A file listed in the product's FROZEN_RELEASES.json whose content in the
# mirror differs from the frozen hash is a published release being replaced.
# That is refused unless the file is named in ALLOW_FROZEN_OVERWRITE
# (space-separated), which records an explicit decision.
set -eu

product="${1:-}"
mode="${2:-}"
case "$product" in
  nlu-schema|mf-svg-schema|pictogram-composition-schema|pictos-api) ;;
  *) echo "usage: $0 <nlu-schema|mf-svg-schema|pictogram-composition-schema|pictos-api> [--push]" >&2; exit 2 ;;
esac

src="schemas/$product"
repo="mediafranca/$product"
[ -d "$src" ] || { echo "Missing $src" >&2; exit 1; }
[ -z "$(git status --porcelain -- "$src")" ] || { echo "Uncommitted changes in $src; commit them first" >&2; exit 1; }

version=$(node -p "require('./$src/package.json').version")
source_sha=$(git rev-parse --short HEAD)

# Tests of the product itself, when it defines them.
if node -e "process.exit(require('./$src/package.json').scripts?.test ? 0 : 1)"; then
  npm test --prefix "$src" >/dev/null
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
git clone -q "https://github.com/$repo.git" "$work/mirror"

# Refuse to replace a frozen release silently.
if [ -f "$src/FROZEN_RELEASES.json" ]; then
  ALLOW_FROZEN_OVERWRITE="${ALLOW_FROZEN_OVERWRITE:-}" node -e '
    const fs = require("fs"), crypto = require("crypto"), path = require("path");
    const [src, mirror] = process.argv.slice(1);
    const allowed = new Set((process.env.ALLOW_FROZEN_OVERWRITE || "").split(/\s+/).filter(Boolean));
    const frozen = JSON.parse(fs.readFileSync(path.join(src, "FROZEN_RELEASES.json"), "utf8"));
    let refused = false;
    for (const [file, hash] of Object.entries(frozen)) {
      const m = path.join(mirror, file);
      if (!fs.existsSync(m)) continue;
      const got = crypto.createHash("sha256").update(fs.readFileSync(m)).digest("hex");
      if (got === hash) continue;
      if (allowed.has(file)) { console.error("Replacing published " + file + " (explicitly allowed)"); continue; }
      console.error("Mirror " + file + " differs from frozen hash " + hash.slice(0, 8) + "; set ALLOW_FROZEN_OVERWRITE to replace it");
      refused = true;
    }
    process.exit(refused ? 1 : 0);
  ' "$src" "$work/mirror"
fi

rsync -a --delete --exclude .git --exclude node_modules "$src/" "$work/mirror/"

cd "$work/mirror"
git add -A
if git diff --cached --quiet; then
  echo "$repo already matches $src at $version"
  exit 0
fi
git diff --cached --stat | tail -15

if [ "$mode" != "--push" ]; then
  echo "Dry run. Re-run with --push to publish $repo v$version"
  exit 0
fi

git commit -q -m "release: v$version from hspencer/pictos-net@$source_sha

Synchronised from the canonical directory schemas/$product."
git tag -a "v$version" -m "v$version from hspencer/pictos-net@$source_sha"
git push -q origin HEAD
git push -q origin "v$version"
echo "Published $repo v$version"
