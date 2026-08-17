#!/usr/bin/env node
/**
 * Converts audio/webm clips in a library JSON to audio/mp4 (AAC),
 * trimming leading silence. Uses ffmpeg (must be in PATH).
 *
 * Usage:
 *   node scripts/convertLibraryAudio.cjs public/libraries/tablero_graph_2026-08-13.json
 */

const { execSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const libPath = process.argv[2];
if (!libPath) {
  console.error('Usage: node scripts/convertLibraryAudio.cjs <path/to/library.json>');
  process.exit(1);
}

const data = JSON.parse(fs.readFileSync(libPath, 'utf8'));
const rows = Array.isArray(data) ? data : (data.rows ?? []);

const webmRows = rows.filter(r => r.audio && r.audio.startsWith('data:audio/webm'));
console.log(`Found ${webmRows.length} webm audio clips in ${webmRows.length === 0 ? '—' : ''}`);
if (webmRows.length === 0) { console.log('Nothing to convert.'); process.exit(0); }

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pictos-audio-'));
let converted = 0, failed = 0;

for (const row of webmRows) {
  const label = row.UTTERANCE ?? row.id ?? '?';
  const inFile  = path.join(tmp, `in_${converted}.webm`);
  const outFile = path.join(tmp, `out_${converted}.m4a`);

  // Decode base64 → temp webm
  const comma = row.audio.indexOf(',');
  const b64 = row.audio.slice(comma + 1);
  fs.writeFileSync(inFile, Buffer.from(b64, 'base64'));

  try {
    // Convert: AAC 48 kbps mono, trim leading silence > -45 dB for > 50 ms
    execSync(
      `ffmpeg -y -i "${inFile}" -vn -ac 1 -c:a aac -b:a 48k ` +
      `-af "silenceremove=start_periods=1:start_duration=0.05:start_threshold=-45dB" ` +
      `"${outFile}" 2>/dev/null`,
      { stdio: 'pipe' }
    );

    const mp4b64 = fs.readFileSync(outFile).toString('base64');
    const originalSize = Math.round(b64.length * 3 / 4 / 1024);
    const newSize = Math.round(mp4b64.length * 3 / 4 / 1024);
    row.audio = `data:audio/mp4;base64,${mp4b64}`;
    converted++;
    console.log(`  ✓ ${label.padEnd(14)} ${originalSize} KB → ${newSize} KB`);
  } catch (err) {
    failed++;
    console.error(`  ✗ ${label}: ffmpeg failed — ${err.message.slice(0, 80)}`);
  }
}

fs.rmSync(tmp, { recursive: true });

if (converted > 0) {
  // Write back — preserve the original JSON structure
  if (Array.isArray(data)) {
    fs.writeFileSync(libPath, JSON.stringify(rows, null, 2));
  } else {
    data.rows = rows;
    fs.writeFileSync(libPath, JSON.stringify(data, null, 2));
  }
  console.log(`\nDone: ${converted} converted, ${failed} failed → ${libPath}`);
} else {
  console.log(`\nNo clips converted (${failed} failed).`);
}
