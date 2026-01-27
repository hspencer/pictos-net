#!/bin/bash
# Copy necessary files from submodules to public directory for build
# This script is run as part of the build process

echo "📦 Copying submodule data to public directory..."

# Create directories
mkdir -p public/schemas/VCSCI/data
mkdir -p public/schemas/nlu-schema
mkdir -p public/schemas/mf-svg-schema

# Copy VCSCI data
if [ -f "schemas/VCSCI/data/rubric-scale-descriptions.json" ]; then
    cp schemas/VCSCI/data/rubric-scale-descriptions.json public/schemas/VCSCI/data/
    echo "✅ VCSCI rubric descriptions copied"
else
    echo "⚠️  VCSCI rubric file not found. Run: git submodule update --init --recursive"
fi

# Copy NLU schema (if needed in the future)
# cp schemas/nlu-schema/schema.json public/schemas/nlu-schema/

# Copy SVG schema (when implemented)
# cp schemas/mf-svg-schema/schema.json public/schemas/mf-svg-schema/

echo "✅ Submodule data copy complete"
