import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Square, Circle, Triangle, Slash, Activity, Heart } from 'lucide-react';
import { StyleDefinition, CssRule, ShapeType, KeyframeDefinition } from '../types';
import { SVG_CSS_PROPERTIES } from '../utils/svgProperties';
import { useDialogA11y } from '../../../../hooks/useDialogA11y';
import { generateId } from '../constants';

interface Props {
  styleDef: StyleDefinition | null;
  isOpen: boolean;
  onClose: () => void;
  onSave: (updated: StyleDefinition) => void;
  onDelete: (id: string) => void;
  currentShape?: ShapeType;
  keyframes?: KeyframeDefinition[];
}

const UNITS = ['px', '%', 'em', 'rem', 'pt', 'pc', 'vh', 'vw', 'deg', ''];
const COLOR_PROPS = ['fill', 'stroke', 'color', 'stop-color', 'flood-color', 'lighting-color'];
const NUMERIC_PROPS = ['stroke-width', 'stroke-miterlimit', 'stroke-dashoffset', 'opacity', 'fill-opacity', 'stroke-opacity', 'font-size', 'r', 'cx', 'cy', 'x', 'y', 'width', 'height'];

const ALL_SHAPES: ShapeType[] = ['square', 'circle', 'triangle', 'line', 'path', 'heart'];

const shapeIcons: Record<ShapeType, React.ComponentType<{ size?: number }>> = {
  square: Square,
  circle: Circle,
  triangle: Triangle,
  line: Slash,
  path: Activity,
  heart: Heart,
};

const EditModal: React.FC<Props> = ({ styleDef, isOpen, onClose, onSave, onDelete, currentShape = 'square', keyframes }) => {
  const { dialogProps } = useDialogA11y({ isOpen, onClose, label: styleDef ? `Edit: ${styleDef.selectors.join(', ')}` : 'New class' });
  const [selectors, setSelectors] = useState('');
  const [rules, setRules] = useState<CssRule[]>([]);
  const [description, setDescription] = useState('');
  const [localShape, setLocalShape] = useState<ShapeType>(currentShape);

  useEffect(() => {
    if (styleDef) {
      setSelectors(styleDef.selectors.join(', '));
      setRules(styleDef.rules);
      setDescription(styleDef.description || '');
    } else {
      setSelectors('.new-style');
      setRules([{ id: generateId(), property: 'fill', value: '#000000' }]);
      setDescription('');
    }
    setLocalShape(currentShape);
  }, [styleDef, isOpen, currentShape]);

  if (!isOpen) return null;

  // --- Helper Logic for Values ---

  const handleRuleChange = (id: string, field: 'property' | 'value', text: string) => {
    setRules(prev => prev.map(r => r.id === id ? { ...r, [field]: text } : r));
  };

  const addRule = () => {
    setRules(prev => [...prev, { id: generateId(), property: '', value: '' }]);
  };

  const removeRule = (id: string) => {
    setRules(prev => prev.filter(r => r.id !== id));
  };

  const handleSave = () => {
    const cleanedSelectors = selectors.split(',').map(s => s.trim()).filter(s => s.length > 0);
    const cleanedRules = rules.filter(r => r.property.trim() !== '');

    onSave({
      id: styleDef ? styleDef.id : generateId(),
      selectors: cleanedSelectors,
      rules: cleanedRules,
      description
    });
    onClose();
  };

  // --- Keyframe parameter detection ---

  const animRule = rules.find(r => r.property === 'animation' || r.property === 'animation-name');
  const animName = animRule ? animRule.value.trim().split(/\s+/)[0] : null;
  const detectedKeyframe = animName && keyframes
    ? keyframes.find(kf => kf.name === animName && kf.parameters?.length)
    : null;
  const keyframeParams = detectedKeyframe?.parameters ?? [];

  const getParamValue = (variable: string, defaultVal: number): number => {
    const rule = rules.find(r => r.property === variable);
    return rule ? (parseFloat(rule.value) || defaultVal) : defaultVal;
  };

  const handleParamChange = (variable: string, value: number) => {
    setRules(prev => {
      const exists = prev.find(r => r.property === variable);
      if (exists) {
        return prev.map(r => r.property === variable ? { ...r, value: String(value) } : r);
      }
      return [...prev, { id: generateId(), property: variable, value: String(value) }];
    });
  };

  // --- Preview Logic ---

  const toCamelCase = (s: string) => s.replace(/-./g, x => x[1].toUpperCase());

  const previewStyle: React.CSSProperties = {};
  rules.forEach(r => {
    if (r.property && r.value) {
      if (r.property.startsWith('--')) {
        // CSS custom properties must be assigned directly (camelCase would mangle them)
        (previewStyle as any)[r.property] = r.value;
      } else {
        // @ts-ignore - Dynamic style assignment
        previewStyle[toCamelCase(r.property)] = r.value;
      }
    }
  });

  const hasFill = rules.some(r => r.property.toLowerCase() === 'fill' && r.value.trim() !== '');

  const renderPreviewShape = () => {
    const commonProps = {
      className: "transition-all duration-300",
      style: previewStyle,
      ...((!hasFill) && { fill: 'url(#preview-gray-pattern)', stroke: '#999', strokeWidth: 1 })
    };

    switch (localShape) {
      case 'circle': return <circle cx="50" cy="50" r="35" {...commonProps} />;
      case 'triangle': return <polygon points="50,15 85,80 15,80" {...commonProps} />;
      case 'line': return <line x1="15" y1="15" x2="85" y2="85" {...commonProps} />;
      case 'path': return <path d="M 26.79,48.39 C 19.17,37.49 13.22,32.84 21.63,24.72 36.85,10.00 48.35,14.05 55.73,24.60 61.98,33.52 50.00,39.42 60.18,44.99 70.26,50.50 67.33,30.93 79.05,30.81 86.78,30.73 83.89,57.58 83.74,63.50 83.50,72.29 77.42,90.00 67.92,81.20 56.91,71.01 53.03,70.18 47.76,73.11 42.49,76.04 34.64,85.18 34.64,85.18 L 14.13,62.10 Z" {...commonProps} />;
      case 'heart': return <path d="M 50 30 C 50 22 58 12 70 14 C 83 16 88 30 84 44 C 80 58 50 80 50 80 C 50 80 20 58 16 44 C 12 30 17 16 30 14 C 42 12 50 22 50 30 Z" {...commonProps} />;
      case 'square':
      default: return <rect x="15" y="15" width="70" height="70" rx="0" {...commonProps} />;
    }
  };

  // --- Input Renderers ---

  const renderValueInput = (rule: CssRule) => {
    const prop = rule.property.toLowerCase().trim();

    if (COLOR_PROPS.includes(prop)) {
      const isHex = /^#[0-9A-F]{6}$/i.test(rule.value);
      const fallbackColor = isHex ? rule.value : '#000000';

      return (
        <div className="flex-1 flex gap-2">
           <div className="relative w-10 h-10 flex-none overflow-hidden rounded-md border border-gray-300 shadow-sm cursor-pointer">
             <input
               type="color"
               value={fallbackColor}
               onChange={(e) => handleRuleChange(rule.id, 'value', e.target.value)}
               className="absolute -top-2 -left-2 w-16 h-16 cursor-pointer p-0 border-0"
             />
           </div>
           <input
             type="text"
             value={rule.value}
             onChange={(e) => handleRuleChange(rule.id, 'value', e.target.value)}
             className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-md font-mono text-sm focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
             placeholder="#000000 or red"
           />
        </div>
      );
    }

    if (NUMERIC_PROPS.includes(prop)) {
      const match = rule.value.match(/^([+-]?\d*\.?\d+)(.*)$/);
      const numVal = match ? match[1] : rule.value;
      const unitVal = match ? match[2] : '';

      const updateCombined = (n: string, u: string) => {
        handleRuleChange(rule.id, 'value', `${n}${u}`);
      };

      return (
        <div className="flex-1 flex gap-2">
          <input
            type="number"
            value={numVal}
            onChange={(e) => updateCombined(e.target.value, unitVal)}
            className="flex-1 min-w-0 p-2 bg-gray-50 border border-gray-200 rounded-md font-mono text-sm focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
            placeholder="0"
          />
          <select
            value={unitVal}
            onChange={(e) => updateCombined(numVal, e.target.value)}
            className="w-20 p-2 bg-gray-100 border border-gray-200 rounded-md text-sm font-mono focus:bg-white outline-none"
          >
             {UNITS.map(u => <option key={u} value={u}>{u || '-'}</option>)}
          </select>
        </div>
      );
    }

    return (
      <input
        type="text"
        value={rule.value}
        onChange={(e) => handleRuleChange(rule.id, 'value', e.target.value)}
        placeholder="value"
        className="flex-1 p-2 bg-gray-50 border border-gray-200 rounded-md font-mono text-sm focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
      />
    );
  };

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center overflow-y-auto py-10 px-[10vw]">
      <div
        id="style-edit-modal-backdrop"
        className="absolute inset-0 bg-gray-900/40 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      <div id="style-edit-modal" className="relative w-full max-w-3xl bg-white rounded-2xl shadow-2xl overflow-hidden flex flex-col min-h-[80vh]" {...dialogProps}>

        {/* Header */}
        <div id="style-edit-modal-header" className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <h2 className="text-lg font-bold text-gray-800">
            {styleDef ? `Editar: ${selectors}` : 'Nueva clase'}
          </h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-200 rounded-full text-gray-500">
            <X size={20} />
          </button>
        </div>

        {/* Body: Editor LEFT + Preview RIGHT */}
        <div className="flex flex-1 overflow-hidden">

          {/* LEFT: Editor */}
          <div className="flex-1 flex flex-col overflow-hidden">

            {/* Scrollable Form */}
            <div className="p-6 overflow-y-auto flex-1 space-y-6">

              {/* Meta Info */}
              <div id="style-edit-modal-selectors" className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Selectores
                  </label>
                  <input
                    type="text"
                    value={selectors}
                    onChange={(e) => setSelectors(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-lg font-mono text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder=".class-name"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">
                    Descripción
                  </label>
                  <input
                    type="text"
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full p-3 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                    placeholder="Descripción opcional"
                  />
                </div>
              </div>

              {/* Rules Editor */}
              <div id="style-edit-modal-properties">
                <div className="flex justify-between items-center mb-2">
                  <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    Propiedades CSS
                  </label>
                  <button
                    onClick={addRule}
                    className="text-xs flex items-center gap-1 text-blue-600 hover:text-blue-700 font-medium"
                  >
                    <Plus size={14} /> Agregar
                  </button>
                </div>

                <div className="space-y-3">
                  {rules.map((rule) => (
                    <div key={rule.id} className="flex gap-2 items-center group bg-white">
                      <div className="w-1/3 min-w-[120px]">
                        <input
                          type="text"
                          list="svg-property-list"
                          value={rule.property}
                          onChange={(e) => handleRuleChange(rule.id, 'property', e.target.value)}
                          placeholder="property"
                          className="w-full p-2 bg-gray-50 border border-gray-200 rounded-md font-mono text-sm focus:bg-white focus:ring-1 focus:ring-blue-500 outline-none"
                        />
                      </div>
                      <span className="text-gray-500 font-mono">:</span>

                      {renderValueInput(rule)}

                      <span className="text-gray-500 font-mono">;</span>
                      <button
                        onClick={() => removeRule(rule.id)}
                        className="p-2 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))}

                  {rules.length === 0 && (
                    <div className="text-center py-8 text-gray-500 text-sm italic border-2 border-dashed border-gray-100 rounded-xl">
                      Sin propiedades CSS definidas.
                    </div>
                  )}
                </div>
              </div>

              <datalist id="svg-property-list">
                {SVG_CSS_PROPERTIES.map(prop => (
                  <option key={prop} value={prop} />
                ))}
              </datalist>

            </div>

            {/* Footer */}
            <div id="style-edit-modal-footer" className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex justify-between items-center">
              {styleDef ? (
                 <button
                   onClick={() => { onDelete(styleDef.id); onClose(); }}
                   className="text-red-500 text-sm font-medium hover:text-red-600 flex items-center gap-1 px-3 py-2 rounded hover:bg-red-50"
                 >
                   <Trash2 size={16} /> Eliminar
                 </button>
              ) : <div />}

              <div className="flex gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleSave}
                  className="px-6 py-2 bg-slate-900 text-white font-medium rounded-lg hover:bg-slate-800 transition-colors"
                >
                  Guardar
                </button>
              </div>
            </div>

          </div>

          {/* RIGHT: Preview */}
          <div id="style-edit-modal-preview" className="w-56 flex-none bg-gray-100 border-l border-gray-200 p-4 flex flex-col items-center gap-4 overflow-y-auto">
            <h3 className="text-xs font-bold text-gray-500 uppercase tracking-wider self-start">Vista previa</h3>

            {/* Keyframe parameter sliders */}
            {keyframeParams.length > 0 && (
              <div className="w-full space-y-3">
                <span className="text-xs font-bold text-gray-500 uppercase tracking-wider block">Parámetros</span>
                {keyframeParams.map(param => {
                  const val = getParamValue(param.variable, param.default);
                  const stepVal = param.step ?? (param.unit === '' ? 0.05 : 1);
                  return (
                    <div key={param.variable} className="space-y-1">
                      <div className="flex justify-between items-baseline">
                        <label className="text-xs text-gray-500 font-medium">{param.label}</label>
                        <span className="text-xs font-mono text-gray-500">{val}{param.unit}</span>
                      </div>
                      <input
                        type="range"
                        min={param.min}
                        max={param.max}
                        step={stepVal}
                        value={val}
                        onChange={e => handleParamChange(param.variable, parseFloat(e.target.value))}
                        className="w-full h-1 accent-blue-600 cursor-pointer"
                      />
                    </div>
                  );
                })}
              </div>
            )}

            {/* Shape selector */}
            <div className="flex flex-wrap gap-1 justify-center">
              {ALL_SHAPES.map((shape) => {
                const Icon = shapeIcons[shape];
                return (
                  <button
                    key={shape}
                    onClick={() => setLocalShape(shape)}
                    title={shape}
                    className={`p-1.5 rounded-md transition-all ${localShape === shape ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                  >
                    <Icon size={14} />
                  </button>
                );
              })}
            </div>

            {/* SVG Preview */}
            <div className="w-36 h-36 bg-gray-200 rounded-xl shadow-inner border border-gray-300 flex items-center justify-center overflow-hidden">
              <svg width="100%" height="100%" viewBox="0 0 100 100" className="overflow-visible">
                <defs>
                  <pattern id="preview-gray-pattern" x="0" y="0" width="8" height="8" patternUnits="userSpaceOnUse">
                    <rect width="8" height="8" fill="#e5e7eb" />
                    <path d="M-1,1 l2,-2 M0,8 l8,-8 M7,9 l2,-2" stroke="#d1d5db" strokeWidth="1" />
                  </pattern>
                </defs>
                {renderPreviewShape()}
              </svg>
            </div>

            <p className="text-xs font-mono text-gray-500 text-center break-all leading-relaxed">
              {selectors || 'sin selector'}
            </p>
          </div>

        </div>
      </div>
    </div>
  );
};

export default EditModal;
