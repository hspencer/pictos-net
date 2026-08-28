> Historical profile documentation. For the current draft and its verification limits, see [the product README](../README.md). These legacy statements do not establish v2 conformance or proven accessibility.

# NLU Integration — Mapping Natural Language Understanding to SVG Structure

**Version:** 1.0.0
**Status:** Technical Guide
**Language:** British English

---

## 1. Overview

This document describes how the MediaFranca SVG Schema integrates with the Natural Language Understanding (NLU) pipeline, particularly the `mediafranca/nlu-schema`. The integration ensures that the linguistic analysis performed during utterance decomposition is faithfully represented in the SVG's DOM structure and metadata.

---

## 2. The NLU-to-SVG Pipeline

### 2.1 Pipeline Stages

```
User Utterance
    ↓
[1] NLU Analysis (mediafranca/nlu-schema)
    ↓
[2] NSM Decomposition (Semantic Primes)
    ↓
[3] Concept-Role Mapping
    ↓
[4] PictoNet Generation (Visual Synthesis)
    ↓
[5] SVG Structuring (mediafranca/svg-schema)
    ↓
Conformant SVG Pictogram (SSoT)
```

### 2.2 Data Flow

At each stage, the **chain of thought** is preserved and enriched:

1. **Utterance** → Raw text input (e.g., "I am making the bed")
2. **NLU Analysis** → Syntactic parse, dependency relations
3. **NSM Decomposition** → Identification of semantic primes (`I`, `DO`, `SOMETHING`)
4. **Concept-Role Mapping** → Assignment of roles (`Agent`, `Action`, `Patient`)
5. **Visual Synthesis** → Generation of SVG paths and primitives
6. **Metadata Embedding** → Encapsulation of all prior stages in the `<metadata>` block

---

## 3. Natural Semantic Metalanguage (NSM)

### 3.1 What is NSM?

Natural Semantic Metalanguage is a linguistic theory proposing that all languages share a common set of **semantic primes**—irreducible concepts that cannot be further decomposed.

**Example primes:**
- Substantives: `I`, `YOU`, `SOMEONE`, `SOMETHING`, `PEOPLE`, `BODY`
- Actions: `DO`, `HAPPEN`, `MOVE`, `TOUCH`
- Descriptors: `GOOD`, `BAD`, `BIG`, `SMALL`
- Space: `WHERE`, `PLACE`, `HERE`, `ABOVE`, `BELOW`, `INSIDE`
- Time: `WHEN`, `NOW`, `BEFORE`, `AFTER`

### 3.2 NSM in the Metadata Block

The `metadata.nsm` field records:

1. **`primes`**: Array of identified primes
2. **`gloss`**: Human-readable explanation of the decomposition

**Example:**

```json
{
  "nsm": {
    "primes": ["I", "DO", "SOMETHING"],
    "gloss": "I DO something to SOMETHING"
  }
}
```

### 3.3 NSM-to-Concept Mapping

Each concept in `metadata.concepts` may reference an NSM prime via the `nsmPrime` field:

```json
{
  "concepts": [
    {
      "id": "person-agent",
      "role": "Agent",
      "label": "Person making the bed",
      "nsmPrime": "I"
    },
    {
      "id": "action-making",
      "role": "Action",
      "label": "Making action",
      "nsmPrime": "DO"
    },
    {
      "id": "bed-patient",
      "role": "Patient",
      "label": "The bed being made",
      "nsmPrime": "SOMETHING"
    }
  ]
}
```

---

## 4. Semantic Role Assignment

### 4.1 From Syntax to Semantics

The NLU pipeline performs dependency parsing to identify syntactic roles (subject, object, verb). These are then mapped to **semantic roles** defined in this schema.

**Example utterance:** "I am making the bed"

**Syntactic analysis:**
- Subject: "I"
- Verb: "am making"
- Object: "the bed"

**Semantic role mapping:**
- Subject → `Agent` ("I")
- Verb → `Action` ("making")
- Object → `Patient` ("the bed")

### 4.2 Role Definitions

The following semantic roles are supported (see [`specification.md`](specification.md) §3.4 for full definitions):

| NLU Output | Semantic Role | SVG Representation |
|------------|---------------|-------------------|
| Subject (animate) | `Agent` | Primary figure performing action |
| Subject (inanimate, state) | `Theme` | Entity in a state or location |
| Direct object | `Patient` | Entity undergoing the action |
| Verb/action | `Action` | Visual indicator of the action |
| Prepositional phrase (with) | `Instrument` | Tool used in the action |
| Prepositional phrase (in/at) | `Location` | Spatial context |
| Adjective/state | `Attribute` | Quality or property |
| Experiencer (feel, see) | `Experiencer` | Entity experiencing a sensation |
| Indirect object | `Beneficiary` | Entity benefiting from the action |
| Prepositional phrase (to) | `Goal` | Destination or target |
| Prepositional phrase (from) | `Source` | Origin or starting point |

### 4.3 Complex Role Scenarios

#### 4.3.1 Overlapping Roles

In some utterances, a single entity may have multiple roles. In such cases, choose the **primary role** based on the communicative intent.

**Example:** "I see myself in the mirror"
- "I" → `Experiencer` (primary)
- "myself" → `Theme` (secondary, reflected entity)

#### 4.3.2 Implicit Roles

Some roles may be implicit in the utterance but visually represented.

**Example:** "I am happy"
- "I" → `Experiencer`
- "happy" → `Attribute`
- Visual representation may include a smiling face as part of the `Experiencer` group

---

## 5. Concept-to-Group Mapping

### 5.1 One Concept, One Group

**Each concept identified in the NLU analysis must correspond to exactly one top-level `<g>` element in the SVG.**

**Metadata:**
```json
{
  "concepts": [
    { "id": "person-agent", "role": "Agent", "label": "..." },
    { "id": "action-making", "role": "Action", "label": "..." },
    { "id": "bed-patient", "role": "Patient", "label": "..." }
  ]
}
```

**SVG structure:**
```xml
<g id="person-agent" role="group" data-concept="Agent" ...>
  <!-- Visual elements for the person -->
</g>
<g id="action-making" role="group" data-concept="Action" ...>
  <!-- Visual elements for the action -->
</g>
<g id="bed-patient" role="group" data-concept="Patient" ...>
  <!-- Visual elements for the bed -->
</g>
```

### 5.2 Hierarchical Concepts

For complex concepts, use nested groups whilst maintaining a top-level group for the primary concept.

**Example:** "I give you a glass of water"

```xml
<g id="person-agent" data-concept="Agent" ...>
  <circle ... /> <!-- head -->
  <line ... /> <!-- body -->
</g>
<g id="action-giving" data-concept="Action" ...>
  <path ... /> <!-- arm extending -->
  <path ... /> <!-- motion lines -->
</g>
<g id="water-patient" data-concept="Patient" ...>
  <g id="glass-container">
    <rect ... /> <!-- glass -->
  </g>
  <g id="water-substance">
    <path ... /> <!-- water inside glass -->
  </g>
</g>
<g id="recipient-beneficiary" data-concept="Beneficiary" ...>
  <circle ... /> <!-- head of recipient -->
  <line ... /> <!-- body -->
</g>
```

### 5.3 Implicit Actions

Actions are not always represented as separate visual elements. When an action is conveyed through an Agent's posture, gesture, or spatial relationship to other entities, it should be marked as **implicit** in the metadata.

#### 5.3.1 When Actions Are Implicit

An Action concept should be implicit when:

1. The action is inherent in the Agent's body position or gesture
2. The Agent's body parts (arm, hand, leg) indicate the action through their position
3. A separate visual element for the action would be redundant or visually cluttering
4. The spatial relationship between Agent and Patient clearly conveys the action

**Example:** "Make the bed"

The action of "making" is implicit because:

- The person's arm reaches towards the bed
- The body posture indicates engagement with the bed
- Adding motion lines or a separate "making" symbol would be redundant

#### 5.3.2 Metadata Structure for Implicit Actions

```json
{
  "concepts": [
    {
      "id": "g-person",
      "role": "Agent",
      "label": "Person making the bed",
      "nsmPrime": "SOMEONE",
      "note": "The Agent performs the Action through body posture and arm position"
    },
    {
      "role": "Action",
      "label": "Making (implicit action performed by Agent)",
      "nsmPrime": "DO",
      "implicit": true,
      "performedBy": "g-person",
      "note": "Action is not a separate visual element; it is executed by the Agent"
    },
    {
      "id": "g-bed",
      "role": "Patient",
      "label": "The bed being made",
      "nsmPrime": "SOMETHING"
    }
  ]
}
```

Note:

- The Action concept has `"implicit": true`
- The Action concept has **no `id` field** (no corresponding SVG group)
- The `performedBy` field links the Action to the Agent that executes it

#### 5.3.3 SVG Structure for Implicit Actions

The Agent's SVG group contains all body parts, including those that convey the action:

```xml
<g id="g-bed" role="group" data-concept="Patient" ...>
  <!-- Bed visual elements -->
</g>

<g id="g-person" role="group" data-concept="Agent" data-action="making" ...>
  <circle id="head" ... />
  <path id="arm" ... />   <!-- Positioned to indicate the action -->
  <path id="body" ... />
</g>
```

**Key points:**

- The `data-action="making"` attribute on the Agent group semantically links it to the implicit Action
- The arm is part of the Agent, not a separate Action group
- Z-index ordering (head, arm, body) ensures proper visual layering

#### 5.3.4 When Actions Should Be Explicit

Use an explicit Action (with its own `<g id="g-action">`) when:

1. The action has distinct visual indicators (motion lines, arrows, trajectories)
2. The action involves a tool or instrument shown separately
3. The action is the primary focus and requires visual emphasis
4. The action occurs without a clear single Agent

**Example:** "Water is flowing"

- The flowing motion might be shown with explicit motion lines or particle effects
- In this case, create a separate `<g id="g-action-flowing">` group

---

## 6. Integration with `mediafranca/nlu-schema`

### 6.1 Schema Alignment

The `metadata.concepts` array is designed to accept output directly from the `mediafranca/nlu-schema` pipeline, with minimal transformation.

**Expected NLU output format:**
```json
{
  "utterance": "I am making the bed",
  "analysis": {
    "nsm": {
      "primes": ["I", "DO", "SOMETHING"],
      "gloss": "I DO something to SOMETHING"
    },
    "concepts": [
      {
        "text": "I",
        "role": "Agent",
        "nsmPrime": "I"
      },
      {
        "text": "making",
        "role": "Action",
        "nsmPrime": "DO"
      },
      {
        "text": "the bed",
        "role": "Patient",
        "nsmPrime": "SOMETHING"
      }
    ]
  }
}
```

**Transformation to SVG metadata:**
```json
{
  "utterance": "I am making the bed",
  "nsm": {
    "primes": ["I", "DO", "SOMETHING"],
    "gloss": "I DO something to SOMETHING"
  },
  "concepts": [
    {
      "id": "person-agent",        // Generated during visual synthesis
      "role": "Agent",              // Preserved from NLU
      "label": "Person making the bed",  // Generated or human-authored
      "nsmPrime": "I"               // Preserved from NLU
    },
    {
      "id": "action-making",
      "role": "Action",
      "label": "Making action",
      "nsmPrime": "DO"
    },
    {
      "id": "bed-patient",
      "role": "Patient",
      "label": "The bed being made",
      "nsmPrime": "SOMETHING"
    }
  ]
}
```

### 6.2 Provenance Tracking

The `metadata.provenance.sourceDataset` field should reference the NLU model version:

```json
{
  "provenance": {
    "generator": "PictoNet v2.1",
    "generatedAt": "2026-01-27T14:00:00Z",
    "sourceDataset": "mediafranca-nlu-v1.2"
  }
}
```

---

## 7. Example: End-to-End Integration

### 7.1 Input Utterance

**User says:** "I want water"

### 7.2 NLU Analysis

**Output from `mediafranca/nlu-schema`:**
```json
{
  "utterance": "I want water",
  "analysis": {
    "nsm": {
      "primes": ["I", "WANT", "SOMETHING"],
      "gloss": "I WANT SOMETHING"
    },
    "concepts": [
      { "text": "I", "role": "Experiencer", "nsmPrime": "I" },
      { "text": "want", "role": "Action", "nsmPrime": "WANT" },
      { "text": "water", "role": "Theme", "nsmPrime": "SOMETHING" }
    ]
  }
}
```

### 7.3 PictoNet Visual Synthesis

**Visual concepts generated:**
- A person (Experiencer)
- A thought bubble or desire indicator (Action)
- A glass of water (Theme)

### 7.4 SVG Metadata

```json
{
  "version": "1.0.0",
  "utterance": "I want water",
  "nsm": {
    "primes": ["I", "WANT", "SOMETHING"],
    "gloss": "I WANT SOMETHING"
  },
  "concepts": [
    {
      "id": "person-experiencer",
      "role": "Experiencer",
      "label": "Person wanting water",
      "nsmPrime": "I"
    },
    {
      "id": "desire-action",
      "role": "Action",
      "label": "Wanting (desire)",
      "nsmPrime": "WANT"
    },
    {
      "id": "water-theme",
      "role": "Theme",
      "label": "Water (desired object)",
      "nsmPrime": "SOMETHING"
    }
  ],
  "accessibility": {
    "cognitiveDescription": "A person wants water",
    "visualDescription": "A person with a thought bubble showing a glass of water"
  },
  "provenance": {
    "generator": "PictoNet v2.1",
    "generatedAt": "2026-01-27T15:00:00Z",
    "sourceDataset": "mediafranca-nlu-v1.2"
  },
  "vcsci": {
    "validated": true,
    "validatedAt": "2026-01-27T15:30:00Z",
    "clarityScore": 5
  }
}
```

### 7.5 SVG Structure

```xml
<svg xmlns="http://www.w3.org/2000/svg" ...>
  <title>I want water</title>
  <desc>A person with a thought bubble showing a glass of water</desc>
  <metadata id="mf-accessibility">
    { ... }
  </metadata>
  <defs>
    <style>...</style>
  </defs>

  <g id="person-experiencer" role="group" data-concept="Experiencer" ...>
    <!-- Person visual elements -->
  </g>

  <g id="desire-action" role="group" data-concept="Action" ...>
    <!-- Thought bubble visual elements -->
  </g>

  <g id="water-theme" role="group" data-concept="Theme" ...>
    <!-- Glass of water visual elements -->
  </g>
</svg>
```

---

## 8. Best Practices

### 8.1 For NLU Pipeline Developers

1. **Output structured JSON** that aligns with the `mediafranca/svg-schema` metadata format
2. **Preserve semantic primes** through the entire pipeline
3. **Document role assignment logic** for edge cases
4. **Version your NLU models** and record in `provenance.sourceDataset`

### 8.2 For PictoNet Developers

1. **Consume NLU output directly** with minimal transformation
2. **Generate unique, descriptive IDs** for SVG groups (e.g., `person-agent`, `water-theme`)
3. **Maintain concept-group correspondence** exactly as specified in the NLU analysis
4. **Embed the complete chain of thought** in the metadata block

### 8.3 For Validators (VCSCI)

1. **Verify semantic accuracy**: Does the visual representation match the NLU analysis?
2. **Check concept correspondence**: Does each metadata concept have a corresponding SVG group?
3. **Assess cognitive clarity**: Is the pictogram understandable given the NSM decomposition?

---

## 9. References

- **NSM Database**: [Natural Semantic Metalanguage Homepage](https://nsm-approach.net/)
- **Dependency Parsing**: Universal Dependencies (UD) framework
- **MediaFranca NLU Schema**: `mediafranca/nlu-schema` repository

---

**Document History:**

- 2026-01-27: Initial version 1.0.0
