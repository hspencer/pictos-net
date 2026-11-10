// F4 task 2: one real SVG per Recraft vector variant and synthetic utterance,
// checked by the same admission ESTRUCTURAR applies. Authorized 2026-10-22:
// 3 utterances x 4 variants (about US$2.30). Hard cap: 12 Recraft calls.
// Synthetic utterances only; no personal data.
import fs from 'node:fs';
import path from 'node:path';

for (const line of fs.readFileSync(new URL('../../.env', import.meta.url), 'utf8').split('\n')) {
  const m = /^(PICTOS_ANTHROPIC_KEY|RECRAFT_API_KEY)=(.*)$/.exec(line);
  if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}
const { runPhase1, runPhase2 } = await import('../../netlify/functions/_shared/pipelineRunner.js');
const { generateRecraftImage } = await import('../../netlify/functions/_shared/recraftImage.js');
const { inspectPassiveSVG, parseSVG } = await import('../../schemas/pictos-svg-schema/index.js');
const { canStructureSVG } = await import('../../services/svgCanonical.ts').catch(() => ({}));

const UTTERANCES = ['Quiero un vaso de agua', 'Me duele la cabeza', 'Vamos al parque'];
const VARIANTS = ['recraftv4_1_vector', 'recraftv4_1_utility_vector', 'recraftv4_1_pro_vector', 'recraftv4_1_utility_pro_vector'];
const MAX_RECRAFT_CALLS = 12;
const config = { lang: 'es-419', comprenderModel: 'claude-haiku-4-5-20251001', componerModel: 'claude-haiku-4-5-20251001' };

// Same as services/recraftService.ts normalizeSvgDimensions (private there).
const normalizeSvgDimensions = svg => svg.replace(/(<svg\b)([\s\S]*?)>/, (_m, tagStart, attrs) => {
  const hasViewBox = /viewBox\s*=/.test(attrs);
  const wm = attrs.match(/\bwidth\s*=\s*["']([0-9.]+)/);
  const hm = attrs.match(/\bheight\s*=\s*["']([0-9.]+)/);
  let out = attrs;
  if (!hasViewBox && wm && hm) out = ` viewBox="0 0 ${wm[1]} ${hm[1]}"` + out;
  out = out.replace(/\s+width\s*=\s*["'][^"']*["']/g, '').replace(/\s+height\s*=\s*["'][^"']*["']/g, '');
  return `${tagStart}${out}>`;
});
// Same composition as services/recraftService.ts for es-419.
const formatElements = (els, depth = 0) => els.map(el => `${'  '.repeat(depth)}- ${el.id}${el.children?.length ? '\n' + formatElements(el.children, depth + 1) : ''}`).join('\n');
const recraftPrompt = (utterance, nlu, composition) => [
  `Pictograma AAC: "${utterance}"`,
  nlu?.visual_guidelines ? `\nNLU context: ${nlu.visual_guidelines.focus_actor || ''} — ${nlu.visual_guidelines.action_core || ''} — ${nlu.visual_guidelines.object_core || ''}` : '',
  '', 'Elementos (jerarquía visual):', formatElements(composition.elements), '',
  'Composición espacial:', composition.prompt, '',
  'Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.', '',
  'Sin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.',
].join('\n');

const out = path.dirname(new URL(import.meta.url).pathname);
const results = [];
let recraftCalls = 0;
for (const [u, utterance] of UTTERANCES.entries()) {
  const nlu = await runPhase1(utterance, config);
  const composition = await runPhase2(nlu, config);
  fs.writeFileSync(path.join(out, `u${u}-composition.json`), JSON.stringify({ utterance, composition }, null, 2));
  for (const model of VARIANTS) {
    if (++recraftCalls > MAX_RECRAFT_CALLS) throw new Error('Recraft call cap reached');
    const started = Date.now();
    const entry = { utterance: u, model, ms: null };
    try {
      const { svg: raw } = await generateRecraftImage({ model, prompt: recraftPrompt(utterance, nlu, composition) });
      const svg = normalizeSvgDimensions(raw);
      entry.ms = Date.now() - started;
      entry.bytes = svg.length;
      fs.writeFileSync(path.join(out, `u${u}-${model}.svg`), svg);
      const elements = {};
      for (const node of Array.from(parseSVG(svg).getElementsByTagName('*'))) elements[node.localName] = (elements[node.localName] ?? 0) + 1;
      entry.elements = elements;
      try { inspectPassiveSVG(svg); entry.admitted = true; }
      catch (err) { entry.admitted = false; entry.construct = err.construct ?? null; entry.rule = err.message.replace(/ \(.*\)$/, ''); }
      if (canStructureSVG) {
        const eligibility = canStructureSVG({ rawSvg: svg, elements: composition.elements });
        entry.eligible = eligibility.eligible;
        if (!eligibility.eligible) entry.reasonKey = eligibility.reasonKey;
      }
    } catch (err) {
      entry.ms = Date.now() - started;
      entry.error = err.message;
    }
    results.push(entry);
    console.log(JSON.stringify(entry));
  }
}
fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), recraftCalls, results }, null, 2));
