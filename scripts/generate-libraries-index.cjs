#!/usr/bin/env node

/**
 * Generate libraries index from public/libraries/*.json
 * This script creates an index.json file listing all available libraries with their metadata.
 *
 * Thumbnails are written as proper JPEG regardless of source format. Gemini generates PNG
 * bitmaps; without explicit conversion they would be saved with a .jpg extension and served
 * from Netlify with Content-Type: image/jpeg, which breaks browsers that validate the
 * content-type header (Safari on older iOS without WebP support).
 */

const fs = require('fs');
const path = require('path');
let sharp;
try { sharp = require('sharp'); } catch { sharp = null; }

const LIBRARIES_DIR = path.join(__dirname, '..', 'public', 'libraries');
const THUMBS_DIR = path.join(LIBRARIES_DIR, 'thumbs');
const INDEX_FILE = path.join(LIBRARIES_DIR, 'index.json');
const THUMBS_PER_LIBRARY = 3;

/**
 * Write a bitmap data URL to disk as a proper JPEG file.
 * If the bitmap is already JPEG, writes directly. If it's PNG (Gemini output),
 * converts to JPEG via sharp before writing so the file format matches the extension.
 */
async function writeThumbnailJpeg(dataUrl, outPath) {
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  const buf = Buffer.from(base64, 'base64');
  const isJpeg = dataUrl.startsWith('data:image/jpeg');

  if (isJpeg || !sharp) {
    fs.writeFileSync(outPath, buf);
  } else {
    // PNG (or other format) → JPEG conversion
    await sharp(buf).jpeg({ quality: 85 }).toFile(outPath);
  }
}

async function generateThumbs(filename, data) {
  const slug = filename.replace(/(_graph.*)?\.json$/, '');
  const srcMtime = fs.statSync(path.join(LIBRARIES_DIR, filename)).mtimeMs;
  const existing = Array.from({ length: THUMBS_PER_LIBRARY }, (_, i) =>
    path.join(THUMBS_DIR, `${slug}_${i}.jpg`)
  );

  // Regenerate when a thumbnail is missing OR older than the library file (stale).
  if (existing.every(f => fs.existsSync(f) && fs.statSync(f).mtimeMs >= srcMtime)) return;

  const withBitmap = (data.rows || []).filter(r => r.bitmap);
  if (withBitmap.length === 0) return;

  fs.mkdirSync(THUMBS_DIR, { recursive: true });

  const indices = withBitmap.length < THUMBS_PER_LIBRARY
    ? withBitmap.map((_, i) => i)
    : [0, Math.floor(withBitmap.length / 2), withBitmap.length - 1];

  await Promise.all(indices.map(async (rowIdx, i) => {
    const outPath = path.join(THUMBS_DIR, `${slug}_${i}.jpg`);
    await writeThumbnailJpeg(withBitmap[rowIdx].bitmap, outPath);
  }));

  console.log(`  Generated ${indices.length} thumbnails for ${slug}`);
}

async function generateIndex() {
  try {
    const files = fs.readdirSync(LIBRARIES_DIR)
      .filter(file => file.endsWith('.json') && file !== 'index.json');

    console.log(`Found ${files.length} libraries`);

    const libraries = [];
    for (const filename of files) {
      try {
        const filepath = path.join(LIBRARIES_DIR, filename);
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));

        await generateThumbs(filename, data);

        const metadata = {
          filename,
          name: data.config?.name || data.config?.author || filename.replace('.json', ''),
          location: data.config?.geoContext?.region || 'Unknown',
          language: data.config?.lang || 'es',
          items: data.rows?.length || 0,
          credits: data.config?.credits || undefined,
          description: data.type || 'PictoNet library',
          filesize: fs.statSync(filepath).size
        };

        console.log(`  OK ${filename} - ${metadata.items} items (${metadata.name})`);
        libraries.push(metadata);
      } catch (err) {
        console.error(`  FAILED ${filename}: ${err.message}`);
      }
    }

    const index = {
      generated: new Date().toISOString(),
      count: libraries.length,
      libraries
    };

    fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
    console.log(`\nGenerated index.json with ${libraries.length} libraries`);

  } catch (err) {
    console.error('Error generating libraries index:', err);
    process.exit(1);
  }
}

generateIndex();
