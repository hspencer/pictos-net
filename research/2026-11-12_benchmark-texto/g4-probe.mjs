// Times one production COMPRENDER request (forced tool) on a Gemini model under thinking settings.
// Run from repo root: node --env-file=.env research/2026-11-12_benchmark-texto/g4-probe.mjs <model> none|MINIMAL|LOW ...
// Paid: one call per setting. 2026-11-12: Carbon 69.8 s (LOW), Argon 96.6 s (LOW); MINIMAL rejected.
import fs from 'node:fs';
import path from 'node:path';
const root = process.cwd();
const { getVertexAccessToken, vertexModelUrl } = await import(path.join(root, 'netlify/functions/_shared/vertex.js'));
const { buildNluRequest } = await import(path.join(root, 'netlify/functions/_shared/pipelineContracts.js'));
const { buildGeminiRequest } = await import(path.join(root, 'netlify/functions/_shared/geminiTranslate.js'));
const token = await getVertexAccessToken();
const cases = JSON.parse(fs.readFileSync('scripts/eval/cases/pipeline-es-419.json'));
const variants = { none: undefined, MINIMAL: { thinkingLevel: 'MINIMAL' }, LOW: { thinkingLevel: 'LOW' } };
const [model, ...want] = process.argv.slice(2);
await Promise.all(want.map(async v => {
  const req = buildNluRequest(cases.cases[0].utterance, { ...cases.config, comprenderModel: model });
  req.model = model; req.max_tokens = 4096;
  const body = buildGeminiRequest(req);
  if (variants[v]) body.generationConfig.thinkingConfig = variants[v]; else delete body.generationConfig.thinkingConfig;
  const t0 = Date.now();
  try {
    const r = await fetch(vertexModelUrl(model), { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(180000) });
    const d = await r.json();
    const parts = d.candidates?.[0]?.content?.parts ?? [];
    console.log(model, v, r.status, Date.now() - t0 + 'ms', JSON.stringify({ fn: parts.some(p => p.functionCall), finish: d.candidates?.[0]?.finishReason, u: d.usageMetadata && { in: d.usageMetadata.promptTokenCount, out: d.usageMetadata.candidatesTokenCount, th: d.usageMetadata.thoughtsTokenCount }, err: d.error?.message?.slice(0, 150) }));
  } catch (e) { console.log(model, v, 'ERR', Date.now() - t0 + 'ms', e.message); }
}));
