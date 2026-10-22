#!/bin/sh
set -eu
# Copy only public schema contracts from canonical local product directories
# This script is run as part of the build process

echo "Copying schema data to public directory..."

# Create directories
mkdir -p public/schemas/ICAP/data
mkdir -p public/schemas/pictos-nlu-schema
mkdir -p public/schemas/pictos-svg-schema
mkdir -p public/schemas/pictos-composition-schema
mkdir -p public/schemas/pictos-api-schema
mkdir -p public/libraries

# Never copy product tests, corpus, package files or local credentials.
for product in pictos-nlu-schema pictos-composition-schema pictos-svg-schema pictos-api-schema; do
    source="schemas/$product"
    if [ -L "$source" ]; then
        echo "Refusing symlink schema product: $source" >&2
        exit 1
    fi
    for schema in "$source"/*.schema.json; do
        [ -e "$schema" ] || continue
        if [ -L "$schema" ] || [ ! -f "$schema" ]; then
            echo "Refusing non-regular schema: $schema" >&2
            exit 1
        fi
        cp "$schema" "public/schemas/$product/"
    done
done

# The frozen SVG 1.0 contract keeps its historical nested URL,
# /schemas/mf-svg-schema/schemas/metadata.schema.json, which predates the
# product rename and must not move. Its examples, Python validator, styles and
# other product files are not public contract copies.
legacy_svg_schema="schemas/pictos-svg-schema/schemas/metadata.schema.json"
if [ -e "$legacy_svg_schema" ]; then
    if [ -L "schemas/pictos-svg-schema/schemas" ] || [ -L "$legacy_svg_schema" ] || [ ! -f "$legacy_svg_schema" ]; then
        echo "Refusing non-regular legacy SVG schema: $legacy_svg_schema" >&2
        exit 1
    fi
    mkdir -p public/schemas/mf-svg-schema/schemas
    cp "$legacy_svg_schema" public/schemas/mf-svg-schema/schemas/
fi

# Each schema must also be served at the URL its frozen $id declares, which for
# NLU, composition and MF-SVG is /schemas/<file>, not /schemas/<product>/<file>.
# Only pictos.net ids under /schemas/ are honoured; anything else is refused.
node -e '
const fs = require("fs"), path = require("path");
const root = path.resolve("public");
for (const product of ["pictos-nlu-schema", "pictos-composition-schema", "pictos-svg-schema", "pictos-api-schema"]) {
  const dir = path.join("public/schemas", product);
  if (!fs.existsSync(dir)) continue;
  for (const name of fs.readdirSync(dir).filter(n => n.endsWith(".schema.json"))) {
    const src = path.join(dir, name);
    const id = JSON.parse(fs.readFileSync(src, "utf8")).$id;
    if (!id) continue;
    const url = new URL(id);
    if (url.hostname !== "pictos.net" || !url.pathname.startsWith("/schemas/")) continue;
    const dest = path.resolve(root, "." + url.pathname);
    if (!dest.startsWith(root + path.sep)) { console.error("Refusing schema $id outside public/: " + id); process.exit(1); }
    if (dest === path.resolve(src)) continue;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}
'

# Copy ICAP data (evaluation rubric) - optional, app works without it
if [ -f "schemas/ICAP/data/rubric-scale-descriptions.json" ]; then
    cp schemas/ICAP/data/rubric-scale-descriptions.json public/schemas/ICAP/data/
    echo "ICAP rubric descriptions copied"
fi

# Generate libraries index
if [ -d "public/libraries" ]; then
    node scripts/generate-libraries-index.cjs
fi

echo "Schema data copy complete"
