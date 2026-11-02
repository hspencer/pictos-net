#!/usr/bin/env node
/**
 * PRODUCIR (phase 3) benchmark: same prompt builders and provider adapters as
 * production, called directly with local credentials (no quota, no Netlify).
 * Input: a compositions file [{ id, utterance, nlu, composition: { elements, prompt } }],
 * normally exported from a phase 2 benchmark run. Images land in --out (inside research/).
 *
 *   node --env-file=.env scripts/eval/benchmark-images.mjs --compositions research/x.json \
 *     --models gemini-2.5-flash-image,gpt-image-2 --max-calls 40 --out research/images-run
 *
 * Paid. Every model runs its cases sequentially; models run in parallel.
 * Cost is the catalog's flat per-image price (prompt tokens excluded).
 */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { MODEL_CATALOG, getModelProvider, modelSupportsPhase } from '../../netlify/functions/_shared/modelCatalog.js';
import { composeGeminiImagePrompt, composeRecraftPrompt } from '../../netlify/functions/_shared/pipelineRunner.js';
import { generateRecraftImage } from '../../netlify/functions/_shared/recraftImage.js';
import { generateOpenAIImage } from '../../netlify/functions/_shared/openaiImage.js';
import { getVertexAccessToken, vertexModelUrl } from '../../netlify/functions/_shared/vertex.js';
import { fetchWithRetry } from '../../netlify/functions/_shared/httpRetry.js';

// Default library style for es-419 (App.tsx DEFAULT_STYLE_PROMPTS).
const STYLE = 'Pictograma vectorial plano, estilo señalética AIGA/DOT, silueta simplificada y contundente, abstracción media conservando los detalles concretos relevantes, grosor de trazo uniforme, contornos monolineales, colores planos y sólidos — sin degradados, sin sombras, sin texturas, sin elementos decorativos. Estética adulta y neutra, sobria y funcional. Formas geométricas limpias, silueta clara y legible, peso visual consistente en toda la serie.';

/** Same request as api-gemini-worker-background.js. */
async function geminiImage(model, prompt) {
  const res = await fetchWithRetry(vertexModelUrl(model), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await getVertexAccessToken()}` },
    body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE'], imageConfig: { aspectRatio: '1:1', imageSize: '1K' } } }),
  }, { retries: 4, baseDelayMs: 2000, retryOn429: true, maxTotalMs: 90000 });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(`Gemini ${res.status}: ${data.error?.status ?? ''}`), { status: res.status });
  const candidate = data.candidates?.[0];
  const part = candidate?.content?.parts?.find(p => p.inlineData?.mimeType?.startsWith('image/'));
  if (!part) throw Object.assign(new Error(`no image (finishReason=${candidate?.finishReason ?? 'none'}, block=${data.promptFeedback?.blockReason ?? 'none'})`), { noImage: true });
  return { bitmap: `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`, usage: data.usageMetadata };
}

async function generate(model, item) {
  const { elements, prompt } = item.composition;
  const config = { visualStylePrompt: STYLE };
  const provider = getModelProvider(model);
  if (provider === 'recraft') return generateRecraftImage({ model, prompt: composeRecraftPrompt(elements, prompt, item.utterance, item.nlu, config) });
  const full = composeGeminiImagePrompt(elements, prompt, item.utterance, item.nlu, config);
  if (provider === 'openai') return generateOpenAIImage({ model, prompt: full, quality: 'low' });
  return geminiImage(model, full);
}

async function main() {
  const { values } = parseArgs({ options: { compositions: { type: 'string' }, models: { type: 'string' }, 'max-calls': { type: 'string' }, out: { type: 'string' } } });
  const items = JSON.parse(fs.readFileSync(values.compositions, 'utf8'));
  const models = values.models.split(',');
  const maxCalls = Number(values['max-calls']);
  const research = fs.realpathSync('research');
  const out = path.resolve(values.out);
  if (!out.startsWith(research + path.sep) || !Number.isInteger(maxCalls) || maxCalls < 1) throw new Error('--out inside research/ and --max-calls N required');
  if (models.some(m => !modelSupportsPhase(m, 3))) throw new Error('Every model must be admitted for phase 3');
  if (items.length * models.length > maxCalls) throw new Error(`Plan needs ${items.length * models.length} calls, over --max-calls`);
  fs.mkdirSync(out, { recursive: true });
  const log = path.join(out, 'attempts.jsonl');
  const results = (await Promise.all(models.map(async model => {
    const rows = [];
    for (const item of items) {
      const started = Date.now();
      const row = { model, caseId: item.id, utterance: item.utterance };
      try {
        const result = await generate(model, item);
        row.ms = Date.now() - started;
        const file = `${item.id}--${model}.${result.svg ? 'svg' : 'png'}`;
        fs.writeFileSync(path.join(out, file), result.svg ?? Buffer.from(result.bitmap.split(',')[1], 'base64'));
        Object.assign(row, { ok: true, file, usd: MODEL_CATALOG[model].pricing.imageUsd, usage: result.usage ?? null });
      } catch (error) {
        Object.assign(row, { ms: Date.now() - started, ok: false, error: error.message, noImage: !!error.noImage });
      }
      fs.appendFileSync(log, JSON.stringify(row) + '\n');
      console.log(JSON.stringify({ model: row.model, caseId: row.caseId, ok: row.ok, ms: row.ms, error: row.error }));
      rows.push(row);
    }
    return rows;
  }))).flat();
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify({ at: new Date().toISOString(), style: STYLE, results }, null, 2));
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
