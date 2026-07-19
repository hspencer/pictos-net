import { StyleDefinition } from './types';

// Simple ID generator to avoid external dependencies in this specific output format
export const generateId = () => Math.random().toString(36).substr(2, 9);

/**
 * Default style palette for pictogram libraries.
 *
 * ORDER MATTERS: extractPaletteClasses (svgStructureService) sends the FIRST
 * 30 classes to the vision model as the available palette, in this order.
 * Colour classes must therefore come first and animations last.
 *
 * Sections:
 *   1. Pipeline core   — classes ESTRUCTURAR emits (k, f, main, w, accent)
 *   2. Semantic signal — red/green/warning/info
 *   3. Chromatic       — yellow, orange, pink, purple, teal, sky, navy
 *   4. People          — skin tones
 *   5. Nature          — leaf, sand, brown
 *   6. Grays & depth   — gray ramp + shadow
 *   7. Strokes         — st-*, dashed, dotted, hollow
 *   8. Effects         — glow*, ghost, flat
 *   9. Animations      — all `anim-*`; transforms are centre-referenced via
 *      transform-box: fill-box + transform-origin: center (exceptions noted:
 *      anim-rock pivots at top, anim-bounce squashes from the bottom).
 */
export const INITIAL_STYLES: StyleDefinition[] = [
  // === 1. PIPELINE CORE ===
  // The two base classes of the pictogram: k = black (as in CMYK's key),
  // f = white (as in #FFF). ESTRUCTURAR assigns them by the path's measured
  // colour, never by semantics — semantics live in data-concept.
  {
    id: generateId(),
    selectors: ['.k', '.main'],
    description: 'Black — key shapes (k as in CMYK key)',
    rules: [
      { id: generateId(), property: 'fill', value: '#1a1a1a' },
      { id: generateId(), property: 'stroke', value: '#ffffff' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.f', '.w'],
    description: 'White — f as in #FFF (holes, highlights), no stroke',
    rules: [
      { id: generateId(), property: 'fill', value: '#ffffff' },
      { id: generateId(), property: 'stroke', value: 'none' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.secondary'],
    description: 'White fill WITH dark outline (vs .f/.w, outline-free)',
    rules: [
      { id: generateId(), property: 'fill', value: '#ffffff' },
      { id: generateId(), property: 'stroke', value: '#1a1a1a' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.accent'],
    description: 'Cyan accent color',
    rules: [
      { id: generateId(), property: 'fill', value: '#00ccff' },
      { id: generateId(), property: 'stroke', value: '#06a0c6' },
    ],
  },

  // === 2. SEMANTIC SIGNALS ===
  {
    id: generateId(),
    selectors: ['.red'],
    description: 'Semantic: Red (danger, stop, pain)',
    rules: [
      { id: generateId(), property: 'fill', value: '#ef4444' },
      { id: generateId(), property: 'stroke', value: '#b91c1c' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.green'],
    description: 'Semantic: Green (yes, go, ok)',
    rules: [
      { id: generateId(), property: 'fill', value: '#22c55e' },
      { id: generateId(), property: 'stroke', value: '#15803d' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.warning'],
    description: 'Semantic: Warning amber',
    rules: [
      { id: generateId(), property: 'fill', value: '#f59e0b' },
      { id: generateId(), property: 'stroke', value: '#b45309' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.info'],
    description: 'Semantic: Information blue',
    rules: [
      { id: generateId(), property: 'fill', value: '#3b82f6' },
      { id: generateId(), property: 'stroke', value: '#1d4ed8' },
    ],
  },

  // === 3. CHROMATIC ===
  {
    id: generateId(),
    selectors: ['.yellow'],
    description: 'Chromatic: Yellow (sun, light)',
    rules: [
      { id: generateId(), property: 'fill', value: '#facc15' },
      { id: generateId(), property: 'stroke', value: '#ca8a04' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.orange'],
    description: 'Chromatic: Orange',
    rules: [
      { id: generateId(), property: 'fill', value: '#f97316' },
      { id: generateId(), property: 'stroke', value: '#c2410c' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.pink'],
    description: 'Chromatic: Pink',
    rules: [
      { id: generateId(), property: 'fill', value: '#ec4899' },
      { id: generateId(), property: 'stroke', value: '#be185d' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.purple'],
    description: 'Chromatic: Purple',
    rules: [
      { id: generateId(), property: 'fill', value: '#a855f7' },
      { id: generateId(), property: 'stroke', value: '#7e22ce' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.teal'],
    description: 'Chromatic: Teal (blue-green)',
    rules: [
      { id: generateId(), property: 'fill', value: '#14b8a6' },
      { id: generateId(), property: 'stroke', value: '#0f766e' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.sky'],
    description: 'Chromatic: Sky blue (pale)',
    rules: [
      { id: generateId(), property: 'fill', value: '#7dd3fc' },
      { id: generateId(), property: 'stroke', value: '#38bdf8' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.navy'],
    description: 'Chromatic: Navy blue (dark)',
    rules: [
      { id: generateId(), property: 'fill', value: '#12379b' },
      { id: generateId(), property: 'stroke', value: '#0c2568' },
    ],
  },

  // === 4. PEOPLE (skin tones) ===
  {
    id: generateId(),
    selectors: ['.skin-1'],
    description: 'Skin tone: Light',
    rules: [
      { id: generateId(), property: 'fill', value: '#fde8d0' },
      { id: generateId(), property: 'stroke', value: '#dbb896' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.skin-2'],
    description: 'Skin tone: Medium light',
    rules: [
      { id: generateId(), property: 'fill', value: '#d4a574' },
      { id: generateId(), property: 'stroke', value: '#a87d56' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.skin-3'],
    description: 'Skin tone: Medium dark',
    rules: [
      { id: generateId(), property: 'fill', value: '#7a5230' },
      { id: generateId(), property: 'stroke', value: '#5e3d22' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.skin-4'],
    description: 'Skin tone: Dark',
    rules: [
      { id: generateId(), property: 'fill', value: '#4a3222' },
      { id: generateId(), property: 'stroke', value: '#2e1f15' },
    ],
  },

  // === 5. NATURE & MATERIALS ===
  {
    id: generateId(),
    selectors: ['.leaf'],
    description: 'Nature: Leaf green (olive)',
    rules: [
      { id: generateId(), property: 'fill', value: '#4d7c0f' },
      { id: generateId(), property: 'stroke', value: '#365314' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.sand'],
    description: 'Nature: Sand / beach',
    rules: [
      { id: generateId(), property: 'fill', value: '#e8d5a3' },
      { id: generateId(), property: 'stroke', value: '#c4aa6a' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.brown'],
    description: 'Nature: Brown (earth, wood)',
    rules: [
      { id: generateId(), property: 'fill', value: '#a0522d' },
      { id: generateId(), property: 'stroke', value: '#6b371e' },
    ],
  },

  // === 6. GRAYS & DEPTH ===
  {
    id: generateId(),
    selectors: ['.gray-light'],
    description: 'Gray ramp: Light (background planes)',
    rules: [
      { id: generateId(), property: 'fill', value: '#d1d5db' },
      { id: generateId(), property: 'stroke', value: '#9ca3af' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.gray'],
    description: 'Gray ramp: Medium',
    rules: [
      { id: generateId(), property: 'fill', value: '#98a0ae' },
      { id: generateId(), property: 'stroke', value: '#7e838b' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.gray-dark'],
    description: 'Gray ramp: Dark (secondary elements)',
    rules: [
      { id: generateId(), property: 'fill', value: '#6b7280' },
      { id: generateId(), property: 'stroke', value: '#4b5563' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.shadow'],
    description: 'Depth: Cast shadow (translucent gray)',
    rules: [
      { id: generateId(), property: 'fill', value: '#6b7280' },
      { id: generateId(), property: 'stroke', value: 'none' },
      { id: generateId(), property: 'opacity', value: '0.5' },
    ],
  },

  // === 7. STROKE MODIFIERS ===
  {
    id: generateId(),
    selectors: ['.st-dark'],
    description: 'Stroke modifier: Dark',
    rules: [
      { id: generateId(), property: 'stroke', value: '#000000' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.st-light'],
    description: 'Stroke modifier: Light (white, hollow)',
    rules: [
      { id: generateId(), property: 'stroke', value: '#ffffff' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'fill', value: 'none' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.st-thin'],
    description: 'Stroke modifier: Thin (1pt)',
    rules: [
      { id: generateId(), property: 'stroke-width', value: '1pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.st-thick'],
    description: 'Stroke modifier: Thick (5pt)',
    rules: [
      { id: generateId(), property: 'stroke-width', value: '5pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.st-none'],
    description: 'Stroke modifier: No stroke',
    rules: [
      { id: generateId(), property: 'stroke', value: 'none' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.hollow'],
    description: 'Stroke modifier: Outline only (dark, no fill)',
    rules: [
      { id: generateId(), property: 'fill', value: 'none' },
      { id: generateId(), property: 'stroke', value: '#1a1a1a' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'stroke-linecap', value: 'round' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.dashed'],
    description: 'Stroke modifier: Dashed round',
    rules: [
      { id: generateId(), property: 'stroke-dasharray', value: '4 8' },
      { id: generateId(), property: 'fill', value: 'none' },
      { id: generateId(), property: 'stroke', value: '#636363' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'stroke-linecap', value: 'round' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.dotted'],
    description: 'Stroke modifier: Dotted',
    rules: [
      { id: generateId(), property: 'stroke-dasharray', value: '2 4' },
      { id: generateId(), property: 'stroke-linecap', value: 'round' },
      { id: generateId(), property: 'fill', value: 'none' },
      { id: generateId(), property: 'stroke', value: '#636363' },
      { id: generateId(), property: 'stroke-width', value: '2pt' },
    ],
  },

  // === 8. EFFECTS ===
  {
    id: generateId(),
    selectors: ['.glow'],
    description: 'Effect: Blue glow',
    rules: [
      { id: generateId(), property: 'filter', value: 'drop-shadow(0 0 4pt #0ea5e9)' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.glow-warm'],
    description: 'Effect: Warm amber glow',
    rules: [
      { id: generateId(), property: 'filter', value: 'drop-shadow(0 0 4pt #f59e0b)' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.glow-red'],
    description: 'Effect: Red alert glow',
    rules: [
      { id: generateId(), property: 'filter', value: 'drop-shadow(0 0 4pt #ef4444)' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.ghost'],
    description: 'Effect: Ghost (absence, negation, past)',
    rules: [
      { id: generateId(), property: 'opacity', value: '0.35' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.flat'],
    description: 'Effect: Flat (no stroke, no effects)',
    rules: [
      { id: generateId(), property: 'stroke', value: 'none' },
      { id: generateId(), property: 'filter', value: 'none' },
    ],
  },

  // === 9. ANIMATIONS ===
  // All transform-based animations reference the CENTRE of the animated
  // element (transform-box: fill-box + transform-origin: center) so motion
  // pivots on the object itself, never on the SVG canvas origin.
  // Intentional exceptions: anim-rock (pendulum, pivots at top edge) and
  // anim-bounce (squash-and-stretch, anchored to bottom edge).

  // -- Presence (opacity only, no origin needed) --
  {
    id: generateId(),
    selectors: ['.anim-blink'],
    description: 'Animation: Blink (hard on/off)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-blink 1.5s infinite ease-in-out' },
      { id: generateId(), property: '--kf-blink-min', value: '0.4' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-pulse'],
    description: 'Animation: Pulse (subtle opacity throb)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-pulse 2s infinite ease-in-out' },
      { id: generateId(), property: '--kf-pulse-min', value: '0.6' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-fade-in'],
    description: 'Animation: Fade in (one-shot)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-fade-in 1.5s ease-out both' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-fade-out'],
    description: 'Animation: Fade out (one-shot)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-fade-out 1.5s ease-in both' },
    ],
  },

  // -- Scale (centre-pivoted) --
  {
    id: generateId(),
    selectors: ['.anim-beat'],
    description: 'Animation: Heartbeat (scale from centre)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-beat 1.5s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-beat-scale', value: '1.15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-pop-in'],
    description: 'Animation: Pop in (appear with overshoot, one-shot)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-pop-in 0.6s ease-out both' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-inflate'],
    description: 'Animation: Inflate and rise (balloon)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-inflate-rise 2.5s infinite ease-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-inflate-scale', value: '1.3' },
      { id: generateId(), property: '--kf-inflate-rise', value: '15' },
    ],
  },

  // -- Rotation (centre-pivoted unless noted) --
  {
    id: generateId(),
    selectors: ['.anim-swing'],
    description: 'Animation: Swing (rotate around centre)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-swing 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-swing-angle', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-rock'],
    description: 'Animation: Pendulum rock (pivots at TOP edge)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-rock 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center top' },
      { id: generateId(), property: '--kf-rock-angle', value: '25' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-spin-cw'],
    description: 'Animation: Full rotation clockwise (centre)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-spin-cw 3s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-spin-ccw'],
    description: 'Animation: Full rotation counter-clockwise (centre)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-spin-ccw 3s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },

  // -- Translation (origin-independent; fill-box kept for consistency) --
  {
    id: generateId(),
    selectors: ['.anim-slide-r'],
    description: 'Animation: Slide horizontal',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-slide-r 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-slide-r-dist', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-slide-u'],
    description: 'Animation: Slide vertical',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-slide-u 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-slide-u-dist', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-float'],
    description: 'Animation: Float (gentle levitation)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-float 3s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-float-h', value: '14' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-bounce'],
    description: 'Animation: Bounce (squash anchored to BOTTOM edge)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-bounce 1.5s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center bottom' },
      { id: generateId(), property: '--kf-bounce-h', value: '25' },
    ],
  },

  // -- Agitation --
  {
    id: generateId(),
    selectors: ['.anim-shake'],
    description: 'Animation: Shake (horizontal vibration)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-shake 0.6s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-shake-amp', value: '8' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-tremble'],
    description: 'Animation: Tremble (micro-vibration, fear/cold)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-tremble 0.15s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-tremble-amp', value: '3' },
    ],
  },

  // -- Directional gestures --
  {
    id: generateId(),
    selectors: ['.anim-gesture-r'],
    description: 'Animation: Gesture right (ease-out exit)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-gesture-r 1.5s infinite ease-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-gesture-r-dist', value: '30' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-gesture-l'],
    description: 'Animation: Gesture left (ease-out exit)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-gesture-l 1.5s infinite ease-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-gesture-l-dist', value: '30' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-gesture-d'],
    description: 'Animation: Gesture down (falling ease-in)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-gesture-d 1.5s infinite ease-in' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-gesture-d-dist', value: '25' },
    ],
  },

  // -- Communicative gestures --
  {
    id: generateId(),
    selectors: ['.anim-nod-yes'],
    description: 'Animation: Nod yes (vertical affirmation)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-nod-yes 1s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-nod-yes-d', value: '8' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-nod-no'],
    description: 'Animation: Nod no (horizontal denial)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-nod-no 0.8s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-nod-no-d', value: '8' },
    ],
  },
];
