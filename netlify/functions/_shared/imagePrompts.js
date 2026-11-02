/**
 * PRODUCIR (phase 3) prompt builders: the one source for browser and server
 * (individual, cascade, Vertex batch and full-pipeline batch). Pure, no I/O.
 *
 * Element ids are snake_case and the composition quotes them ('persona_que_pregunta').
 * Image models draw quoted identifiers as captions (benchmark 2026-11-01:
 * Gemini 2.5 Flash Image and Gemini 3 Pro Image labelled the scene with them),
 * so the image prompt gets plain words. The stored composition is untouched.
 */
const words = id => String(id).replace(/[_-]+/g, ' ').trim();

export function formatElements(els, depth = 0) {
  if (!Array.isArray(els)) return '';
  return els.map(el => {
    const kids = el.children?.length ? '\n' + formatElements(el.children, depth + 1) : '';
    return `${'  '.repeat(depth)}- ${words(el.id)}${kids}`;
  }).join('\n');
}

/** Composition prompt with every quoted id turned into plain words. */
export const plainComposition = prompt => String(prompt ?? '').replace(/'([^'\n]+)'/g, (_, id) => words(id));

function nluContext(nlu, label) {
  const g = nlu && typeof nlu === 'object' ? nlu.visual_guidelines : null;
  return g ? `\n${label}: ${g.focus_actor || ''} — ${g.action_core || ''} — ${g.object_core || ''}` : '';
}

export function composeGeminiImagePrompt(elements, prompt, utterance, nlu, config) {
  return [
    `AAC pictogram: "${utterance}"`,
    nluContext(nlu, 'Semantic context'),
    '',
    'Visual elements (hierarchy):',
    formatElements(elements),
    '',
    'Spatial composition:',
    plainComposition(prompt),
    '',
    config?.visualStylePrompt || 'Flat pictogram style, no text, simple vector design, white background.',
    '',
    'No text. No labels. No watermarks. White background. Flat design. Square format.',
  ].join('\n');
}

/** Recraft V4.1/V4 Styles accept up to 10000 characters; never truncated. */
export function composeRecraftPrompt(elements, prompt, utterance, nlu, config) {
  const isEs = (nlu?.lang || config?.lang || 'es-419').startsWith('es');
  const full = [
    isEs ? `Pictograma AAC: "${utterance}"` : `AAC Pictogram: "${utterance}"`,
    nluContext(nlu, isEs ? 'Contexto semántico' : 'Semantic context'),
    '',
    isEs ? 'Elementos (jerarquía visual):' : 'Elements (visual hierarchy):',
    formatElements(elements),
    '',
    isEs ? 'Composición espacial:' : 'Spatial composition:',
    plainComposition(prompt),
    '',
    config?.visualStylePrompt || (isEs ? 'Estilo pictograma plano, sin texto, diseño vectorial simple, fondo blanco.'
      : 'Flat pictogram style, no text, simple vector design, white background.'),
    '',
    isEs ? 'Sin texto. Sin etiquetas. Sin marcas de agua. Fondo blanco. Diseño plano.'
      : 'No text. No labels. No watermarks. White background. Flat design.',
  ].join('\n');
  if (full.length > 10000) throw new Error('Recraft prompt exceeds 10000 characters; shorten the composition explicitly.');
  return full;
}
