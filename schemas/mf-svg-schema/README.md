# MediaFranca semantic SVG schema — 2.0.0-draft.1

This product defines a portable, self-contained SVG revision for AAC pictograms.
Its canonical development source is `schemas/mf-svg-schema` inside PictoNet.
The independent repository is an export of that source, not an upstream copy
that overwrites empirical work in the platform. Publication remains approval gated.

## What is implemented

The draft embeds the complete NLU generation profile 1.1.0 and composition
artifact 0.1.0, including the spatial prompt, in one metadata block. It preserves
these documents rather than rewriting them into a second lossy semantic model.
A valid SVG records its actual revision operation/time, geometry bindings and
known provenance. Unknown origin, model, licence or human review is not invented.

`metadata-2.0.0-draft.1.schema.json` contains both canonical contracts in `$defs`.
`scripts/sync-contracts.js --check` compares those definitions with the canonical
sibling products during PictoNet development. Standalone validation never fetches
those definitions from another checkout or the network.

Every composition element except the synthetic Root must have either a real
SVG group binding or an explicitly supplied implicit Action binding whose
`performedBy` points to an explicitly bound element. This draft deliberately
uses a stricter complete-binding profile: a missing group does not imply an
implicit action. The current platform does not offer an implicit-binding editor.
Unassigned geometry cannot silently become a Context concept.

The validator checks XML syntax, duplicate JSON keys, the complete metadata
contract, unique IDs, semantic bindings, ARIA references, accessible-text agreement,
language, positive finite viewBox dimensions and self-contained resources. It
rejects DTDs, processing instructions, active SVG elements, event handlers and
external resources. This is a conservative structural profile, not a general
SVG sanitizer and not proof of semantic correctness, cognitive accessibility,
visual fidelity or training rights.

## Validate independently

Requires Node 22 or later.

```sh
npm ci --ignore-scripts
npm test
npm run validate -- examples/v2example.svg
```

Runtime validation uses generated ESM functions. No `eval` or `new Function` is
required in the browser, and the platform's Content Security Policy is unchanged.
Tests check that generated validators still correspond to the packaged contracts.

```js
import { validateSVG, createSvgReference, verifySvgReference } from '@mediafranca/mf-svg-schema';
const result = validateSVG(svg);
const reference = await createSvgReference(svg); // validates first
const matches = await verifySvgReference(svg, reference);
```

A reference holds the SHA-256 of the **exact final UTF-8 SVG bytes**, byte length,
profile and revision ID. It lives outside the hashed SVG to avoid self-reference.
Imported references remain claims until verification; a hash is not a signature
or proof of authorship. Changes in whitespace alone change the byte hash.

## Platform promotion

Assembly and redraw validate semantic inputs before a paid model request and
validate final SVG bytes after post-processing. Invalid produced candidates are
retained as `structuredSvgDraft`, separately from the previous canonical asset.
Manual edits require validation, create a new unreviewed revision and reference
the actual previous canonical byte hash. Invalid edits remain drafts.

Promotion compares the captured workspace inputs and previous SVG with current
state. A late completion cannot replace an SVG produced after it or attach old
mapping results to newly edited semantic inputs. The SVG library mirror is updated
only after the row accepts the revision and its byte reference verifies.

Provenance includes only observed execution identifiers, provider/model,
contract/prompt/input/output hashes and optional request IDs. Original request
snapshots, complete provider prompts and arbitrary logs are not embedded
implicitly. Complete NLU and composition can themselves contain personal data;
review rights and privacy before sharing an SVG.

The UI may apply the current stylesheet to its preview. That display projection
is not the canonical revision: downloads and the byte reference use the stored
SVG. To change canonical styling, save and validate a new revision.

## Historical compatibility

The original `schemas/metadata.schema.json`, `examples/canonical.svg` and LICENSE
are byte-frozen in `FROZEN_RELEASES.json`. Their historical content is not relabelled
as v2. The duplicate `lib/mf-schema` directory in PictoNet is a legacy snapshot;
new development and schema aliases point here.

The Python CLI remains available for the historical profile:

```sh
python3 -m pip install -r requirements.txt
python3 tools/validator.py examples/canonical.svg
python3 tools/validator.py examples/v2example.svg
```

Missing Python dependencies or schema files fail closed for historical validation.
For v2, that CLI delegates to the same Node validator, and fails if Node or the
packaged implementation is unavailable. There is no second approximate v2 validator.
Historical files do not migrate automatically; regenerate or explicitly correct
invalid semantics while preserving their originals.

The files under `docs/` describe the historical profile and are not the normative
v2 contract. In particular, historical statements about guaranteed accessibility
or complete model reasoning are not claims established by structural validation.
The SVG contains observable artifacts and supplied evidence, not hidden reasoning.

## Licence and research status

The existing CC BY 4.0 LICENSE is unchanged. Package publication and any change of
licence require separate approval. This licence does not grant training rights over
participant data, library contents or provider images by implication. This package
is private until publication is authorized; v2 is a draft, not a stable release.

Immutable attempt archives, reviewed migrations, explicit rights/withdrawal,
participant review and training export policy remain roadmap work. No corpus is
published or model trained by these commands.
