/**
 * Entity detection before ESTRUCTURAR: one Gemini call returns a box per
 * composition entity that is actually drawn, and omits the ones that are not.
 * Pure request builder and parser, shared by api-gemini-detect and tests.
 * Benchmark 2026-11-07 (research/2026-11-07_segmentacion-semantica): 90 % of
 * entities found in ~3 s, ~US$0.002 per pictogram; masks were dropped because
 * the answer overflows 8k tokens.
 */

export const MAX_LABELS = 40;

/** Gemini generateContent body for one bitmap and its entity ids. */
export function buildDetectionRequest({ utterance, labels, mimeType, base64 }) {
  const text = `This is a pictogram for "${String(utterance).trim()}". Find exactly these entities, using each name verbatim as "label": ${labels.join(', ')}.
Output a JSON list; each entry has the tight 2D bounding box in "box_2d" ([y0, x0, y1, x1], normalized 0-1000) and "label". An entity drawn as separate parts may have one entry per part. If an entity is not drawn, omit it.`;
  return {
    contents: [{ role: 'user', parts: [{ inlineData: { mimeType, data: base64 } }, { text }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 4096, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } },
  };
}

/**
 * Detections from a Gemini response: { label, box: [x, y, w, h] } with the box
 * normalized to 0..1. Unknown labels and malformed boxes are dropped. An
 * unreadable answer returns null, not [], because [] means "nothing is drawn"
 * and would deny every entity its regions.
 */
export function parseDetections(geminiData, labels) {
  const text = (geminiData?.candidates?.[0]?.content?.parts ?? []).map(p => p.text ?? '').join('').trim()
    .replace(/^```(?:json)?\s*|\s*```$/g, '');
  let items;
  try { items = JSON.parse(text); } catch { return null; }
  if (!Array.isArray(items)) return null;
  const known = new Set(labels);
  const clamp = v => Math.min(1, Math.max(0, v / 1000));
  return items.flatMap(it => {
    const b = it?.box_2d;
    if (!known.has(it?.label) || !Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite)) return [];
    const [y0, x0, y1, x1] = b.map(clamp);
    if (x1 <= x0 || y1 <= y0) return [];
    return [{ label: it.label, box: [x0, y0, x1 - x0, y1 - y0] }];
  });
}
