#!/bin/sh
set -eu
# Copy only public schema contracts from canonical local product directories
# This script is run as part of the build process

echo "Copying schema data to public directory..."

# Create directories
mkdir -p public/schemas/ICAP/data
mkdir -p public/schemas/nlu-schema
mkdir -p public/schemas/mf-svg-schema
mkdir -p public/schemas/pictogram-composition-schema
mkdir -p public/libraries

# Never copy product tests, corpus, package files or local credentials.
for product in nlu-schema pictogram-composition-schema mf-svg-schema; do
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

# The frozen SVG 1.0 contract keeps its historical nested URL. Its examples,
# Python validator, styles and other product files are not public contract copies.
legacy_svg_schema="schemas/mf-svg-schema/schemas/metadata.schema.json"
if [ -e "$legacy_svg_schema" ]; then
    if [ -L "schemas/mf-svg-schema/schemas" ] || [ -L "$legacy_svg_schema" ] || [ ! -f "$legacy_svg_schema" ]; then
        echo "Refusing non-regular legacy SVG schema: $legacy_svg_schema" >&2
        exit 1
    fi
    mkdir -p public/schemas/mf-svg-schema/schemas
    cp "$legacy_svg_schema" public/schemas/mf-svg-schema/schemas/
fi

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
