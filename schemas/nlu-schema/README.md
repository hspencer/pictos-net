# PictoNet NLU Schema · 1.1.0

**PictoNet NLU Schema** defines a structured contract between *Natural Language Understanding (COMPRENDER)* and *pictogram composition (COMPONER)* within the [PictoNet](https://pictos.net) ecosystem.
It encodes communicative intent, semantic roles, logical form, and visual grounding cues — allowing human utterances to be transformed into cognitively accessible pictograms.


## Canonical source and release boundaries

Development happens in `schemas/nlu-schema` inside `mediafranca/pictos-net`, based
on empirical platform use. This directory is exported as an independent product;
external copies do not override the in-platform contract.

- `pictonet-nlu-1.0.1.schema.json` is frozen byte for byte; its SHA-256 is recorded
  in `FROZEN_RELEASES.json`. Its historical fixtures remain unchanged.
- `pictonet-nlu-1.1.0.schema.json` is the compatible document contract. It adds only
  an optional explicit `schemaVersion: "1.1.0"` to the historical shape.
- `pictonet-nlu-generation-1.1.0.schema.json` is a stricter **generation profile**,
  not a claim that every historical document meets today's requirements. It
  requires communicative metadata, semantic frames, nonempty NSM explanations,
  logical form, pragmatics and visual grounding. It uses canonical enums; frame
  references target unique frame IDs, not names. Map strings from a provider are
  decoded reversibly by PictoNet before validation; invalid maps are not repaired.
- Speaker identity and capture timestamps are forbidden in fresh model output:
  the model is not a source of that provenance. They remain readable in historical
  documents. Application execution evidence lives beside, not inside, NLU data.

`$schema` declares the JSON Schema dialect (2020-12); `$id` identifies the contract.
Neither establishes empirical semantic correctness, accessibility or training
permission. Passing validation does not authorize including a record in a dataset.

The portable generation-profile JSON is derived by
`node scripts/build-generation-profile.js`. Tests reject drift from the canonical
document plus the explicit profile rules in `scripts/generation-profile.js`.

### Standalone usage (Node 22+)

```sh
npm ci --ignore-scripts
npm test
node scripts/validate-one.js tests/generation/valid.json --generation
```

```js
import { validateDocument, validateGeneration } from '@mediafranca/nlu-schema';
// Precompiled static Ajv validators are reused; they do not coerce, remove or invent fields.
const valid = validateGeneration(data);
if (!valid) console.error(validateGeneration.errors);
```

The root test runner checks **only historical 1.0.1 fixtures**. Contract tests
separately verify the compatible document and strict generation profile. Do not
mix future-version fixtures into a validator for a different version.


### Static validation and strict browser CSP

`validators.js` is generated ahead of time by `npm run build:validators`; runtime
imports never call `Ajv.compile`, `eval` or `new Function`. This preserves PictoNet's
strict Content Security Policy without enabling `unsafe-eval`. `npm test` first
checks that generated validators exactly match the canonical contracts and pinned
compiler. After changing the document/profile, regenerate validators explicitly.
The small portable generator is identical in all three products; each independent
export contains its own copy and does not depend on the PictoNet checkout.

### Historical PictoNet rows are not automatically conformant

Earlier PictoNet provider tools did not enforce the canonical 1.0.1 contract.
Consequently a historical platform row may fail both 1.0.1 and the compatible
1.1.0 document contract even when the UI previously called its phase complete.
Compatibility means every valid 1.0.1 document remains valid under 1.1.0; it does
not mean every historical output was a valid 1.0.1 document. Tests also compare
all document constraints directly, not just a handful of examples.

Historical data stays inspectable without fabricated versions. A new Phase 2
call requires a conforming NLU document: invalid historical analysis must be
explicitly corrected, migrated with evidence, or regenerated before composition.
Failure must not erase the previously accepted historical artifact. No corpus is
silently migrated as part of these validator changes.

### Licensing and publication status

The existing `LICENSE` is CC BY-SA 4.0; package metadata now reflects that actual
file rather than the previously contradictory CC BY label. No historical license
text was changed. Rights for new executable validator code and the publication
license policy still require explicit review before release. Schema licensing
never supplies rights over utterances, participants, images or training data.

## Purpose

This schema formalises how linguistic meaning is represented before being rendered pictographically.
It bridges complementary traditions in linguistic semantics and visual cognition:

| Layer | Theoretical basis | Schema component |
|-------|-------------------|------------------|
| Speech Act & Intent | Austin · Searle · ISO 24617-2:2020 | `metadata.speech_act`, `metadata.intent` |
| Frame Semantics | Fillmore · FrameNet | `frames[*].roles` |
| Logical Representation | AMR · MRS | `logical_form` |
| Semantic Primes | Wierzbicka · Goddard (NSM) | `nsm_explications` |
| Pragmatics | Brown & Levinson · ISO 24617-2:2020 | `pragmatics` |
| Visual Grounding | Scene Graphs · AAC pictography | `visual_guidelines` |

New PictoNet generations are validated against the generation profile before acceptance. Historical documents remain distinct from verified new generations.
That object becomes the semantic input for the pictogram compiler, maintaining transparent, reproducible mapping between **text**, **meaning**, and **image**.

## Example

```json
{
  "utterance": "I want you to make the bed",
  "lang": "en",
  "metadata": { "speech_act": "directive", "intent": "request" },
  "frames": [
    {
      "id": "f1",
      "frame_name": "Directed_action",
      "lexical_unit": "make",
      "roles": {
        "Agent": { "type": "Addressee", "ref": "you", "surface": "you" },
        "Theme": { "type": "Object", "lemma": "bed", "surface": "the bed" }
      }
    },
    {
      "id": "f2",
      "frame_name": "Desire",
      "lexical_unit": "want",
      "roles": {
        "Experiencer": { "type": "Speaker", "ref": "I", "surface": "I" },
        "DesiredEvent": { "type": "Event", "ref_frame": "f1" }
      }
    }
  ],
  "nsm_explications": {
    "WANT": "I feel something. I don’t have something. I want it to happen.",
    "DO": "Someone does something.",
    "BED": "Something used for sleeping."
  },
  "logical_form": {
    "event": "make(you, bed)",
    "modality": "want(I, event)"
  },
  "pragmatics": {
    "politeness": "neutral",
    "formality": "informal",
    "expected_response": "compliance"
  },
  "visual_guidelines": {
    "focus_actor": "you",
    "context": "bedroom",
    "temporal": "immediate"
  }
}
```

## Schema Structure

| Field | Description |
|--------|-------------|
| `utterance` | Original text as received |
| `lang` | IETF BCP-47 language tag (e.g. `en`, `en-NZ`, `es-CL`) |
| `metadata` | Speech-act category, intent, optional timestamp and speaker ID |
| `frames` | Array of FrameNet-style frame objects with typed roles |
| `nsm_explications` | Natural Semantic Metalanguage decompositions (preferred key) |
| `NSM_explications` | Legacy alias for backward compatibility (deprecated) |
| `logical_form` | Predicate-style logical representation |
| `pragmatics` | Tone, politeness, formality, and expected response |
| `visual_guidelines` | Cues for layout, salience, and pictogram composition |

The complete formal definition is provided in
[`pictonet-nlu-1.1.0.schema.json`](pictonet-nlu-1.1.0.schema.json) and its
[strict generation profile](pictonet-nlu-generation-1.1.0.schema.json).

## Versioning

This schema follows **semantic versioning**:

- **v1.1.0** — current in-platform document and generation profile; not yet a published release.
- **v1.0.1** — frozen historical revision
  - Renamed `nsm_explictations` → `nsm_explications`
  - Added deprecation notice for `NSM_explications`
  - Tightened `RoleFiller` constraints
  - Removed redundant conditional block

Future minor versions will retain structural compatibility; major revisions may extend or reorganise definitions.

## Licence

The historical schema's [LICENSE](LICENSE) is **CC BY-SA 4.0** (attribution and
share alike), not the CC BY 4.0 previously stated here. This correction follows
the existing license file; it does not relicense historical work. See the
publication and executable-code licensing caveat above.

Author: **[Herbert Spencer González](https://herbertspencer.net)**.
