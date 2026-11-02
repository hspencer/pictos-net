#!/usr/bin/env node
/** Summarize benchmark run directories (attempts.jsonl) into one row per model.
 *   node scripts/eval/summarize-benchmark.mjs research/bench-p1-es-* [--json]
 * Text runs (benchmark-models.mjs) and image runs (benchmark-images.mjs) are both read. */
import fs from 'node:fs';
import path from 'node:path';

const quantile = (values, q) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))];
};
const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

export function summarize(attempts) {
  const byModel = new Map();
  for (const a of attempts) {
    const model = a.requestedModel ?? a.model;
    if (!byModel.has(model)) byModel.set(model, []);
    byModel.get(model).push(a);
  }
  return [...byModel].map(([model, rows]) => {
    const text = rows[0].requestedModel !== undefined;
    const ok = rows.filter(r => text ? r.canonicalValid : r.ok);
    const cost = rows.map(r => text ? r.estimatedCostUsd : (r.ok ? r.usd : 0)).filter(Number.isFinite);
    const input = rows.reduce((n, r) => n + (r.inputTokens ?? 0), 0);
    return {
      model, n: rows.length, validPct: 100 * ok.length / rows.length,
      ...(text ? {
        firstCallValidPct: 100 * rows.filter(r => r.firstCallValid).length / rows.length,
        callsPerCase: mean(rows.map(r => r.providerCalls ?? 1)),
        cacheReadPct: input ? 100 * rows.reduce((n, r) => n + (r.cacheReadTokens ?? 0), 0) / input : 0,
        outputTokens: mean(rows.map(r => r.outputTokens).filter(Number.isFinite)),
        failures: rows.filter(r => !r.canonicalValid).map(r => `${r.caseId}: ${(r.failure ?? '').slice(0, 140)}`),
      } : { failures: rows.filter(r => !r.ok).map(r => `${r.caseId}: ${r.error}`) }),
      p50Ms: quantile(rows.map(r => r.milliseconds ?? r.ms), 0.5), p95Ms: quantile(rows.map(r => r.milliseconds ?? r.ms), 0.95),
      meanUsd: mean(cost), totalUsd: cost.reduce((a, b) => a + b, 0),
      usdPerValid: ok.length ? cost.reduce((a, b) => a + b, 0) / ok.length : null,
    };
  });
}

if (import.meta.url === `file://${path.resolve(process.argv[1])}`) {
  const dirs = process.argv.slice(2).filter(arg => !arg.startsWith('--'));
  const attempts = dirs.flatMap(dir => fs.readFileSync(path.join(dir, 'attempts.jsonl'), 'utf8').trim().split('\n')
    .map(line => JSON.parse(line)).filter(row => row.state === 'recorded' || row.state === undefined));
  const rows = summarize(attempts).sort((a, b) => b.validPct - a.validPct || a.meanUsd - b.meanUsd);
  if (process.argv.includes('--json')) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }
  const f = (v, d = 1) => v == null ? '–' : v.toFixed(d);
  console.log('| Modelo | n | Válido % | 1.er intento % | Llamadas/caso | p50 s | p95 s | US$/caso | US$ total | Caché leída % |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const r of rows) console.log(`| ${r.model} | ${r.n} | ${f(r.validPct, 0)} | ${f(r.firstCallValidPct, 0)} | ${f(r.callsPerCase, 2)} | ${f(r.p50Ms / 1000)} | ${f(r.p95Ms / 1000)} | ${f(r.meanUsd, 5)} | ${f(r.totalUsd, 3)} | ${f(r.cacheReadPct, 0)} |`);
  for (const r of rows) if (r.failures.length) console.log(`\n${r.model}:\n  ${r.failures.join('\n  ')}`);
}
