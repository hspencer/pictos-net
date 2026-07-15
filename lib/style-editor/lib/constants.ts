import { StyleDefinition } from './types';

// Simple ID generator to avoid external dependencies in this specific output format
export const generateId = () => Math.random().toString(36).substr(2, 9);

export const INITIAL_STYLES: StyleDefinition[] = [
  {
    id: generateId(),
    selectors: ['.main', '.primary', '.foreground'],
    description: 'Primary dark fill with white outline',
    rules: [
      { id: generateId(), property: 'fill', value: '#1a1a1a' },
      { id: generateId(), property: 'stroke', value: '#ffffff' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.secondary', '.background'],
    description: 'Secondary white fill with dark outline',
    rules: [
      { id: generateId(), property: 'fill', value: '#ffffff' },
      { id: generateId(), property: 'stroke', value: '#1a1a1a' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.tertiary', '.neutral'],
    description: 'Tertiary gray fill',
    rules: [
      { id: generateId(), property: 'fill', value: '#98a0ae' },
      { id: generateId(), property: 'stroke', value: '#7e838b' },
      { id: generateId(), property: 'stroke-width', value: '3pt' },
      { id: generateId(), property: 'vector-effect', value: 'non-scaling-stroke' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.accent', '.highlight'],
    description: 'Cyan accent color',
    rules: [
      { id: generateId(), property: 'fill', value: '#00ccff' },
      { id: generateId(), property: 'stroke', value: '#06a0c6' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.red', '.danger'],
    description: 'Semantic Red',
    rules: [
      { id: generateId(), property: 'fill', value: '#ef4444' },
      { id: generateId(), property: 'stroke', value: '#b91c1c' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.green', '.success'],
    description: 'Semantic Green',
    rules: [
      { id: generateId(), property: 'fill', value: '#22c55e' },
      { id: generateId(), property: 'stroke', value: '#15803d' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.w', '.white'],
    description: 'White fill, no stroke',
    rules: [
      { id: generateId(), property: 'fill', value: '#ffffff' },
      { id: generateId(), property: 'stroke', value: 'none' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.glow'],
    description: 'Effect: Blue Glow',
    rules: [
      { id: generateId(), property: 'filter', value: 'drop-shadow(0 0 4pt #0ea5e9)' },
      { id: generateId(), property: 'stroke', value: 'none' },
    ],
  },
  // === SEMANTIC SIGNALS ===
  {
    id: generateId(),
    selectors: ['.warning', '.caution'],
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

  // === SKIN TONES ===
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

  // === EARTH & NATURE ===
  {
    id: generateId(),
    selectors: ['.sienna'],
    description: 'Earth: Burnt sienna',
    rules: [
      { id: generateId(), property: 'fill', value: '#a0522d' },
      { id: generateId(), property: 'stroke', value: '#6b371e' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.leaf', '.vegetation'],
    description: 'Nature: Leaf green',
    rules: [
      { id: generateId(), property: 'fill', value: '#4d7c0f' },
      { id: generateId(), property: 'stroke', value: '#365314' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.sky'],
    description: 'Nature: Sky blue',
    rules: [
      { id: generateId(), property: 'fill', value: '#7dd3fc' },
      { id: generateId(), property: 'stroke', value: '#38bdf8' },
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

  // === SHADOWS & DEPTH ===
  {
    id: generateId(),
    selectors: ['.shadow'],
    description: 'Shadow: Neutral mid-gray',
    rules: [
      { id: generateId(), property: 'fill', value: '#6b7280' },
      { id: generateId(), property: 'stroke', value: 'none' },
      { id: generateId(), property: 'opacity', value: '0.5' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.shadow-warm'],
    description: 'Shadow: Warm brown-gray',
    rules: [
      { id: generateId(), property: 'fill', value: '#78716c' },
      { id: generateId(), property: 'stroke', value: 'none' },
      { id: generateId(), property: 'opacity', value: '0.4' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.gray-light'],
    description: 'Gray: Light (background planes)',
    rules: [
      { id: generateId(), property: 'fill', value: '#d1d5db' },
      { id: generateId(), property: 'stroke', value: '#9ca3af' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.gray-mid'],
    description: 'Gray: Medium (secondary elements)',
    rules: [
      { id: generateId(), property: 'fill', value: '#6b7280' },
      { id: generateId(), property: 'stroke', value: '#4b5563' },
    ],
  },

  // === MATERIALS ===
  {
    id: generateId(),
    selectors: ['.gold', '.metallic-gold'],
    description: 'Material: Gold',
    rules: [
      { id: generateId(), property: 'fill', value: '#d4a017' },
      { id: generateId(), property: 'stroke', value: '#a07c12' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.copper'],
    description: 'Material: Copper',
    rules: [
      { id: generateId(), property: 'fill', value: '#b87333' },
      { id: generateId(), property: 'stroke', value: '#8a5524' },
    ],
  },

  // === ADDITIONAL CHROMATIC ===
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
    selectors: ['.purple', '.violet'],
    description: 'Chromatic: Purple',
    rules: [
      { id: generateId(), property: 'fill', value: '#a855f7' },
      { id: generateId(), property: 'stroke', value: '#7e22ce' },
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
    selectors: ['.teal'],
    description: 'Chromatic: Teal',
    rules: [
      { id: generateId(), property: 'fill', value: '#14b8a6' },
      { id: generateId(), property: 'stroke', value: '#0f766e' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.navy', '.blue-dark'],
    description: 'Chromatic: Navy blue',
    rules: [
      { id: generateId(), property: 'fill', value: '#12379b' },
      { id: generateId(), property: 'stroke', value: '#0c2568' },
    ],
  },

  // === STROKE MODIFIERS ===
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
    description: 'Stroke modifier: Light',
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
    selectors: ['.dashed'],
    description: 'Stroke modifier: Dashed Round',
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

  // === EFFECTS ===
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
    selectors: ['.flat'],
    description: 'Effect: Flat (no stroke, no effects)',
    rules: [
      { id: generateId(), property: 'stroke', value: 'none' },
      { id: generateId(), property: 'filter', value: 'none' },
    ],
  },

  // Animations
  {
    id: generateId(),
    selectors: ['.anim-blink'],
    description: 'Animation: Blink',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-blink 1.5s infinite ease-in-out' },
      { id: generateId(), property: '--kf-blink-min', value: '0.4' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-beat'],
    description: 'Animation: Heartbeat',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-beat 1.5s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-beat-scale', value: '1.15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.anim-swing'],
    description: 'Animation: Swing',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-swing 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-swing-angle', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.slide-r'],
    description: 'Animation: Slide Horizontal',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-slide-r 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-slide-r-dist', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.slide-u'],
    description: 'Animation: Slide Vertical',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-slide-u 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-slide-u-dist', value: '15' },
    ],
  },

  // -- Rotations --
  {
    id: generateId(),
    selectors: ['.spin-cw'],
    description: 'Animation: Full rotation clockwise',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-spin-cw 3s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.spin-ccw'],
    description: 'Animation: Full rotation counter-clockwise',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-spin-ccw 3s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.rock'],
    description: 'Animation: Pendulum rock (partial rotation)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-rock 2s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center top' },
      { id: generateId(), property: '--kf-rock-angle', value: '25' },
    ],
  },

  // -- Directional gestures --
  {
    id: generateId(),
    selectors: ['.gesture-r'],
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
    selectors: ['.gesture-l'],
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
    selectors: ['.gesture-d'],
    description: 'Animation: Gesture down (falling ease-in)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-gesture-d 1.5s infinite ease-in' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-gesture-d-dist', value: '25' },
    ],
  },

  // -- Scale & presence --
  {
    id: generateId(),
    selectors: ['.inflate-rise'],
    description: 'Animation: Inflate and rise (balloon)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-inflate-rise 2.5s infinite ease-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-inflate-scale', value: '1.3' },
      { id: generateId(), property: '--kf-inflate-rise', value: '15' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.pop-in'],
    description: 'Animation: Pop in (appear with overshoot)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-pop-in 0.6s ease-out both' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.pulse'],
    description: 'Animation: Pulse (subtle opacity throb)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-pulse 2s infinite ease-in-out' },
      { id: generateId(), property: '--kf-pulse-min', value: '0.6' },
    ],
  },

  // -- Agitation & emphasis --
  {
    id: generateId(),
    selectors: ['.shake'],
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
    selectors: ['.tremble'],
    description: 'Animation: Tremble (micro-vibration, fear/cold)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-tremble 0.15s infinite linear' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-tremble-amp', value: '3' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.bounce'],
    description: 'Animation: Bounce (elastic vertical)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-bounce 1.5s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center bottom' },
      { id: generateId(), property: '--kf-bounce-h', value: '25' },
    ],
  },
  {
    id: generateId(),
    selectors: ['.float'],
    description: 'Animation: Float (gentle levitation)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-float 3s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-float-h', value: '14' },
    ],
  },

  // -- Communicative gestures --
  {
    id: generateId(),
    selectors: ['.nod-yes'],
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
    selectors: ['.nod-no'],
    description: 'Animation: Nod no (horizontal denial)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-nod-no 0.8s infinite ease-in-out' },
      { id: generateId(), property: 'transform-box', value: 'fill-box' },
      { id: generateId(), property: 'transform-origin', value: 'center' },
      { id: generateId(), property: '--kf-nod-no-d', value: '8' },
    ],
  },

  // -- Transitions (one-shot) --
  {
    id: generateId(),
    selectors: ['.fade-in'],
    description: 'Animation: Fade in (one-shot)',
    rules: [
      { id: generateId(), property: 'animation', value: 'kf-fade-in 1.5s ease-out both' },
    ],
  },
];
