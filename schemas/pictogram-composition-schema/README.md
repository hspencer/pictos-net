# Pictogram Composition Schema · 0.1.0

Canonical development lives inside `mediafranca/pictos-net`, at
`schemas/pictogram-composition-schema`. This product describes the transition from
communicative semantic analysis to a visual composition independently of the
image provider. It does not describe SVG restructuring (Phase 5).

## Two contracts

- **Provider output:** `pictogram-composition-provider-0.1.0.schema.json` contains
  `{elements, prompt}`. `elements` is a nonempty recursive list of semantic children;
  every node has `id`, a concept (`Agent`, `Action`, `Object`, `Context`, `Element`)
  and optionally `children`. Unknown fields are rejected at every depth.
- **Accepted artifact:** `pictogram-composition-0.1.0.schema.json` has the same outer
  fields but exactly one deterministic local root: `pictograma` for Spanish or
  `pictogram` otherwise, concept `Root`, with the validated provider children.

IDs must be unique across the tree, nonempty and contain neither whitespace nor
single quotes. Root IDs are reserved. The spatial prompt references every semantic
ID in single quotes and must not invent quoted references. Root insertion does not
require the provider to mention the synthetic root. Validation never drops broken
nodes, invents `unknown`, guesses concepts, trims away evidence or replays a paid
call. Schema checks and these relational checks both need to pass.

The canonical tree is recursive. Provider tool schemas are a projection generated
by PictoNet, currently bounded to six semantic levels; the last level cannot have
children. This provider constraint is not the full schema or a claim of geometric
accuracy. Provider-specific prompt rendering happens later in Phase 3.

## Standalone use (Node 22+)

```sh
npm ci --ignore-scripts
npm test
```

```js
import { validateProvider, validateDocument } from '@mediafranca/pictogram-composition-schema';
const candidate = {
  elements: [{ id: 'persona', concept: 'Agent' }, { id: 'vaso', concept: 'Object' }],
  prompt: "'persona' sostiene 'vaso'."
};
const valid = validateProvider(candidate);
```

`validateElementTree(elements)` validates the existing rooted tree when only its
spatial prompt is being replaced; it neither requires nor fabricates a temporary
prompt. PictoNet sends the complete NLU and that unchanged tree through a forced
`regenerate_spatial_prompt` tool. It accepts the replacement only if the complete
composition remains valid. Empty prompts, missing or invented references and
malformed trees fail explicitly, without automatic paid retries. Accepted
execution evidence identifies `spatial-regeneration-0.1.0` separately from a full
composition request.

Ajv validators are compiled ahead of time into static ESM (`validators.js`) and do
not coerce types or insert defaults. Runtime imports require no `eval` or
`new Function`, preserving strict browser CSP. Run `npm run build:validators`
after changing a contract; `npm test` rejects stale generated validators.
Strict JSON and reference validity do not establish semantic fidelity,
accessibility, user acceptance, consent or permission to train a model.

## Evolution and research

Version 0.1.0 formalizes the present tree and spatial prompt without inventing
historical evidence. Structured spatial relations, semantic-origin links into
NLU, coordinates and explicit human review criteria are future versioned work.
Keep old artifacts and their actual provenance; never backfill today's schema or
configuration as if it had generated historical data.

## Publication and license

This package is intentionally `private: true` and `UNLICENSED` pending an explicit
license and publication decision. No rights over its code or documentation are
assumed from the NLU product. Product licensing will not grant rights over any
corpus, communicative utterance, participant information or image.
