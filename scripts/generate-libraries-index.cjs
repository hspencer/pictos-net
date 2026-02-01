#!/usr/bin/env node

/**
 * Generate libraries index from public/libraries/*.json
 * This script creates an index.json file listing all available libraries with their metadata
 */

const fs = require('fs');
const path = require('path');

const LIBRARIES_DIR = path.join(__dirname, '..', 'public', 'libraries');
const INDEX_FILE = path.join(LIBRARIES_DIR, 'index.json');

async function generateIndex() {
  try {
    // Read all JSON files in libraries directory
    const files = fs.readdirSync(LIBRARIES_DIR)
      .filter(file => file.endsWith('.json') && file !== 'index.json');

    console.log(`📚 Found ${files.length} libraries`);

    // Extract metadata from each library
    const libraries = files.map(filename => {
      try {
        const filepath = path.join(LIBRARIES_DIR, filename);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

        const metadata = {
          filename,
          name: data.config?.author || filename.replace('.json', ''),
          location: data.config?.geoContext?.region || 'Unknown',
          language: data.config?.lang || 'es',
          items: data.rows?.length || 0,
          description: data.type || 'PictoNet library',
          filesize: fs.statSync(filepath).size
        };

        console.log(`  ✅ ${filename} - ${metadata.items} items (${metadata.name})`);
        return metadata;
      } catch (err) {
        console.error(`  ❌ Failed to process ${filename}:`, err.message);
        return null;
      }
    }).filter(Boolean);

    // Write index file
    const index = {
      generated: new Date().toISOString(),
      count: libraries.length,
      libraries
    };

    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
    console.log(`\n✅ Generated index.json with ${libraries.length} libraries`);

  } catch (err) {
    console.error('❌ Error generating libraries index:', err);
    process.exit(1);
  }
}

generateIndex();
