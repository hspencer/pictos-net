// Lists Google publisher models on Vertex (Gemini/Gemma). Listed is not callable: probe before trusting.
// Run from repo root: node --env-file=.env research/2026-11-12_benchmark-texto/vertex-models.mjs
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
for (const line of fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')) {
  const m = line.match(/^([A-Z_]+)=(.*)$/); if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { getVertexAccessToken } = await import(path.join(root, 'netlify/functions/_shared/vertex.js'));
const token = await getVertexAccessToken();
const out = []; let pageToken = '';
do {
  const r = await fetch(`https://aiplatform.googleapis.com/v1beta1/publishers/google/models?pageSize=200${pageToken ? '&pageToken=' + pageToken : ''}`, { headers: { Authorization: `Bearer ${token}`, 'x-goog-user-project': process.env.VERTEX_PROJECT_ID } });
  const d = await r.json();
  if (!r.ok) { console.log('HTTP', r.status, JSON.stringify(d).slice(0, 300)); break; }
  out.push(...(d.publisherModels ?? [])); pageToken = d.nextPageToken ?? '';
} while (pageToken);
const names = out.map(m => m.name.split('/').pop() + (m.launchStage ? ' [' + m.launchStage + ']' : '')).filter(n => /gemini|gemma/i.test(n)).sort();
console.log(out.length, 'models;', names.length, 'gemini/gemma'); console.log(names.join('\n'));
