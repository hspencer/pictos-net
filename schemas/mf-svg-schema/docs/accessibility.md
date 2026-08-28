> Historical profile documentation. For the current draft and its verification limits, see [the product README](../README.md). These legacy statements do not establish v2 conformance or proven accessibility.

# Accessibility Guidelines — Cognitive and Visual Accessibility

**Version:** 1.0.0
**Status:** Best Practices Guide
**Language:** British English

---

## 1. Introduction

Accessibility is at the core of the MediaFranca SVG Schema philosophy. This document provides comprehensive guidelines for creating pictograms that are accessible to users with:

- **Cognitive diversities** (e.g., intellectual disabilities, autism, aphasia)
- **Visual impairments** (e.g., low vision, colour blindness)
- **Motor impairments** (requiring keyboard navigation)
- **Assistive technology dependencies** (screen readers, switch devices)

---

## 2. Cognitive Accessibility

### 2.1 Principles

#### 2.1.1 Simplicity

**Minimise visual complexity.** Cognitive load increases with the number of visual elements.

**Guidelines:**
- Limit the number of distinct visual elements to 3–5 per pictogram
- Use simple geometric shapes (circles, rectangles) rather than complex paths
- Avoid unnecessary ornamentation or decorative details

**Example:**
- ✅ A simple stick figure for "person"
- ❌ A detailed anatomical drawing

#### 2.1.2 Predictability

**Maintain consistent spatial arrangements.** Users develop mental models based on recurring patterns.

**Guidelines:**
- Place the **Agent** on the left side
- Place the **Patient** on the right or centre
- Place **Actions** between Agent and Patient, or as connecting elements
- Place **Locations** as background or contextual elements

**Example layout:**
```
[Agent]  →  [Action]  →  [Patient]
(Person)    (Giving)     (Water)
```

#### 2.1.3 Clarity

**Each visual element should have a single, unambiguous meaning.**

**Guidelines:**
- Avoid polysemous symbols (symbols with multiple meanings)
- Use cultural conventions where they exist (e.g., a pillow on a bed indicates "bed", not just "rectangle")
- Test with target users to verify comprehension

#### 2.1.4 Semantic Coherence

**The visual structure must mirror the linguistic structure.**

**Guidelines:**
- Ensure that the DOM hierarchy (groups) reflects the semantic roles (Agent, Patient, etc.)
- Use the `data-concept` attribute to make this relationship explicit
- Validate that the metadata `concepts` array corresponds exactly to the visual groups

---

### 2.2 Language and Labelling

#### 2.2.1 Cognitive Descriptions

The `metadata.accessibility.cognitiveDescription` field should use:

- **Simple vocabulary**: Prefer common words (e.g., "make" over "construct")
- **Active voice**: "A person is making a bed" (not "A bed is being made by a person")
- **Present tense**: Unless the utterance explicitly references past or future
- **Short sentences**: One main clause, minimal subordination

**Example:**
```json
{
  "cognitiveDescription": "A person is making a bed"
}
```

#### 2.2.2 ARIA Labels

Each semantic group's `aria-label` should be:

- **Concise**: 3–7 words
- **Descriptive**: Clearly identifies the concept
- **Role-specific**: Includes the semantic role where helpful

**Examples:**
```xml
<g aria-label="Person making the bed">...</g>
<g aria-label="The bed being made">...</g>
<g aria-label="Making action">...</g>
```

---

### 2.3 Visual Strategies for Cognitive Accessibility

#### 2.3.1 Use of Colour

**Colour should not be the sole means of conveying information.**

**Guidelines:**
- Use high-contrast **shapes** and **patterns** in addition to colour
- Ensure the pictogram remains comprehensible in grayscale
- Follow WCAG 2.2 contrast ratios (minimum 4.5:1 for text, 3:1 for graphical objects)

#### 2.3.2 Size and Spacing

**Key elements should be large and well-separated.**

**Guidelines:**
- The most important concept (usually the Agent) should occupy the largest visual space
- Maintain a minimum of 10–15 units of spacing between distinct concepts
- Use the `viewBox` attribute to define a consistent coordinate system (recommended: `0 0 300 200`)

#### 2.3.3 Gestalt Principles

Apply Gestalt principles of perceptual organisation:

- **Proximity**: Group related elements close together
- **Similarity**: Use similar shapes for related concepts
- **Closure**: Allow the viewer's mind to complete simple shapes
- **Figure-Ground**: Ensure clear distinction between elements and background

---

## 3. Visual Accessibility

### 3.1 Low Vision

#### 3.1.1 High Contrast

**Use the dual-class system (`.f` and `.k`) to ensure key elements stand out.**

**Guidelines:**
- Reserve `.k` classes for semantically critical elements (e.g., faces, hands, action indicators)
- Use `.f` classes for supporting elements (e.g., background objects, context)
- Test rendering with `@media (prefers-contrast: high)` enabled

#### 3.1.2 Stroke Width

**Strokes must be thick enough to be visible at small sizes.**

**Minimum stroke widths:**
- Standard (`.f`): `2` units
- Key/contrast (`.k`): `3` units
- High contrast mode: `3–4` units

#### 3.1.3 Scalability

**SVG's vector nature ensures infinite scalability.** However:

- Test rendering at both small (64×64 px) and large (512×512 px) sizes
- Ensure that fine details remain visible when scaled down
- Avoid strokes thinner than 2 units at the native `viewBox` resolution

---

### 3.2 Colour Blindness

#### 3.2.1 Non-Reliance on Colour

**Never use colour alone to distinguish concepts.**

**Guidelines:**
- Use **shape**, **size**, **position**, and **texture** as primary differentiators
- If colour is used for semantic meaning (e.g., red for "stop"), also use a distinct shape (e.g., octagon)

#### 3.2.2 Recommended Colour Palette

If colour is used:

- Use high-contrast, colour-blind-friendly palettes (e.g., colourblind-safe palettes from ColorBrewer)
- Test with simulators (e.g., Coblis, Color Oracle)
- Prefer **grayscale** for the base schema, allowing implementations to add colour as an optional layer

---

### 3.3 Screen Readers

#### 3.3.1 Semantic Markup

**Use ARIA roles and attributes correctly.**

**Required on root `<svg>`:**
```xml
<svg role="img" aria-labelledby="title desc">
  <title id="title">I am making the bed</title>
  <desc id="desc">A simplified figure stands beside a bed...</desc>
  ...
</svg>
```

**Required on semantic groups:**
```xml
<g role="group" aria-label="Person making the bed">...</g>
```

#### 3.3.2 Reading Order

**The DOM order determines the screen reader's reading order.**

**Guidelines:**
- Order semantic groups in a logical narrative sequence (e.g., Agent → Action → Patient)
- Place decorative or contextual elements last
- Use `aria-hidden="true"` for purely decorative groups

**Example order:**
```xml
<g id="person-agent" ...>...</g>
<g id="action-making" ...>...</g>
<g id="bed-patient" ...>...</g>
<g id="context-background" aria-hidden="true">...</g>
```

#### 3.3.3 Visual Descriptions

The `metadata.accessibility.visualDescription` should:

- Describe spatial relationships (e.g., "to the left of", "above")
- Mention key visual features (e.g., "a circular head", "a rectangular bed frame")
- Be detailed enough for a sighted assistant to reconstruct the image verbally

**Example:**
```json
{
  "visualDescription": "A simplified stick figure with a circular head stands on the left side. The figure's right arm extends towards a rectangular bed frame on the right. The bed has a pillow at the top and a partially visible blanket."
}
```

---

## 4. Motor Accessibility

### 4.1 Keyboard Navigation

#### 4.1.1 Tab Order

**All interactive elements must be keyboard-accessible.**

**Guidelines:**
- Add `tabindex="0"` to all semantic groups
- Ensure focus moves in a logical order (left to right, top to bottom)
- Avoid `tabindex` values greater than 0 (they disrupt natural tab order)

#### 4.1.2 Focus Indicators

**Keyboard focus must be clearly visible.**

**CSS requirement:**
```css
g[role="group"]:focus {
  outline: 2px solid #0066cc;
  outline-offset: 2px;
}
```

**Guidelines:**
- The focus indicator should have at least a 3:1 contrast ratio with the background
- Test with keyboard-only navigation (no mouse)

---

## 5. Assistive Technology Compatibility

### 5.1 Screen Magnifiers

**Ensure pictograms remain coherent when partially visible.**

**Guidelines:**
- Maintain clear visual boundaries between concepts
- Avoid overlapping elements where possible
- Use sufficient contrast to distinguish elements even when magnified

---

### 5.2 Switch Devices

**Users with severe motor impairments may use switch devices for navigation.**

**Guidelines:**
- Ensure all interactive elements are focusable via keyboard (switch devices emulate keyboard input)
- Provide sufficiently large click/tap targets (minimum 44×44 px per WCAG 2.2)
- Test with single-switch scanning tools

---

### 5.3 AAC Devices

**MediaFranca pictograms are designed for use in AAC software.**

**Guidelines:**
- The `metadata.utterance` field should contain the exact phrase the pictogram represents
- The `metadata.concepts` array should allow AAC software to programmatically construct sentences from multiple pictograms
- Ensure portability by embedding all necessary data within the SVG file (SSoT principle)

**Example use case:**

An AAC user selects three pictograms:
1. "I" (Agent)
2. "want" (Action)
3. "water" (Patient)

The AAC software reads the `utterance` field from each and constructs: "I want water."

---

## 6. Testing and Validation

### 6.1 Automated Testing

Use the provided validator:
```bash
python tools/validator.py your-pictogram.svg
```

**Checks include:**
- Presence of `role="img"`, `aria-labelledby`
- Valid `tabindex` on all semantic groups
- Valid `aria-label` on all groups
- Embedded stylesheet with accessibility media queries

---

### 6.2 Manual Testing Checklist

#### Visual Rendering
- [ ] Pictogram is clear and unambiguous at 64×64 px
- [ ] Pictogram scales cleanly to 512×512 px
- [ ] Key elements are visually distinct in standard mode
- [ ] High-contrast mode enhances visibility of critical elements
- [ ] Pictogram is comprehensible in grayscale

#### Screen Reader
- [ ] Title and description are announced correctly
- [ ] Each semantic group is announced with its `aria-label`
- [ ] Reading order is logical (Agent → Action → Patient)
- [ ] Decorative elements are correctly hidden (`aria-hidden="true"`)

#### Keyboard Navigation
- [ ] All semantic groups are focusable with Tab key
- [ ] Focus indicator is clearly visible
- [ ] Tab order matches visual and semantic order

#### Cognitive Clarity
- [ ] Pictogram uses simple, recognisable shapes
- [ ] Spatial arrangement is predictable (Agent on left, etc.)
- [ ] No ambiguous or polysemous symbols
- [ ] Cognitive description uses simple language

---

### 6.3 User Testing

**The gold standard for accessibility is testing with real users.**

**Recommended user groups:**
- Individuals with intellectual disabilities
- Individuals with autism spectrum conditions
- Individuals with aphasia or language impairments
- Individuals using screen readers (blind or low vision)
- Individuals using AAC devices

**Validation questions:**
- "What does this picture show?"
- "Can you describe what is happening?"
- "If you wanted to say this, would this picture help you?"

**Record results in the `metadata.vcsci` field.**

---

## 7. Best Practices Summary

### 7.1 Do's

✅ **Use simple shapes** (circles, rectangles, lines)
✅ **Follow predictable layouts** (Agent left, Patient right)
✅ **Maintain high contrast** between key elements and background
✅ **Embed all accessibility data** within the SVG (SSoT)
✅ **Test with real users** from target populations
✅ **Provide both cognitive and visual descriptions**
✅ **Use ARIA roles and labels** correctly
✅ **Enable keyboard navigation** with `tabindex` and focus indicators

---

### 7.2 Don'ts

❌ **Don't rely on colour alone** to convey meaning
❌ **Don't use complex or detailed illustrations** (cognitive overload)
❌ **Don't use ambiguous symbols** (test for comprehension)
❌ **Don't skip the `<metadata>` block** (breaks SSoT principle)
❌ **Don't use inaccessible SVG** (missing ARIA attributes)
❌ **Don't assume understanding** without user validation

---

## 8. Compliance Standards

This schema aligns with:

- **WCAG 2.2** (Web Content Accessibility Guidelines) — Levels A, AA, AAA where applicable
- **COGA** (Cognitive and Learning Disabilities Accessibility) — W3C Task Force recommendations
- **ARIA 1.2** (Accessible Rich Internet Applications) — For semantic roles and properties
- **ISO 24751** (Individualized Adaptability and Accessibility in e-Learning) — For AAC interoperability

---

## 9. References

### 9.1 Standards and Guidelines

- [WCAG 2.2](https://www.w3.org/WAI/WCAG22/quickref/)
- [W3C COGA](https://www.w3.org/WAI/cognitive/)
- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)
- [SVG Accessibility Features](https://www.w3.org/TR/SVG2/access.html)

### 9.2 AAC-Specific Resources

- [AAC-RERC](http://aac-rerc.com/) — Rehabilitation Engineering Research Center on AAC
- [ISAAC](https://www.isaac-online.org/) — International Society for Augmentative and Alternative Communication
- [OpenAAC](https://www.openaac.org/) — Open-source AAC resources

### 9.3 Cognitive Accessibility

- [Making Content Usable for People with Cognitive Disabilities](https://www.w3.org/TR/coga-usable/)
- [Easy Read Guidelines](https://www.inclusion-europe.eu/easy-to-read/)

---

**Document History:**

- 2026-01-27: Initial version 1.0.0
