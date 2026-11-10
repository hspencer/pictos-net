// QuiverAI Arrow 2 PRODUCIR probe, 2026-11-10. Variants:
//  A base: current prompt builder only (style inside the prompt), API defaults.
//  B docs: style in `instructions`, fixed viewBox, temperature 0.4, reasoning_effort low.
//  C ref:  B with the PICTOS - Señalética style and two of its pictograms as style references.
// Run from repo root: node bench-quiver.mjs <compositions.json> A B C
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const key = fs.readFileSync(path.join(root, '.env'), 'utf8').match(/^QUIVER_API_KEY=(.*)$/m)[1].replace(/^["']|["']$/g, '');
const { composeGeminiImagePrompt } = await import(path.join(root, 'netlify/functions/_shared/imagePrompts.js'));
const AIGA = 'Pictograma vectorial plano, estilo señalética AIGA/DOT, silueta simplificada y contundente, abstracción media conservando los detalles concretos relevantes, grosor de trazo uniforme, contornos monolineales, colores planos y sólidos — sin degradados, sin sombras, sin texturas, sin elementos decorativos. Estética adulta y neutra, sobria y funcional. Formas geométricas limpias, silueta clara y legible, peso visual consistente en toda la serie.';
const lib = JSON.parse(fs.readFileSync(path.join(root, 'public/libraries/pictos-senaletica.json'), 'utf8'));
const SENAL = lib.config.visualStylePrompt;
const refs = [16, 22].map(i => ({ base64: lib.rows[i].bitmap.replace(/^data:[^,]+,/, '') }));
const CONSTRUCTION = 'Construction: an AAC communication-board pictogram read at 96 px. Filled shapes on a plain white background, centred, square 512x512 view box, generous padding. No text, letters, numbers or labels.';
const OUT = path.join(root, 'research/2026-11-10_quiver-arrow2');
const [compFile, ...want] = process.argv.slice(2);
const items = JSON.parse(fs.readFileSync(compFile, 'utf8'));
const viewBox = { minX: 0, minY: 0, width: 512, height: 512 };
const content = item => composeGeminiImagePrompt(item.composition.elements, item.composition.prompt, item.utterance, item.nlu, { visualStylePrompt: 'Pictogram.' });
const VARIANTS = {
  A: item => ({ model: 'arrow-2', prompt: composeGeminiImagePrompt(item.composition.elements, item.composition.prompt, item.utterance, item.nlu, { visualStylePrompt: AIGA }) }),
  B: item => ({ model: 'arrow-2', prompt: content(item), instructions: `${AIGA}\n\n${CONSTRUCTION}`, attributes: { viewBox }, temperature: 0.4, reasoning_effort: 'low' }),
  C: item => ({ model: 'arrow-2', prompt: content(item), references: refs,
    instructions: `${SENAL}\n\n${CONSTRUCTION}\n\nThe two reference images are pictograms from the same library: match their visual style (black silhouettes, stroke weight, head treatment, level of abstraction, negative space). Do not copy their subjects.`,
    attributes: { viewBox }, temperature: 0.4, reasoning_effort: 'low' }),
};
fs.mkdirSync(OUT, { recursive: true });
const logPath = path.join(OUT, 'attempts.jsonl');
const done = new Set((fs.existsSync(logPath) ? fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(JSON.parse) : []).filter(r => r.ok).map(r => r.variant + '/' + r.caseId));
const jobs = want.flatMap(v => items.map(item => ({ v, item }))).filter(j => !done.has(j.v + '/' + j.item.id));
if (jobs.length > 30) throw new Error('over call cap');
let next = 0;
async function worker() {
  while (next < jobs.length) {
    const { v, item } = jobs[next++];
    const body = VARIANTS[v](item);
    const row = { variant: v, caseId: item.id, utterance: item.utterance, promptChars: body.prompt.length };
    const t0 = Date.now();
    try {
      const r = await fetch('https://api.quiver.ai/v1/svgs/generations', {
        method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body), signal: AbortSignal.timeout(300000),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(`Quiver ${r.status}: ${JSON.stringify(d).slice(0, 240)}`);
      const svg = d.data?.[0]?.svg;
      if (!svg) throw new Error('no svg');
      const file = `${item.id}--arrow-2-${v}.svg`;
      fs.writeFileSync(path.join(OUT, file), svg);
      const u = d.usage ?? {};
      Object.assign(row, { ok: true, file, bytes: svg.length, viewBox: svg.match(/viewBox="([^"]+)"/)?.[1], usage: u,
        usd: ((u.input_tokens ?? 0) * 4 + (u.output_tokens ?? 0) * 20) / 1e6 });
    } catch (e) { Object.assign(row, { ok: false, error: e.message }); }
    row.ms = Date.now() - t0;
    fs.appendFileSync(path.join(OUT, 'attempts.jsonl'), JSON.stringify(row) + '\n');
    console.log(JSON.stringify({ v, c: row.caseId, ok: row.ok, ms: row.ms, usd: row.usd?.toFixed(3), vb: row.viewBox, err: row.error }));
  }
}
await Promise.all([1, 2, 3, 4].map(worker));
