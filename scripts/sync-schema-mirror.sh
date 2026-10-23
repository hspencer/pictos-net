#!/bin/sh
# Synchronise a canonical schema product to its reference mirror at
# github.com/mediafranca/<product>. One-way: the mirror receives the committed
# snapshot produced by scripts/export-schema.mjs (allowlist, credential scan,
# EXPORT_MANIFEST.json), never the raw directory.
#
#   scripts/sync-schema-mirror.sh <product>          dry run: show what changes
#   scripts/sync-schema-mirror.sh <product> --push   commit, tag, push
#
# Guards, after specs/schema-evolution.allium (IndependentPublication):
# - A file in FROZEN_RELEASES.json whose mirror bytes differ from the frozen
#   hash is refused unless named in ALLOW_FROZEN_OVERWRITE.
# - A file that exists only in the mirror is refused unless named in
#   ALLOW_REMOTE_DELETE; remote history is kept and never force-pushed.
# - If tag v<version> already exists, every *.schema.json must match it: a
#   version is never reused for different contract bytes. Other files (README,
#   package metadata, validator code that does not change what passes) may
#   change; that commit is not tagged.
set -eu

product="${1:-}"
mode="${2:-}"
case "$product" in
  pictos-nlu-schema|pictos-composition-schema|pictos-svg-schema|pictos-api-schema) ;;
  *) echo "usage: $0 <pictos-nlu-schema|pictos-composition-schema|pictos-svg-schema|pictos-api-schema> [--push]" >&2; exit 2 ;;
esac

src="schemas/$product"
repo="mediafranca/$product"
[ -z "$(git status --porcelain -- "$src")" ] || { echo "Uncommitted changes in $src; commit them first" >&2; exit 1; }

sha=$(git rev-parse HEAD)
version=$(node -p "require('./$src/package.json').version")

if node -e "process.exit(require('./$src/package.json').scripts?.test ? 0 : 1)"; then
  npm test --prefix "$src" >/dev/null
fi

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
node scripts/export-schema.mjs committed "$product" --ref "$sha" --output "$work/export" >/dev/null
git clone -q "https://github.com/$repo.git" "$work/mirror" 2>/dev/null

ALLOW_FROZEN_OVERWRITE="${ALLOW_FROZEN_OVERWRITE:-}" ALLOW_REMOTE_DELETE="${ALLOW_REMOTE_DELETE:-}" node -e '
  const fs = require("fs"), path = require("path"), crypto = require("crypto");
  const [exp, mirror] = process.argv.slice(1);
  const list = (env) => new Set((process.env[env] || "").split(/\s+/).filter(Boolean));
  const walk = (root, rel = "") => fs.readdirSync(path.join(root, rel), { withFileTypes: true }).flatMap(e => {
    const name = rel ? rel + "/" + e.name : e.name;
    if (name === ".git") return [];
    return e.isDirectory() ? walk(root, name) : [name];
  });
  let refused = false;
  const frozenFile = path.join(exp, "FROZEN_RELEASES.json");
  if (fs.existsSync(frozenFile)) {
    const allowed = list("ALLOW_FROZEN_OVERWRITE");
    for (const [file, hash] of Object.entries(JSON.parse(fs.readFileSync(frozenFile, "utf8")))) {
      const m = path.join(mirror, file);
      if (!fs.existsSync(m)) continue;
      if (crypto.createHash("sha256").update(fs.readFileSync(m)).digest("hex") === hash) continue;
      if (allowed.has(file)) { console.error("Replacing published " + file + " (explicitly allowed)"); continue; }
      console.error("Mirror " + file + " differs from frozen hash " + hash.slice(0, 8) + "; set ALLOW_FROZEN_OVERWRITE to replace it");
      refused = true;
    }
  }
  const exported = new Set(walk(exp));
  const allowedDelete = list("ALLOW_REMOTE_DELETE");
  for (const file of walk(mirror)) {
    if (exported.has(file) || allowedDelete.has(file)) continue;
    console.error("Mirror-only file " + file + " would be removed; set ALLOW_REMOTE_DELETE to accept");
    refused = true;
  }
  process.exit(refused ? 1 : 0);
' "$work/export" "$work/mirror"

rsync -a --delete --exclude .git "$work/export/" "$work/mirror/"

cd "$work/mirror"
tag="v$version"
new_tag=true
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  new_tag=false
  changed=$(git diff --name-only "$tag" -- '*.schema.json'; git ls-files --others --exclude-standard -- '*.schema.json')
  if [ -n "$changed" ]; then
    echo "$tag already exists but these contracts differ from it; bump the version:" >&2
    echo "$changed" >&2
    exit 1
  fi
fi

git add -A
# The manifest names the source commit, so it changes on every pictos-net
# commit; the mirror is current when nothing else differs.
if git diff --cached --quiet -- . ':!EXPORT_MANIFEST.json'; then
  echo "$repo already matches $src at hspencer/pictos-net@$(echo "$sha" | cut -c1-7)"
  exit 0
fi
git diff --cached --stat | tail -15
$new_tag && echo "Will tag $tag" || echo "$tag exists with identical contracts; untagged commit, no new version"

if [ "$mode" != "--push" ]; then
  echo "Dry run. Re-run with --push to publish."
  exit 0
fi

short=$(echo "$sha" | cut -c1-7)
if $new_tag; then
  git commit -q -m "release: $tag from hspencer/pictos-net@$short

Committed snapshot of schemas/$product; file hashes in EXPORT_MANIFEST.json."
  git tag -a "$tag" -m "$tag from hspencer/pictos-net@$short"
  git push -q origin HEAD "$tag"
else
  git commit -q -m "chore: sync from hspencer/pictos-net@$short

Contracts (*.schema.json) unchanged since $tag, so no new version.
Changed files are listed in this commit; hashes in EXPORT_MANIFEST.json."
  git push -q origin HEAD
fi
echo "Published $repo ($tag)"
