
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Upload, Download, Trash2, Terminal, RefreshCw, ChevronDown,
  Play, BookOpen, Search, FileDown, Square, Sliders,
  X, Code, Plus, FileText, Maximize, Copy, BrainCircuit, PlusCircle, CornerDownRight, Image as ImageIcon,
  Library, ScreenShare, Globe, Hexagon, HelpCircle, CheckCircle, ExternalLink, Palette, GripVertical, ImageUp
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RowData, LogEntry, StepStatus, NLUData, GlobalConfig, VOCAB, VisualElement, EvaluationMetrics, NLUFrameRole } from './types';
import * as Gemini from './services/geminiService';
import { ICAP_MODULE_FALLBACK, fetchICAPModule } from './data/canonicalData';
import { useTranslation } from './hooks/useTranslation';
import type { Locale } from './locales';
import { SVGGenerator } from './components/SVGGenerator';
import { SVGThumbnail } from './components/SVGThumbnail';
import useSVGLibrary from './hooks/useSVGLibrary';
import { StyleEditor } from './components/PictoForge/StyleEditor';
import { structureSVG } from './services/svgStructureService';
import { vectorizeBitmap } from './services/vtracerService';
import { GeoAutocomplete } from './components/GeoAutocomplete';
import * as IndexedDBService from './services/indexedDBService';

const STORAGE_KEY = 'pictonet_v19_storage';
const CONFIG_KEY = 'pictonet_v19_config';
const APP_VERSION = '1.0.0';

interface LibraryMetadata {
  filename: string;
  name: string;
  location: string;
  language: string;
  items: number;
  description?: string;
}

// Helper function to ensure elements is always a valid array
const ensureElementsArray = (elements: any): VisualElement[] => {
  if (Array.isArray(elements)) {
    return elements;
  }
  console.warn('[VALIDATION] Invalid elements type, returning empty array:', typeof elements, elements);
  return [];
};

// Helper function to sanitize filename for downloads
const sanitizeFilename = (text: string, maxLength: number = 30): string => {
  return text
    .normalize('NFD') // Decompose accented characters
    .replace(/[\u0300-\u036f]/g, '') // Remove diacritics
    .replace(/[^a-z0-9]/gi, '_') // Replace non-alphanumeric with underscore
    .replace(/_+/g, '_') // Collapse multiple underscores
    .replace(/^_|_$/g, '') // Remove leading/trailing underscores
    .substring(0, maxLength)
    .toLowerCase();
};

const LogoIcon = ({ size = 32 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 45.9 45.9" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style>{`.st0 { fill: #40069e; }`}</style>
    </defs>
    <circle className="st0" cx="23.9" cy="17.8" r="3.1"/>
    <path className="st0" d="M23.6,4c-9.4,0-17.1,6.3-17.1,14.1s0,0,0,0c0,0,0,0,0,0v19.7c0,2.1,1.7,3.9,3.9,3.9h1.6c2.1,0,3.9-1.7,3.9-3.9v-7.3c2.3,1,4.9,1.5,7.7,1.5,9.4,0,17.1-6.3,17.1-14.1S33,4,23.6,4ZM23.9,24.5c-6.4,0-9.2-6.4-9.2-6.4,0,0,2.8-6.4,9.2-6.4s9.2,6.4,9.2,6.4c0,0-2.8,6.4-9.2,6.4Z"/>
  </svg>
);

// Helper function to get evaluation score total and color
const getEvaluationScore = (metrics: EvaluationMetrics | undefined): { total: number; average: number; color: string } => {
  if (!metrics) return { total: 0, average: 0, color: '#64748b' };
  const { clarity, recognizability, semantic_transparency, pragmatic_fit, cultural_adequacy, cognitive_accessibility } = metrics;
  const total = clarity + recognizability + semantic_transparency + pragmatic_fit + cultural_adequacy + cognitive_accessibility;
  const average = total / 6;

  // Color mapping based on average score (1-5 scale)
  let color = '#64748b'; // default gray
  if (average >= 4.5) color = '#22c55e'; // verde oscuro (5)
  else if (average >= 3.5) color = '#84cc16'; // verde limón (4)
  else if (average >= 2.5) color = '#eab308'; // amarillo (3)
  else if (average >= 1.5) color = '#f97316'; // naranjo (2)
  else color = '#ef4444'; // rojo (1)

  return { total, average, color };
};

// --- Hexagon Visualization Component (1-5 Scale) ---
const HexagonChart: React.FC<{ metrics: EvaluationMetrics; size?: number }> = ({ metrics, size = 180 }) => {
  const center = size / 2;
  const radius = size * 0.40;

  // Aligned with official ICAP schema (mediafranca/ICAP)
  // Order: Clarity, Recognizability, Semantic Transparency, Pragmatic Fit, Cultural Adequacy, Cognitive Accessibility
  const axes = ['clarity', 'recognizability', 'semantic_transparency', 'pragmatic_fit', 'cultural_adequacy', 'cognitive_accessibility'];
  const labels = ['CLA', 'REC', 'SEM', 'PRA', 'CUL', 'COG'];

  const getPoint = (value: number, index: number) => {
    // Value is 1-5. 
    // 0 would be center. 5 is radius.
    const normalized = value / 5;
    const angle = (Math.PI / 3) * index - Math.PI / 2;
    const r = normalized * radius;
    const x = center + r * Math.cos(angle);
    const y = center + r * Math.sin(angle);
    return { x, y };
  };

  const points = axes.map((axis, i) => {
    // @ts-ignore
    const val = metrics[axis] || 0;
    const { x, y } = getPoint(val, i);
    return `${x},${y}`;
  }).join(' ');

  // Generate grid rings for 1, 2, 3, 4, 5
  const rings = [1, 2, 3, 4, 5].map(level => {
    return axes.map((_, i) => {
      const { x, y } = getPoint(level, i);
      return `${x},${y}`;
    }).join(' ');
  });

  const average = useMemo(() => {
    let sum = 0;
    axes.forEach(a => sum += ((metrics as any)[a] || 0));
    return (sum / 6).toFixed(1);
  }, [metrics]);

  return (
    <div className="relative flex flex-col items-center justify-center">
      <svg width={size} height={size} className="overflow-visible">
        {/* Grid Rings */}
        {rings.map((ringPoints, i) => (
          <polygon
            key={i}
            points={ringPoints}
            fill={i === 4 ? "#f8fafc" : "none"}
            stroke={i === 4 ? "#cbd5e1" : "#e2e8f0"}
            strokeWidth="1"
            strokeDasharray={i === 4 ? "0" : "2 2"}
          />
        ))}

        {/* Data Hexagon */}
        <polygon points={points} fill="rgba(76, 29, 149, 0.2)" stroke="#4c1d95" strokeWidth="2" />

        {/* Labels */}
        {axes.map((_, i) => {
          const labelAngle = (Math.PI / 3) * i - Math.PI / 2;
          const lx = center + (radius + 15) * Math.cos(labelAngle);
          const ly = center + (radius + 15) * Math.sin(labelAngle);
          return (
            <text key={i} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" fontSize={size * 0.05} fontWeight="bold" fill="#64748b">
              {labels[i]}
            </text>
          );
        })}
      </svg>
      <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <div className="text-center">
          <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">ICAP</div>
          <div className="text-2xl font-bold text-violet-950 leading-none">{average}</div>
        </div>
      </div>
    </div>
  );
};

// --- Evaluation Editor Component (Likert 1-5) ---
// ICAP Help Modal Component
const ICAPHelpModal: React.FC<{
  dimension: string;
  onClose: () => void;
}> = ({ dimension, onClose }) => {
  const { t, lang } = useTranslation();
  const [rubricData, setRubricData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    // Load from remote ICAP repository (GitHub Pages)
    fetch('https://mediafranca.github.io/ICAP/data/rubric-scale-descriptions.json')
      .then(res => {
        if (!res.ok) throw new Error('Failed to fetch');
        return res.json();
      })
      .then(data => {
        setRubricData(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Error loading ICAP rubric:', err);
        setError(true);
        setLoading(false);
      });
  }, []);

  const langSuffix = lang === 'en-GB' ? '_en' : '_es';
  const dimensionData = rubricData?.dimensions?.[dimension];
  const scale = rubricData?.scale;

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 animate-in fade-in" onClick={onClose}>
      <div className="bg-white rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden animate-in zoom-in-95 slide-in-from-bottom-4" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="bg-violet-950 text-white p-6 flex items-center justify-between">
          <div>
            <h3 className="text-xl font-bold">{t('evaluation.helpTitle', { dimension: dimensionData?.[`name${langSuffix}`] || dimension })}</h3>
            <p className="text-sm text-violet-200 mt-1">{dimensionData?.[`description${langSuffix}`]}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-violet-900 rounded-full transition-colors">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto max-h-[calc(80vh-120px)]">
          {loading && (
            <div className="text-center py-12 text-slate-400">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-violet-600 mx-auto mb-4"></div>
              {t('evaluation.loading')}
            </div>
          )}

          {error && (
            <div className="text-center py-12 text-rose-600">
              <HelpCircle size={48} className="mx-auto mb-4 opacity-50" />
              {t('evaluation.errorLoading')}
            </div>
          )}

          {!loading && !error && dimensionData && scale && (
            <div className="space-y-6">
              {[5, 4, 3, 2, 1].map((level) => {
                const levelData = dimensionData.levels?.[level];
                const scaleData = scale[level];
                if (!levelData) return null;

                return (
                  <div key={level} className="border-l-4 pl-4 py-2" style={{ borderColor: scaleData.color }}>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-2xl font-black text-slate-800">{level}</span>
                      <div>
                        <div className="text-sm font-bold uppercase tracking-wider" style={{ color: scaleData.color }}>
                          {scaleData[`label${langSuffix}`]}
                        </div>
                        <div className="text-xs text-slate-500">{scaleData[`general${langSuffix}`]}</div>
                      </div>
                    </div>
                    <p className="text-sm text-slate-700 leading-relaxed">
                      {levelData[`text${langSuffix}`]}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="bg-slate-50 px-6 py-4 border-t flex justify-between items-center">
          <a
            href="https://mediafranca.github.io/ICAP/examples/hexagonal-rating-with-descriptions.html"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-violet-600 hover:text-violet-800 transition-colors flex items-center gap-1"
          >
            <ExternalLink size={12} />
            Ver guía completa ICAP
          </a>
          <button onClick={onClose} className="px-4 py-2 bg-violet-600 text-white rounded-md hover:bg-violet-700 transition-colors text-sm font-medium">
            {t('actions.cancel')}
          </button>
        </div>
      </div>
    </div>
  );
};

const EvaluationEditor: React.FC<{
  metrics: EvaluationMetrics | undefined;
  onUpdate: (m: EvaluationMetrics) => void;
  compact?: boolean; // New prop for modal view
}> = ({ metrics, onUpdate, compact = false }) => {
  const { t } = useTranslation();
  const [helpDimension, setHelpDimension] = useState<string | null>(null);

  // Default state: 3 (Neutral)
  const current = metrics || {
    clarity: 3,
    recognizability: 3,
    semantic_transparency: 3,
    pragmatic_fit: 3,
    cultural_adequacy: 3,
    cognitive_accessibility: 3,
    reasoning: ''
  };

  const handleChange = (key: keyof EvaluationMetrics, value: any) => {
    onUpdate({ ...current, [key]: value });
  };

  // Aligned with official ICAP schema (mediafranca/ICAP)
  const axes = [
    { key: 'clarity', label: t('evaluation.clarity'), desc: t('icap.descriptions.clarity'), icapKey: 'clarity' },
    { key: 'recognizability', label: t('evaluation.recognizability'), desc: t('icap.descriptions.recognizability'), icapKey: 'recognizability' },
    { key: 'semantic_transparency', label: t('evaluation.semantic_transparency'), desc: t('icap.descriptions.semantic_transparency'), icapKey: 'semantic_transparency' },
    { key: 'pragmatic_fit', label: t('evaluation.pragmatic_fit'), desc: t('icap.descriptions.pragmatic_fit'), icapKey: 'pragmatic_fit' },
    { key: 'cultural_adequacy', label: t('evaluation.cultural_adequacy'), desc: t('icap.descriptions.cultural_adequacy'), icapKey: 'cultural_adequacy' },
    { key: 'cognitive_accessibility', label: t('evaluation.cognitive_accessibility'), desc: t('icap.descriptions.cognitive_accessibility'), icapKey: 'cognitive_accessibility' }
  ];

  if (compact) {
    // Compact version for modal - no scroll needed
    return (
      <div className="flex flex-col h-full">
        {/* Top: Chart - smaller to save space */}
        <div className="flex justify-center py-3 mb-2 shrink-0">
          <HexagonChart metrics={current} size={120} />
        </div>

        {/* Bottom: Sliders - very compact spacing */}
        <div className="space-y-2 shrink-0">
          {axes.map(axis => (
            <div key={axis.key} className="space-y-1">
              <div className="flex justify-between items-end">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider">{axis.label}</span>
                  <button
                    onClick={() => setHelpDimension(axis.icapKey)}
                    className="text-violet-400 hover:text-violet-600 transition-colors"
                    title={t('evaluation.helpTitle', { dimension: axis.label })}
                  >
                    <HelpCircle size={12} />
                  </button>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(v => (
                    <div key={v} className={`w-2 h-2 rounded-full transition-colors duration-300 ${(current as any)[axis.key] >= v ? 'bg-violet-600' : 'bg-slate-200'}`}></div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400 w-3">1</span>
                <input
                  type="range" min="1" max="5" step="1"
                  value={(current as any)[axis.key]}
                  onChange={(e) => handleChange(axis.key as keyof EvaluationMetrics, parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <span className="text-[10px] font-mono text-slate-400 w-3 text-right">5</span>
              </div>
            </div>
          ))}
        </div>

        {/* Reasoning textarea - more space */}
        <div className="border-t border-slate-100 pt-3 mt-3 flex-1 min-h-0 flex flex-col">
          <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">{t('evaluation.reasoning')}</label>
          <textarea
            value={current.reasoning}
            onChange={(e) => handleChange('reasoning', e.target.value)}
            placeholder={t('placeholders.optionalRationale')}
            className="w-full text-xs p-2 border bg-slate-50 focus:bg-white flex-1 resize-none rounded-sm outline-none focus:border-violet-300 transition-colors"
          />
        </div>

        {/* Help Modal */}
        {helpDimension && <ICAPHelpModal dimension={helpDimension} onClose={() => setHelpDimension(null)} />}
      </div>
    );
  }

  // Full version for StepBox - with scroll
  return (
    <div className="flex flex-col h-full relative">
      <div className="flex-1 overflow-y-auto pr-2 pb-4 scrollbar-thin scrollbar-thumb-slate-200">
        {/* Top: Chart */}
        <div className="flex justify-center py-6 mb-2">
          <HexagonChart metrics={current} size={160} />
        </div>

        {/* Bottom: Sliders */}
        <div className="space-y-5 px-1">
          {axes.map(axis => (
            <div key={axis.key} className="space-y-2">
              <div className="flex justify-between items-end">
                <div className="flex items-center gap-1">
                  <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider">{axis.label}</span>
                  <button
                    onClick={() => setHelpDimension(axis.icapKey)}
                    className="text-violet-400 hover:text-violet-600 transition-colors"
                    title={t('evaluation.helpTitle', { dimension: axis.label })}
                  >
                    <HelpCircle size={14} />
                  </button>
                </div>
                <div className="flex gap-1">
                  {[1, 2, 3, 4, 5].map(v => (
                    <div key={v} className={`w-2 h-2 rounded-full transition-colors duration-300 ${(current as any)[axis.key] >= v ? 'bg-violet-600' : 'bg-slate-200'}`}></div>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-[10px] font-mono text-slate-400 w-3">1</span>
                <input
                  type="range" min="1" max="5" step="1"
                  value={(current as any)[axis.key]}
                  onChange={(e) => handleChange(axis.key as keyof EvaluationMetrics, parseInt(e.target.value))}
                  className="flex-1 h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-violet-600 focus:outline-none focus:ring-2 focus:ring-violet-200"
                />
                <span className="text-[10px] font-mono text-slate-400 w-3 text-right">5</span>
              </div>
              <p className="text-[9px] text-slate-400 italic leading-none">{axis.desc}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <div className="border-t border-slate-100 pt-3 mt-1 bg-white shrink-0">
        <label className="text-[10px] font-medium uppercase text-slate-400 block mb-1">{t('evaluation.humanReasoning')}</label>
        <textarea
          value={current.reasoning}
          onChange={(e) => handleChange('reasoning', e.target.value)}
          placeholder={t('placeholders.rationale')}
          className="w-full text-xs p-2 border bg-slate-50 focus:bg-white h-24 resize-none rounded-sm outline-none focus:border-violet-300 transition-colors"
        />
      </div>

      {/* Help Modal */}
      {helpDimension && <ICAPHelpModal dimension={helpDimension} onClose={() => setHelpDimension(null)} />}
    </div>
  );
};

const SearchComponent: React.FC<{
  rows: RowData[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onAddNewRow: (utterance: string) => void;
  isFocused: boolean;
  setIsFocused: (isFocused: boolean) => void;
}> = ({ rows, searchValue, onSearchChange, onAddNewRow, isFocused, setIsFocused }) => {
  const { t } = useTranslation();
  const suggestions = useMemo(() => {
    if (!searchValue) return [];
    return rows.filter(r => r.UTTERANCE.toLowerCase().includes(searchValue.toLowerCase()));
  }, [rows, searchValue]);

  const showSuggestions = isFocused && searchValue.length > 0;

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && searchValue.trim().length > 0 && suggestions.length === 0) {
      e.preventDefault();
      onAddNewRow(searchValue);
    }
  };

  return (
    <div className="relative">
      <div className={`flex items-center bg-slate-100 px-4 py-2 border-2 transition-all ${isFocused ? 'border-violet-950 bg-white shadow-lg' : 'border-transparent'}`}>
        <Search size={18} className="text-slate-400" />
        <input
          value={searchValue}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setTimeout(() => setIsFocused(false), 200)}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder={t('search.placeholder')}
          className="flex-1 bg-transparent border-none focus:ring-0 focus:outline-none text-sm font-bold ml-2"
        />
      </div>
      {showSuggestions && (
        <div className="absolute top-full mt-2 w-full bg-white border border-slate-200 shadow-xl z-50 max-h-80 overflow-y-auto animate-in fade-in duration-100">
          {suggestions.length > 0 ? (
            suggestions.map(row => (
              <div
                key={row.id}
                className="p-3 text-sm text-slate-600 hover:bg-slate-50 cursor-pointer"
                onMouseDown={() => onSearchChange(row.UTTERANCE)}
              >
                {row.UTTERANCE}
              </div>
            ))
          ) : (
            <div
              className="p-4 text-sm text-violet-700 bg-violet-50 hover:bg-violet-100 cursor-pointer flex items-center gap-3 font-medium"
              onMouseDown={() => onAddNewRow(searchValue)}
            >
              <PlusCircle size={18} />
              {t('search.createNew', { query: searchValue })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};


const App: React.FC = () => {
  const { t, lang, setLang } = useTranslation();
  const { svgs, exportSVGs, importSVGs } = useSVGLibrary();
  const [rows, setRows] = useState<RowData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'home' | 'list'>('home');
  const [sortBy, setSortBy] = useState<'alphabetical' | 'completeness' | 'evaluation'>('alphabetical');
  const [config, setConfig] = useState<GlobalConfig>({
    lang: 'es',
    aspectRatio: '1:1',
    imageModel: 'flash',
    author: 'PICTOS.NET',
    license: 'CC BY 4.0',
    visualStylePrompt: "Siluetas sobre un fondo blanco plano. Sin degradados, sin sombras, sin texturas y sin contornos. Geometría: Usa trazos gruesos y consistentes y simplificación geométrica. Todas las extremidades y terminales deben tener puntas redondeadas y vértices suavizados. Composición: Representación plana 2D centrada. Usa el espacio negativo (blanco) para definir la separación interna entre formas negras superpuestas (por ejemplo, el espacio entre una cabeza y un torso). Claridad: Maximiza la legibilidad y el reconocimiento semántico a escalas pequeñas. Evita cualquier rasgo facial o detalles intrincados. Usa color solo en el elemento distintivo, si es necesario.",
    geoContext: { lat: '40.4168', lng: '-3.7038', region: 'Madrid, ES' },
    svgStyles: {
      f: { fill: '#000000', stroke: 'none', strokeWidth: 0 },
      k: { fill: '#ffffff', stroke: 'none', strokeWidth: 0 }
    }
  });
  const [focusMode, setFocusMode] = useState<{ step: 'nlu' | 'visual' | 'bitmap' | 'eval', rowId: string } | null>(null);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [isInitialized, setIsInitialized] = useState(false);
  const [availableLibraries, setAvailableLibraries] = useState<LibraryMetadata[]>([]);
  const [confirmDialog, setConfirmDialog] = useState<{
    isOpen: boolean;
    title: string;
    message: string;
    onConfirm: () => void;
  }>({
    isOpen: false,
    title: '',
    message: '',
    onConfirm: () => {}
  });
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [loadingLibraryName, setLoadingLibraryName] = useState('');

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const stopFlags = useRef<Record<string, boolean>>({});

  // Sanitize row data to prevent corrupted JSON from breaking the app
  const sanitizeRow = (row: any): RowData => {
    return {
      id: row.id || `R_${Date.now()}`,
      UTTERANCE: typeof row.UTTERANCE === 'string' ? row.UTTERANCE : '',
      NLU: row.NLU,
      elements: Array.isArray(row.elements) ? row.elements : undefined,
      prompt: typeof row.prompt === 'string' ? row.prompt : undefined,
      bitmap: typeof row.bitmap === 'string' ? row.bitmap : undefined,
      rawSvg: typeof row.rawSvg === 'string' ? row.rawSvg : undefined,
      structuredSvg: typeof row.structuredSvg === 'string' ? row.structuredSvg : undefined,
      evaluation: row.evaluation && typeof row.evaluation === 'object' ? row.evaluation : undefined,
      status: ['idle', 'processing', 'completed', 'error'].includes(row.status) ? row.status : 'idle',
      nluStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.nluStatus) ? row.nluStatus : 'idle',
      visualStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.visualStatus) ? row.visualStatus : 'idle',
      bitmapStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.bitmapStatus) ? row.bitmapStatus : 'idle',
      evalStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.evalStatus) ? row.evalStatus : 'idle',
      nluDuration: typeof row.nluDuration === 'number' ? row.nluDuration : undefined,
      visualDuration: typeof row.visualDuration === 'number' ? row.visualDuration : undefined,
      bitmapDuration: typeof row.bitmapDuration === 'number' ? row.bitmapDuration : undefined,
      evalDuration: typeof row.evalDuration === 'number' ? row.evalDuration : undefined,
    };
  };

  useEffect(() => {
    const loadData = async () => {
      // Load rows from localStorage
      const saved = localStorage.getItem(STORAGE_KEY);
      const savedConfig = localStorage.getItem(CONFIG_KEY);

      let loadedRows: RowData[] = [];

      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed)) {
            loadedRows = parsed.map(sanitizeRow);
          }
        } catch (e) {
          console.error("Failed to load rows", e);
        }
      }

      // Load bitmaps from IndexedDB and merge with rows
      if (loadedRows.length > 0) {
        try {
          const bitmapsMap = await IndexedDBService.getAllBitmaps();
          loadedRows = loadedRows.map(row => ({
            ...row,
            bitmap: bitmapsMap.get(row.id) || row.bitmap
          }));
        } catch (err) {
          console.error('Failed to load bitmaps from IndexedDB:', err);
        }

        setRows(loadedRows);
        setViewMode('list');
      }

      if (savedConfig) {
        try {
          setConfig(JSON.parse(savedConfig));
        } catch (e) {
          console.error("Failed to load config", e);
        }
      }

      setIsInitialized(true);
    };

    loadData();
  }, []);

  // Auto-save to localStorage with error handling
  useEffect(() => {
    if (!isInitialized) return;

    const saveData = async () => {
      try {
        // Save bitmaps to IndexedDB first (they're too large for localStorage)
        const bitmapSavePromises = rows
          .filter((row: RowData) => row.bitmap)
          .map((row: RowData) => IndexedDBService.saveBitmap(row.id, row.bitmap!));

        await Promise.all(bitmapSavePromises).catch(err => {
          console.error('Failed to save bitmaps to IndexedDB:', err);
        });

        // Strip bitmaps from rows before saving to localStorage
        const rowsWithoutBitmaps = rows.map((row: RowData) => ({
          ...row,
          bitmap: undefined, // Remove bitmap to save space (stored in IndexedDB)
          rawSvg: undefined, // Also remove SVGs to save space
          structuredSvg: undefined
        }));

        localStorage.setItem(STORAGE_KEY, JSON.stringify(rowsWithoutBitmaps));
        localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
      } catch (error) {
        if (error instanceof DOMException && error.name === 'QuotaExceededError') {
          console.error('localStorage quota exceeded');
          addLog('error', t('messages.storageQuotaExceeded'));

          // Try to save at least the config
          try {
            localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
          } catch (e) {
            console.error('Failed to save even config:', e);
          }
        } else {
          console.error('Failed to save to localStorage:', error);
          addLog('error', t('messages.storageSaveFailed'));
        }
      }
    };

    saveData();
  }, [rows, config, isInitialized]);

  // Load available libraries from index.json
  useEffect(() => {
    const loadLibraries = async () => {
      try {
        console.log('[LIBRARIES] Fetching index from /libraries/index.json...');
        const response = await fetch('/libraries/index.json');
        if (!response.ok) {
          console.warn('[LIBRARIES] Index not found, status:', response.status);
          setAvailableLibraries([]);
          return;
        }

        const index = await response.json();
        console.log('[LIBRARIES] Index loaded:', index);
        setAvailableLibraries(index.libraries || []);
        console.log(`[LIBRARIES] ✅ ${index.libraries.length} libraries ready to display`);
      } catch (error) {
        console.error('[LIBRARIES] Failed to load index:', error);
        setAvailableLibraries([]);
      }
    };

    loadLibraries();
  }, []);

  const addLog = (type: 'info' | 'error' | 'success', message: string) => {
    setLogs(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), timestamp: new Date().toLocaleTimeString(), type, message }]);
  };

  const processPhrases = (text: string) => {
    try {
      const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
      const newRows: RowData[] = lines.map((phrase, i) => ({
        id: `R_PHRASE_${Date.now()}_${i}`,
        UTTERANCE: phrase,
        status: 'idle',
        nluStatus: 'idle',
        visualStatus: 'idle',
        bitmapStatus: 'idle',
        evalStatus: 'idle'
      }));
      setRows(prev => [...prev, ...newRows]);
      setViewMode('list');
      addLog('success', `Importadas ${newRows.length} frases desde el archivo.`);
    } catch (e) {
      addLog('error', 'Error al procesar el listado de frases.');
    }
  };

  const exportProject = () => {
    // Transform rows: convert "processing" status to "idle" or "completed"
    const sanitizedRows = rows.map((row: RowData) => {
      if (row.status !== 'processing') {
        return row; // Keep other statuses as-is
      }

      // Check if row has meaningful data to determine if it should be 'completed' or 'idle'
      const hasNLU = row.NLU && (typeof row.NLU === 'string' ? row.NLU.trim() !== '' : Object.keys(row.NLU).length > 0);
      const hasVisual = (row.elements && row.elements.length > 0) || (row.prompt && row.prompt.trim() !== '');
      const hasBitmap = row.bitmap && row.bitmap.trim() !== '';
      const hasEvaluation = row.evaluation && Object.keys(row.evaluation).length > 0;

      const hasAnyData = hasNLU || hasVisual || hasBitmap || hasEvaluation;

      return {
        ...row,
        status: hasAnyData ? 'completed' as const : 'idle' as const
      };
    });

    const dataToExport = {
      version: APP_VERSION,
      type: 'pictonet_graph_dump',
      timestamp: new Date().toISOString(),
      config,
      rows: sanitizedRows,
      svgs: exportSVGs()
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeFilename = config.author.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'pictonet';
    a.download = `${safeFilename}_graph_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('success', 'Proyecto exportado correctamente (imágenes incluidas).');
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        const parsed = JSON.parse(content);
        if (Array.isArray(parsed)) {
          const sanitized = parsed.map(sanitizeRow);
          setRows(sanitized);
          addLog('success', `Importados ${sanitized.length} nodos (Formato Legacy).`);
        }
        else if (parsed.rows && Array.isArray(parsed.rows)) {
          const sanitized = parsed.rows.map(sanitizeRow);
          setRows(sanitized);
          if (parsed.config) {
            const newConfig = { ...parsed.config };
            if (!newConfig.aspectRatio) newConfig.aspectRatio = '1:1';
            if (!newConfig.imageModel) newConfig.imageModel = 'flash';
            setConfig(newConfig);
            addLog('info', 'Configuración global restaurada.');
          }
          if (parsed.svgs && Array.isArray(parsed.svgs)) {
            const count = importSVGs(parsed.svgs);
            if (count > 0) addLog('success', `Biblioteca SVG restaurada: ${count} pictogramas.`);
          }
          addLog('success', `Grafo restaurado: ${sanitized.length} nodos.`);
        } else {
          throw new Error("Formato de archivo no reconocido");
        }
        setViewMode('list');
      } catch (err) {
        addLog('error', 'Fallo al importar grafo. Verifique el formato.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addNewRow = (textValue: string = "") => {
    const newId = `R_MANUAL_${Date.now()}`;
    const newEntry: RowData = {
      id: newId,
      UTTERANCE: textValue.trim() || 'Nueva Unidad Semántica',
      status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle', evalStatus: 'idle'
    };
    setRows(prev => [newEntry, ...prev]);
    setViewMode('list');
    setOpenRowId(newId);
    setSearchValue('');
    setIsSearching(false);
  };

  const clearAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: t('actions.deleteAll'),
      message: t('actions.deleteAllConfirm'),
      onConfirm: async () => {
        setRows([]);
        setLogs([]);
        localStorage.removeItem(STORAGE_KEY);

        // Clear IndexedDB bitmaps
        try {
          await IndexedDBService.clearAllBitmaps();
        } catch (err) {
          console.error('Failed to clear IndexedDB:', err);
        }

        setViewMode('home');
        setShowLibraryMenu(false);
        addLog('info', t('messages.allCleared'));
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
  };

  const loadICAPModule = async () => {
    const executeLoad = async () => {
      setIsLoadingLibrary(true);
      setLoadingLibraryName('ICAP-50');
      try {
        addLog('info', 'Cargando corpus ICAP-50 desde repositorio oficial...');
        const module = await fetchICAPModule();
        addLog('success', `Corpus ICAP-50 v${module.version} cargado: ${module.data.length} frases base`);
        setRows(module.data as RowData[]);
        setViewMode('list');
      } catch (error) {
        addLog('error', 'Error al cargar corpus ICAP, usando corpus base local');
        console.error('ICAP fetch error:', error);
        // Fallback to basic ICAP phrases
        setRows(ICAP_MODULE_FALLBACK.data as RowData[]);
        setViewMode('list');
      } finally {
        setIsLoadingLibrary(false);
        setLoadingLibraryName('');
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    };

    if (rows.length > 0) {
      setConfirmDialog({
        isOpen: true,
        title: 'ICAP-50',
        message: t('home.loadICAPWarning', { count: rows.length }),
        onConfirm: executeLoad
      });
    } else {
      await executeLoad();
    }
  };

  // Load library from libraries folder
  const loadLibrary = async (filename: string) => {
    // Get library metadata for better display name
    const libraryMeta = availableLibraries.find(lib => lib.filename === filename);
    const displayName = libraryMeta?.name || filename;

    const executeLoad = async () => {
      setIsLoadingLibrary(true);
      setLoadingLibraryName(displayName);
      try {
        addLog('info', `Cargando biblioteca: ${displayName}...`);
        const response = await fetch(`/libraries/${filename}`);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        addLog('success', `Biblioteca cargada: ${data.rows?.length || 0} pictogramas`);

        // Load config if available
        if (data.config) {
          setConfig(prev => ({ ...prev, ...data.config }));
        }

        setRows(data.rows as RowData[]);
        setViewMode('list');
      } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        addLog('error', `Error al cargar biblioteca: ${msg}`);
        console.error('Library load error:', error);
      } finally {
        setIsLoadingLibrary(false);
        setLoadingLibraryName('');
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    };

    if (rows.length > 0) {
      setConfirmDialog({
        isOpen: true,
        title: t('home.loadLibrary'),
        message: t('home.loadICAPWarning', { count: rows.length }),
        onConfirm: executeLoad
      });
    } else {
      await executeLoad();
    }
  };

  const updateRow = (index: number, updates: Partial<RowData>) => {
    setRows(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  };

  const regeneratePrompt = async (index: number): Promise<boolean> => {
    const row = rows[index];
    if (!row || !row.NLU || !row.elements) {
      addLog('error', 'Se requiere NLU y elementos para regenerar el prompt');
      return false;
    }

    stopFlags.current[row.id] = false;
    updateRow(index, { visualStatus: 'processing' });
    const startTime = Date.now();

    try {
      let nluObj;
      try {
        nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
      } catch (parseError) {
        throw new Error(`Failed to parse NLU data: ${parseError}`);
      }

      addLog('info', `[PROMPT] Regenerando prompt espacial a partir de elementos modificados...`);
      const newPrompt = await Gemini.generateSpatialPrompt(nluObj as NLUData, ensureElementsArray(row.elements), config, addLog);

      if (stopFlags.current[row.id]) {
        addLog('info', `🛑 Regeneración de prompt detenida por usuario`);
        updateRow(index, { visualStatus: 'completed' });
        return false;
      }

      const duration = (Date.now() - startTime) / 1000;
      updateRow(index, {
        prompt: newPrompt,
        visualStatus: 'completed',
        visualDuration: duration,
        bitmapStatus: 'outdated',
        evalStatus: 'outdated',
        evaluation: undefined,
        shared: false
      });
      addLog('success', `Prompt regenerado en ${duration.toFixed(1)}s: "${newPrompt.substring(0, 50)}..."`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      addLog('error', `Error al regenerar prompt: ${msg}`);
      updateRow(index, { visualStatus: 'completed' });
      return false;
    }
  };

  const processStep = async (index: number, step: 'nlu' | 'visual' | 'bitmap' | 'eval'): Promise<boolean> => {
    const row = rows[index];
    if (!row) return false;

    // Manual Evaluation Step Handling
    if (step === 'eval') {
      // Just reset status to completed if saving
      updateRow(index, { evalStatus: 'completed' });
      addLog('success', `Evaluación guardada para: ${row.UTTERANCE}`);
      return true;
    }

    stopFlags.current[row.id] = false;
    const statusKey = `${step}Status` as keyof RowData;
    const durationKey = `${step}Duration` as keyof RowData;

    updateRow(index, { [statusKey]: 'processing' });
    const startTime = Date.now();

    try {
      let result: any;
      if (step === 'nlu') {
        result = await Gemini.generateNLU(row.UTTERANCE, addLog);
      } else if (step === 'visual') {
        let nluObj;
        try {
          nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
        } catch (parseError) {
          throw new Error(`Failed to parse NLU data: ${parseError}`);
        }
        result = await Gemini.generateVisualBlueprint(nluObj as NLUData, config, addLog);
      } else if (step === 'bitmap') {
        result = await Gemini.generateImage(ensureElementsArray(row.elements), row.prompt || "", row, config, addLog);
      }

      if (stopFlags.current[row.id]) {
        addLog('info', `🛑 Proceso detenido por usuario en paso ${step.toUpperCase()}`);
        updateRow(index, { [statusKey]: 'idle' });
        return false;
      }

      const duration = (Date.now() - startTime) / 1000;
      updateRow(index, {
        [statusKey]: 'completed',
        [durationKey]: duration,
        ...(step === 'nlu' ? { NLU: result, visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' } : {}),
        ...(step === 'visual' ? { elements: result.elements, prompt: result.prompt, bitmapStatus: 'outdated', evalStatus: 'outdated' } : {}),
        ...(step === 'bitmap' ? { bitmap: result, status: 'completed', evalStatus: 'idle', evaluation: undefined } : {}) // Reset eval and clear previous evaluation data
      });
      addLog('success', `${step.toUpperCase()} completo: ${duration.toFixed(1)}s para "${row.UTTERANCE}"`);
      return true;
    } catch (err: any) {
      updateRow(index, { [statusKey]: 'error' });
      addLog('error', `${step.toUpperCase()} Error para "${row.UTTERANCE}": ${err.message}`);
      return false;
    }
  };

  const processCascade = async (index: number) => {
    const row = rows[index];
    if (!row) return;

    stopFlags.current[row.id] = false;
    addLog('info', `Iniciando propagación en grafo para: ${row.UTTERANCE}`);

    let finalUpdates: Partial<RowData> = { status: 'processing' };

    try {
      // --- NLU Step ---
      addLog('info', `[CASCADA] Paso 1/3: COMPRENDER - Análisis semántico`);
      updateRow(index, { nluStatus: 'processing', visualStatus: 'idle', bitmapStatus: 'idle', evalStatus: 'idle' });
      const nluStartTime = Date.now();
      const nluResult = await Gemini.generateNLU(row.UTTERANCE, addLog);
      if (stopFlags.current[row.id]) {
        addLog('info', `❌ [CASCADA] Detenida por usuario en paso COMPRENDER`);
        updateRow(index, { nluStatus: 'idle', status: 'idle' });
        return;
      }
      finalUpdates.NLU = nluResult;
      finalUpdates.nluStatus = 'completed';
      finalUpdates.nluDuration = (Date.now() - nluStartTime) / 1000;
      addLog('success', `✓ [CASCADA] Paso 1/3 completado en ${finalUpdates.nluDuration.toFixed(1)}s`);

      // --- Visual Step ---
      addLog('info', `[CASCADA] Paso 2/3: COMPONER - Blueprint visual`);
      updateRow(index, { nluStatus: 'completed', nluDuration: finalUpdates.nluDuration, NLU: nluResult, visualStatus: 'processing' });
      const visualStartTime = Date.now();
      const visualResult = await Gemini.generateVisualBlueprint(nluResult, config, addLog);
      if (stopFlags.current[row.id]) {
        addLog('info', `❌ [CASCADA] Detenida por usuario en paso COMPONER`);
        updateRow(index, { visualStatus: 'idle' });
        return;
      }
      finalUpdates.elements = visualResult.elements;
      finalUpdates.prompt = visualResult.prompt;
      finalUpdates.visualStatus = 'completed';
      finalUpdates.visualDuration = (Date.now() - visualStartTime) / 1000;
      addLog('success', `✓ [CASCADA] Paso 2/3 completado en ${finalUpdates.visualDuration.toFixed(1)}s`);

      // --- Bitmap Step (NanoBanana) ---
      addLog('info', `[CASCADA] Paso 3/3: PRODUCIR - Renderizado de imagen`);
      updateRow(index, { visualStatus: 'completed', visualDuration: finalUpdates.visualDuration, elements: visualResult.elements, prompt: visualResult.prompt, bitmapStatus: 'processing' });
      const bitmapStartTime = Date.now();
      const bitmapResult = await Gemini.generateImage(ensureElementsArray(visualResult.elements), visualResult.prompt || "", row, config, addLog);
      if (stopFlags.current[row.id]) {
        addLog('info', `❌ [CASCADA] Detenida por usuario en paso PRODUCIR`);
        updateRow(index, { bitmapStatus: 'idle' });
        return;
      }
      finalUpdates.bitmap = bitmapResult;
      finalUpdates.bitmapStatus = 'completed';
      finalUpdates.bitmapDuration = (Date.now() - bitmapStartTime) / 1000;
      addLog('success', `✓ [CASCADA] Paso 3/3 completado en ${finalUpdates.bitmapDuration.toFixed(1)}s`);

      // --- End of Automation ---
      // We do NOT auto-run evaluation. It is manual.
      // We set evalStatus to 'idle' to indicate it is ready for input.
      finalUpdates.evalStatus = 'idle';

      finalUpdates.status = 'completed';
      updateRow(index, finalUpdates);

      const totalTime = (finalUpdates.nluDuration || 0) + (finalUpdates.visualDuration || 0) + (finalUpdates.bitmapDuration || 0);
      addLog('success', `✓ [CASCADA] Pipeline completo en ${totalTime.toFixed(1)}s total para "${row.UTTERANCE}"`);
      addLog('info', `→ Pictograma listo para evaluación ICAP`);

    } catch (err: any) {
      let stepFailed: 'nlu' | 'visual' | 'bitmap' = 'nlu';
      if (finalUpdates.nluStatus === 'completed' && finalUpdates.visualStatus !== 'completed') stepFailed = 'visual';
      else if (finalUpdates.visualStatus === 'completed') stepFailed = 'bitmap';

      const stepNames = { nlu: 'COMPRENDER', visual: 'COMPONER', bitmap: 'PRODUCIR' };
      updateRow(index, { [`${stepFailed}Status`]: 'error', status: 'error' });
      addLog('error', `❌ [CASCADA] Fallo en paso ${stepNames[stepFailed]}: ${err.message}`);
    }
  };

  // Helper functions for sorting
  const getRowCompleteness = (row: RowData): number => {
    let count = 0;
    if (row.NLU && row.nluStatus === 'completed') count++;
    if (row.elements && row.prompt && row.visualStatus === 'completed') count++;
    if (row.bitmap && row.bitmapStatus === 'completed') count++;
    return count;
  };

  const getRowEvaluationTotal = (row: RowData): number => {
    if (!row.evaluation) return 0;
    const { clarity, recognizability, semantic_transparency, pragmatic_fit, cultural_adequacy, cognitive_accessibility } = row.evaluation;
    return clarity + recognizability + semantic_transparency + pragmatic_fit + cultural_adequacy + cognitive_accessibility;
  };

  const sharePictogram = async (index: number): Promise<boolean> => {
    const row = rows[index];
    console.log('[SHARE] Iniciando proceso de compartir pictograma', { index, utterance: row?.UTTERANCE });

    if (!row || !row.evaluation) {
      console.log('[SHARE] Error: No hay fila o evaluación', { hasRow: !!row, hasEvaluation: !!row?.evaluation });
      addLog('error', t('share.requiresEvaluation'));
      return false;
    }

    const avgScore = (
      row.evaluation.clarity +
      row.evaluation.recognizability +
      row.evaluation.semantic_transparency +
      row.evaluation.pragmatic_fit +
      row.evaluation.cultural_adequacy +
      row.evaluation.cognitive_accessibility
    ) / 6;
    console.log('[SHARE] Evaluación promedio calculada', { avgScore, required: 4.0 });

    if (avgScore < 4.0) {
      console.log('[SHARE] Error: Evaluación insuficiente', { avgScore });
      addLog('error', t('share.lowScore'));
      return false;
    }

    if (row.shared) {
      console.log('[SHARE] El pictograma ya fue compartido previamente');
      addLog('info', t('share.alreadyShared'));
      return false;
    }

    try {
      console.log('[SHARE] Preparando datos para enviar a PICTOS');
      addLog('info', t('share.sharing', { utterance: row.UTTERANCE }));

      const payload = {
        id: row.id,
        UTTERANCE: row.UTTERANCE,
        status: row.status,
        NLU: row.NLU,
        elements: row.elements,
        prompt: row.prompt,
        bitmap: row.bitmap, // Bitmap already resized to 800x800 at generation time
        evaluation: row.evaluation,
        nluStatus: row.nluStatus,
        visualStatus: row.visualStatus,
        bitmapStatus: row.bitmapStatus,
        evalStatus: row.evalStatus,
        source: 'pictos.net',
        author: config.author,
        timestamp: new Date().toISOString()
      };
      console.log('[SHARE] Enviando a función serverless', { payloadSize: JSON.stringify(payload).length });

      // Llamar a la función de Netlify (protege el GITHUB_TOKEN)
      const response = await fetch('/.netlify/functions/share-pictogram', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      console.log('[SHARE] Respuesta recibida', { status: response.status, statusText: response.statusText });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('[SHARE] Error en respuesta', { status: response.status, error: errorText });
        addLog('error', t('share.error', { status: response.status, error: errorText }));
        return false;
      }

      console.log('[SHARE] ✓ Pictograma compartido exitosamente');
      updateRow(index, { shared: true });
      addLog('success', t('share.success', { utterance: row.UTTERANCE }));

      // Mostrar mensaje de agradecimiento al usuario
      alert(t('share.thanksMessage'));

      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Error desconocido';
      console.error('[SHARE] Excepción capturada', { error: msg });
      addLog('error', t('share.exception', { error: msg }));
      return false;
    }
  };

  const filteredRows = useMemo(() => {
    // First filter by search
    let filtered = rows;
    if (searchValue) {
      const lowSearch = searchValue.toLowerCase();
      filtered = rows.filter(r => r.UTTERANCE.toLowerCase().includes(lowSearch));
    }

    // Then sort by selected criteria
    const sorted = [...filtered].sort((a, b) => {
      if (sortBy === 'alphabetical') {
        return a.UTTERANCE.localeCompare(b.UTTERANCE);
      } else if (sortBy === 'completeness') {
        return getRowCompleteness(b) - getRowCompleteness(a); // descending (more complete first)
      } else if (sortBy === 'evaluation') {
        return getRowEvaluationTotal(b) - getRowEvaluationTotal(a); // descending (higher score first)
      }
      return 0;
    });

    return sorted;
  }, [rows, searchValue, sortBy]);

  const focusedRowData = useMemo(() => {
    if (!focusMode) return null;
    return rows.find(r => r.id === focusMode.rowId);
  }, [focusMode, rows]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <header id="toolbar" className="h-20 bg-white border-b border-slate-200 sticky top-0 z-50 flex items-center px-8 justify-between shadow-sm">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => setViewMode('home')}>
          <div className="p-1.5"><LogoIcon size={44} /></div>
          <div>
            <h1 className="font-bold uppercase tracking-tight text-xl text-slate-900 leading-none">{config.author}</h1>
            <span id="tagline" className="text-[9px] text-slate-400 font-mono tracking-widest uppercase">v{APP_VERSION}</span>
          </div>
        </div>

        <div className="flex-1 max-w-xl mx-8">
          <SearchComponent
            rows={rows}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onAddNewRow={addNewRow}
            isFocused={isSearching}
            setIsFocused={setIsSearching}
          />
        </div>

        <div className="flex gap-2 items-center">
          <input type="file" ref={importInputRef} className="hidden" accept=".json" onChange={handleImportProject} />

          {/* Language Switcher */}
          <select
            value={lang}
            onChange={(e) => setLang(e.target.value as Locale)}
            className="p-2.5 text-xs border border-slate-200 bg-white hover:border-violet-200 rounded-md transition-all text-slate-600 font-medium cursor-pointer shadow-sm"
            title="UI Language"
          >
            <option value="en-GB">English</option>
            <option value="es-419">Español</option>
          </select>

          <div className="relative flex items-center bg-white border border-slate-200 shadow-sm rounded-md transition-all hover:border-violet-200 group">
            <button
              onClick={() => setViewMode('list')}
              className="p-2.5 hover:bg-slate-50 text-slate-600 border-r border-slate-100 flex items-center gap-2"
              title={t('header.libraryTooltip')}
            >
              <Library size={18} />
              <span className="text-xs font-medium text-slate-500 hidden md:inline">{t('header.library')}</span>
            </button>
            <button
              onClick={() => setShowLibraryMenu(!showLibraryMenu)}
              className={`p-1.5 hover:bg-slate-50 text-slate-400 border-l border-transparent hover:text-violet-950 transition-colors ${showLibraryMenu ? 'bg-slate-50 text-violet-950' : ''}`}
            >
              <ChevronDown size={14} />
            </button>

            {showLibraryMenu && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setShowLibraryMenu(false)}></div>
                <div className="absolute top-full right-0 mt-2 w-56 bg-white border border-slate-200 shadow-xl z-50 rounded-sm animate-in fade-in slide-in-from-top-2">
                  <div className="p-2 border-b border-slate-100 text-[10px] uppercase font-bold text-slate-400 tracking-wider">
                    {t('library.graphManagement')}
                  </div>
                  <button
                    onClick={() => { importInputRef.current?.click(); setShowLibraryMenu(false); }}
                    className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                  >
                    <Upload size={14} className="text-violet-950" /> {t('actions.import')}
                  </button>
                  <button
                    onClick={() => { exportProject(); setShowLibraryMenu(false); }}
                    disabled={rows.length === 0}
                    className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-50"
                  >
                    <Download size={14} className="text-emerald-600" /> {t('actions.export')}
                  </button>
                  <button
                    onClick={() => {
                      const allSvgs = exportSVGs();
                      const blob = new Blob([allSvgs], { type: 'application/json' });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement('a');
                      a.href = url;
                      a.download = `${config.author.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_svgs_${new Date().toISOString().split('T')[0]}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                      setShowLibraryMenu(false);
                      addLog('success', 'SVGs exportados correctamente.');
                    }}
                    disabled={!svgs || svgs.length === 0}
                    className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-50"
                  >
                    <FileDown size={14} className="text-blue-600" /> Exportar SVGs
                  </button>
                  <div className="border-t border-slate-100 my-1"></div>
                  <button
                    onClick={clearAll}
                    disabled={rows.length === 0}
                    className="w-full text-left px-4 py-3 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-3 transition-colors disabled:opacity-50 disabled:text-slate-400"
                  >
                    <Trash2 size={14} className="text-rose-600" /> {t('actions.deleteAll')}
                  </button>
                </div>
              </>
            )}
          </div>

          <div className="w-px h-8 bg-slate-200 mx-2"></div>

          <button onClick={() => setShowConfig(!showConfig)} className={`p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all ${showConfig ? 'bg-slate-100 text-violet-950' : ''}`} title={t('header.settingsTooltip')}><Sliders size={18} /></button>
          <button onClick={() => setShowConsole(!showConsole)} className="p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all" title={t('header.consoleTooltip')}><Terminal size={18} /></button>
        </div>
      </header>

      {showConfig && (
        <div id="globalSettings" className="fixed top-20 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b shadow-2xl p-8 animate-in slide-in-from-top duration-200">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-4">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Visual Style Prompt (Node Attribute)</label>
              <textarea value={config.visualStylePrompt} onChange={e => setConfig({ ...config, visualStylePrompt: e.target.value })} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-24" />
            </div>

            <div className="md:col-span-1 relative group">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">
                Geo-Linguistic Context
              </label>
              <div className="flex flex-col gap-2">
                <div className="border p-3 bg-slate-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-200 transition-colors">
                  <div className="flex items-center gap-2">
                    <Globe size={14} className="text-slate-400" />
                    <input type="text" placeholder="Language (es, en...)" value={config.lang} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setConfig({ ...config, lang: e.target.value })} className="w-full text-xs bg-transparent border-none outline-none font-medium" />
                  </div>
                </div>
                <GeoAutocomplete
                  value={{
                    lat: config.geoContext?.lat || '',
                    lng: config.geoContext?.lng || '',
                    region: config.geoContext?.region || ''
                  }}
                  onChange={(geoContext: { lat: string; lng: string; region: string }) => setConfig({ ...config, geoContext })}
                />
              </div>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Aspect Ratio</label>
              <select value={config.aspectRatio} onChange={e => setConfig({ ...config, aspectRatio: e.target.value })} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]">
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Standard (4:3)</option>
                <option value="3:4">Portrait (3:4)</option>
                <option value="16:9">Widescreen (16:9)</option>
                <option value="9:16">Mobile (9:16)</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Image Model</label>
              <select value={config.imageModel || 'flash'} onChange={e => setConfig({ ...config, imageModel: e.target.value })} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]">
                <option value="flash">NanoBanana (Flash 2.5)</option>
                <option value="pro">NanoBanana Pro (Gemini 3 Pro)</option>
              </select>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Graphic Style</label>
              <button
                onClick={() => setShowStyleEditor(true)}
                className="w-full text-xs font-bold uppercase text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 p-3 rounded transition-colors h-[42px] flex items-center justify-center gap-2"
              >
                <Palette size={14} /> Open Style Editor
              </button>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 flex items-center gap-1">
                {t('config.spaceName')}
                <div className="group/tooltip relative">
                  <HelpCircle size={10} className="text-slate-300 hover:text-violet-600 cursor-help" />
                  <div className="invisible group-hover/tooltip:visible absolute left-0 bottom-full mb-2 w-64 bg-slate-900 text-white text-[10px] p-2 rounded shadow-lg z-50 leading-relaxed">
                    {t('config.spaceNameTooltip')}
                  </div>
                </div>
              </label>
              <input type="text" value={config.author} onChange={e => setConfig({ ...config, author: e.target.value })} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]" placeholder="My Pictogram Library" />
            </div>
          </div>
        </div>
      )}

      <main id="mainContent" className="flex-1 p-8 max-w-7xl mx-auto w-full">
        {viewMode === 'list' && rows.length > 0 && (
          <div className="mb-6 flex justify-end gap-2">
            <span className="text-[10px] font-medium uppercase text-slate-400 tracking-wider self-center mr-2">{t('library.sortBy')}</span>
            <button
              onClick={() => setSortBy('alphabetical')}
              className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider border transition-all ${sortBy === 'alphabetical' ? 'bg-violet-950 text-white border-violet-950' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
            >
              {t('library.alphabetical')}
            </button>
            <button
              onClick={() => setSortBy('completeness')}
              className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider border transition-all ${sortBy === 'completeness' ? 'bg-violet-950 text-white border-violet-950' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
            >
              {t('library.completeness')}
            </button>
            <button
              onClick={() => setSortBy('evaluation')}
              className={`px-3 py-1.5 text-[10px] font-medium uppercase tracking-wider border transition-all ${sortBy === 'evaluation' ? 'bg-violet-950 text-white border-violet-950' : 'bg-white text-slate-600 border-slate-200 hover:border-violet-300'}`}
            >
              {t('library.evaluation')}
            </button>
          </div>
        )}
        {viewMode === 'home' ? (
          <div className="py-20 text-center space-y-16 animate-in fade-in zoom-in-95 duration-700">
            <div className="space-y-4">
              <div className="inline-flex gap-4 bg-violet-950 text-white px-6 py-2 text-[10px] font-medium uppercase tracking-[0.4em] shadow-lg">
                <ScreenShare size={14} /> {t('header.betterOnLargeScreens')}
              </div>
              <h2 className="text-8xl font-black tracking-tighter text-slate-900 leading-none">{config.author}</h2>
              <p className="text-slate-400 text-xl font-medium max-w-2xl mx-auto leading-relaxed">
                {t('home.description')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div onClick={loadICAPModule} className="bg-white p-12 border border-slate-200 text-left space-y-6 shadow-xl hover:border-violet-950 transition-all cursor-pointer group hover:-translate-y-1 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-1 uppercase tracking-widest">ICAP-50</div>
                <div className="text-emerald-600 group-hover:scale-110 transition-transform"><BookOpen size={40} /></div>
                <div>
                  <h3 className="font-bold text-xl uppercase tracking-wider text-slate-900">{t('home.icapModule')}</h3>
                  <div className="text-[10px] text-slate-400 font-mono mt-1">{t('home.icapNamespace')}</div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">{t('home.icapDescription')}</p>
                <a
                  href="https://github.com/mediafranca/ICAP"
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-800 font-medium uppercase tracking-wider transition-colors"
                >
                  <ExternalLink size={12} />
                  {t('home.icapRepository')}
                </a>
              </div>

              <div onClick={() => fileInputRef.current?.click()} className="bg-violet-950 p-12 text-left space-y-6 shadow-xl hover:bg-black transition-all cursor-pointer group hover:-translate-y-1">
                <div className="text-white group-hover:scale-110 transition-transform"><FileText size={40} /></div>
                <div>
                  <h3 className="font-bold text-xl uppercase tracking-wider text-white">{t('home.importTextNode')}</h3>
                  <div className="text-[10px] text-violet-400 font-mono mt-1">{t('home.importNamespace')}</div>
                </div>
                <p className="text-xs text-violet-300 leading-relaxed font-medium">{t('home.importDescription')}</p>
                <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={e => e.target.files?.[0]?.text().then(processPhrases)} />
              </div>
            </div>

            {/* Example Libraries Section - Only show if libraries are available */}
            {availableLibraries.length > 0 && (
              <div className="max-w-2xl mx-auto space-y-6">
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold tracking-tight text-slate-900">{t('home.exampleLibraries')}</h3>
                  <p className="text-sm text-slate-500">{t('home.exampleLibrariesDescription')}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {availableLibraries.map((library: LibraryMetadata) => (
                    <div
                      key={library.filename}
                    onClick={() => loadLibrary(library.filename)}
                    className="bg-slate-50 border border-slate-200 p-6 text-left space-y-3 hover:border-violet-600 hover:bg-white transition-all cursor-pointer group"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-violet-600 group-hover:scale-110 transition-transform">
                        <Library size={24} />
                      </div>
                      <div className="flex gap-1">
                        <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-2 py-0.5">
                          {library.language}
                        </span>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-bold text-sm uppercase tracking-wide text-slate-900">{library.name}</h4>
                      <div className="text-[10px] text-slate-400 font-mono mt-0.5">{library.location}</div>
                    </div>

                    {/* {library.description && (
                      <p className="text-xs text-slate-500 leading-relaxed">{library.description}</p>
                    )} */}

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200">
                      <span className="text-[10px] text-slate-400 font-medium uppercase tracking-wider">
                        {t('home.loadLibrary')}
                      </span>
                      {library.items && (
                        <span className="text-[10px] text-violet-600 font-bold">
                          {library.items} {t('home.items')}
                        </span>
                      )}
                    </div>
                  </div>
                  ))}
                </div>
              </div>
            )}

            <div className="mt-8 text-center">
              <a
                href="https://github.com/hspencer/pictos-net#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-slate-400 hover:text-slate-600 transition-colors font-medium"
              >
                <ExternalLink size={14} />
                {t('home.aboutProject')}
              </a>
            </div>
          </div>
        ) : (
          <div className="space-y-4 pb-64 animate-in fade-in slide-in-from-bottom-8 duration-500">
            {filteredRows.map((row) => {
              const globalIndex = rows.findIndex(r => r.id === row.id);
              return (
                <RowComponent
                  key={row.id} row={row} isOpen={openRowId === row.id} setIsOpen={v => setOpenRowId(v ? row.id : null)}
                  onUpdate={u => updateRow(globalIndex, u)} onProcess={s => processStep(globalIndex, s)}
                  onRegeneratePrompt={() => regeneratePrompt(globalIndex)}
                  onStop={() => {
                    stopFlags.current[row.id] = true;
                    addLog('info', `🛑 Solicitud de detención para: "${row.UTTERANCE}"`);
                  }}
                  onCascade={() => processCascade(globalIndex)}
                  onDelete={() => {
                    // Delete bitmap from IndexedDB
                    IndexedDBService.deleteBitmap(row.id).catch(err => {
                      console.error('Failed to delete bitmap from IndexedDB:', err);
                    });
                    // Remove row from state
                    setRows(prev => prev.filter(r => r.id !== row.id));
                  }}
                  onFocus={step => setFocusMode({ step, rowId: row.id })}
                  onShare={() => sharePictogram(globalIndex)}
                  onLog={addLog}
                  config={config}
                />
              );
            })}
          </div>
        )}
      </main>

      {showConsole && (
        <div id="console" className="fixed bottom-0 inset-x-0 h-64 bg-slate-950 text-slate-400 mono text-[10px] p-6 z-50 border-t border-slate-800 overflow-auto shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-900 font-medium tracking-widest uppercase">
            <span className="flex items-center gap-3"><Terminal size={14} /> Semantic Trace Monitor</span>
            <button onClick={() => setLogs([])} className="hover:text-white transition-colors">Flush</button>
          </div>
          {logs.slice().reverse().map(l => (
            <div key={l.id} className="flex gap-4 py-1 border-b border-slate-900 last:border-0 items-start">
              <span className="opacity-30 shrink-0">[{l.timestamp}]</span>
              <span className={`font-medium w-16 text-center shrink-0 ${l.type === 'error' ? 'text-rose-600' : 'text-emerald-600'}`}>{l.type.toUpperCase()}</span>
              <span className="break-all">{l.message}</span>
            </div>
          ))}
        </div>
      )}

      {focusMode && focusedRowData && (
        <FocusViewModal
          mode={focusMode.step}
          row={focusedRowData}
          onClose={() => setFocusMode(null)}
          onUpdate={updates => updateRow(rows.findIndex(r => r.id === focusMode.rowId), updates)}
          onShare={() => sharePictogram(rows.findIndex(r => r.id === focusMode.rowId))}
          onRegeneratePrompt={() => regeneratePrompt(rows.findIndex(r => r.id === focusMode.rowId))}
          config={config}
          onLog={addLog}
        />
      )}

      {showStyleEditor && (
        <StyleEditor
          config={config}
          onUpdateConfig={setConfig}
          onClose={() => setShowStyleEditor(false)}
        />
      )}

      {/* Confirmation Dialog Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] animate-in fade-in duration-200" onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}>
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">{confirmDialog.title}</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setConfirmDialog(prev => ({ ...prev, isOpen: false }))}
                className="px-6 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all rounded-md"
              >
                {t('actions.cancel')}
              </button>
              <button
                onClick={() => {
                  confirmDialog.onConfirm();
                }}
                className="px-6 py-2.5 text-sm font-medium text-white bg-violet-950 hover:bg-black transition-all rounded-md shadow-lg"
              >
                {t('actions.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Loading Library Overlay */}
      {isLoadingLibrary && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center z-[70] animate-in fade-in duration-200">
          <div className="bg-white rounded-lg shadow-2xl p-8 mx-4 animate-in zoom-in-95 duration-200 flex flex-col items-center gap-4">
            <div className="w-12 h-12 border-4 border-violet-200 border-t-violet-950 rounded-full animate-spin"></div>
            <div className="text-center">
              <p className="text-lg font-bold text-slate-900">{t('messages.loadingLibrary', { name: loadingLibraryName })}</p>
              <p className="text-sm text-slate-500 mt-1">{lang === 'es-419' ? 'Por favor espere...' : 'Please wait...'}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const RowComponent: React.FC<{
  row: RowData; isOpen: boolean; setIsOpen: (v: boolean) => void;
  onUpdate: (u: any) => void; onProcess: (s: any) => Promise<boolean>;
  onRegeneratePrompt: () => void;
  onStop: () => void; onCascade: () => void; onDelete: () => void;
  onFocus: (step: 'nlu' | 'visual' | 'bitmap' | 'eval') => void;
  onShare: () => void;
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
  config: GlobalConfig;
}> = ({ row, isOpen, setIsOpen, onUpdate, onProcess, onRegeneratePrompt, onStop, onCascade, onDelete, onFocus, onShare, onLog, config }) => {
  const { t } = useTranslation();
  const { addSVG } = useSVGLibrary();
  const [svgProcessingStatus, setSvgProcessingStatus] = React.useState<string>('');
  const [isProcessingSvg, setIsProcessingSvg] = React.useState(false);
  const [elementsManuallyEdited, setElementsManuallyEdited] = React.useState(false);
  const [promptManuallyEdited, setPromptManuallyEdited] = React.useState(false);
  const [isPromptEditing, setIsPromptEditing] = React.useState(false);
  const [isRegeneratingPrompt, setIsRegeneratingPrompt] = React.useState(false);

  const handleRetraceSVG = async () => {
    if (!row.bitmap) return;

    setIsProcessingSvg(true);
    setSvgProcessingStatus('Vectorizando bitmap...');

    try {
      onLog('info', `Re-trazando SVG desde bitmap para: ${row.UTTERANCE}`);

      const tracedSvg = await vectorizeBitmap(
        row.bitmap.replace(/^data:image\/\w+;base64,/, ""),
        {},
        (progress) => {
          setSvgProcessingStatus(`Vectorizando: ${progress}%`);
        }
      );

      // Update raw SVG
      onUpdate({ rawSvg: tracedSvg });

      onLog('success', `SVG re-trazado correctamente`);
      setSvgProcessingStatus('');
      setIsProcessingSvg(false);

    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      onLog('error', `Error al re-trazar SVG: ${msg}`);
      setSvgProcessingStatus('');
      setIsProcessingSvg(false);
    }
  };

  const handleProcessRawSVG = async () => {
    if (!row.rawSvg || !row.NLU || !row.bitmap) return;

    setIsProcessingSvg(true);
    setSvgProcessingStatus('Preparando prompt semántico...');

    try {
      await new Promise(r => setTimeout(r, 600)); // UX delay

      const nluData = typeof row.NLU === 'object' ? row.NLU as NLUData : undefined;
      if (!nluData) throw new Error("Invalid NLU data");

      onLog('info', `Estructurando SVG para: ${row.UTTERANCE}`);
      setSvgProcessingStatus('Enviando a Gemini Pro...');

      const result = await structureSVG({
        rawSvg: row.rawSvg,
        bitmap: row.bitmap,
        nlu: nluData,
        elements: row.elements || [],
        evaluation: row.evaluation || {} as EvaluationMetrics,
        utterance: row.UTTERANCE,
        config,
        onProgress: (msg) => onLog('info', msg),
        onStatus: (s) => {
          switch (s) {
            case 'sending': setSvgProcessingStatus('Enviando imagen + SVG...'); break;
            case 'receiving': setSvgProcessingStatus('Recibiendo estructura...'); break;
            case 'sanitizing': setSvgProcessingStatus('Aplicando estilos...'); break;
            default: setSvgProcessingStatus(s);
          }
        }
      });

      if (!result.success || !result.svg) {
        throw new Error(result.error || "Failed to structure SVG");
      }

      // Save to library
      addSVG({
        id: row.id,
        utterance: row.UTTERANCE,
        svg: result.svg,
        createdAt: new Date().toISOString(),
        sourceRowId: row.id,
        icapScore: row.evaluation ?
          (row.evaluation.clarity + row.evaluation.recognizability + row.evaluation.semantic_transparency +
            row.evaluation.pragmatic_fit + row.evaluation.cultural_adequacy + row.evaluation.cognitive_accessibility) / 6
          : 0,
        lang: nluData.lang
      });

      // Persist to row
      onUpdate({ structuredSvg: result.svg });

      onLog('success', `SVG estructurado correctamente`);
      setSvgProcessingStatus('');
      setIsProcessingSvg(false);

    } catch (err) {
      console.error(err);
      const msg = err instanceof Error ? err.message : "Unknown error";
      onLog('error', `Error al procesar SVG: ${msg}`);
      setSvgProcessingStatus('');
      setIsProcessingSvg(false);
    }
  };

  return (
    <div id={`pictogramRow-${row.id}`} className={`border transition-all duration-300 ${isOpen ? 'ring-8 ring-slate-100 border-violet-950 bg-white' : 'hover:border-slate-300 bg-white shadow-sm'}`}>
      <div className="p-6 flex items-center gap-8 group">
        <input
          type="text" value={row.UTTERANCE} onChange={e => onUpdate({ UTTERANCE: e.target.value, nluStatus: 'outdated', visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' })}
          className="flex-1 w-full bg-transparent border-none outline-none focus:ring-0 utterance-title text-slate-900 uppercase font-light truncate"
        />
        <div className="flex gap-2 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
          <Badge label={t('pipeline.understand').toUpperCase()} status={row.nluStatus} />
          <Badge label={t('pipeline.compose').toUpperCase()} status={row.visualStatus} />
          <Badge label={t('pipeline.produce').toUpperCase()} status={row.bitmapStatus} />
        </div>
        {(() => {
          const evalScore = getEvaluationScore(row.evaluation);
          const hasBorder = row.evaluation && row.bitmap;
          return (
            <div
              style={{
                borderColor: hasBorder ? evalScore.color : '#e2e8f0',
                borderWidth: hasBorder ? '3px' : '1px'
              }}
              className="w-14 h-14 border bg-slate-50 flex items-center justify-center p-1 group-hover:scale-110 transition-all cursor-pointer overflow-hidden relative"
              onClick={() => setIsOpen(!isOpen)}
            >
              {row.bitmap ? <img src={row.bitmap} alt="Miniature" className="w-full h-full object-contain" /> : <div className="text-slate-200"><ImageIcon size={20} /></div>}
              {hasBorder && (
                <div
                  className="absolute -top-1 -right-1 px-1 py-0.5 rounded-sm text-white font-bold text-[9px] shadow-md"
                  style={{ backgroundColor: evalScore.color }}
                >
                  {evalScore.average.toFixed(1)}
                </div>
              )}
            </div>
          );
        })()}
        <div className="flex gap-2 transition-all">
          {row.status === 'processing' ? (
            <button onClick={e => { e.stopPropagation(); onStop(); }} className="p-2 bg-orange-600 text-white hover:bg-orange-700 transition-all rounded-full shadow-sm animate-pulse" title="Detener proceso">
              <Square size={18} />
            </button>
          ) : (
            <button onClick={e => { e.stopPropagation(); onCascade(); }} className="p-2 border border-slate-200 hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full bg-white shadow-sm" title="Ejecutar pipeline completo">
              <Play size={18} />
            </button>
          )}
        </div>
        <ChevronDown onClick={() => setIsOpen(!isOpen)} size={20} className={`text-slate-300 transition-transform duration-500 cursor-pointer ${isOpen ? 'rotate-180 text-violet-950' : ''}`} />
      </div>

      {isOpen && (
        <>
          <div className="p-8 border-t bg-slate-50/30 grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in slide-in-from-top-2">
          <StepBox id="block-nlu" label={t('pipeline.understand')} status={row.nluStatus} onRegen={() => onProcess('nlu')} onStop={onStop} onFocus={() => onFocus('nlu')} duration={row.nluDuration}>
            <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' })} />
          </StepBox>
          <StepBox
            id="block-compose"
            label={t('pipeline.compose')}
            status={row.visualStatus}
            onRegen={() => {
              onProcess('visual');
              setElementsManuallyEdited(false);
              setPromptManuallyEdited(false);
            }}
            onStop={onStop}
            onFocus={() => onFocus('visual')}
            duration={row.visualDuration}
          >
            <div className="flex flex-col h-full">
              <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                <div id="hierarchical-elements">
                  <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">{t('editor.hierarchicalElements')}</label>
                  <ElementsEditor elements={row.elements || []} onUpdate={val => {
                    onUpdate({ elements: val, bitmapStatus: 'outdated', evalStatus: 'outdated', evaluation: undefined, shared: false });
                    setElementsManuallyEdited(true);
                  }} />
                  {elementsManuallyEdited && row.NLU && row.elements && row.elements.length > 0 && (
                    <button
                      onClick={async (e) => {
                        e.stopPropagation();
                        setIsRegeneratingPrompt(true);
                        await onRegeneratePrompt();
                        setIsRegeneratingPrompt(false);
                        setElementsManuallyEdited(false);
                        setPromptManuallyEdited(false);
                      }}
                      disabled={isRegeneratingPrompt}
                      className="mt-3 w-full py-2 px-3 bg-violet-950 hover:bg-black text-white transition-all flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 disabled:cursor-not-allowed animate-in fade-in slide-in-from-top-2 duration-300"
                      title={t('actions.regeneratePrompt')}
                    >
                      {isRegeneratingPrompt ? (
                        <>
                          <RefreshCw size={12} className="animate-spin" />
                          {t('actions.regenerate')}...
                        </>
                      ) : (
                        <>
                          <RefreshCw size={12} />
                          {t('actions.regeneratePrompt')}
                        </>
                      )}
                    </button>
                  )}
                </div>
                <div id="spatial-prompt" className="flex-1 mt-6 border-t pt-6 border-slate-200 flex flex-col gap-3">
                  <label className="text-[10px] font-medium uppercase text-slate-400 block tracking-widest">{t('editor.spatialLogic')}</label>
                  {isPromptEditing ? (
                    <textarea
                      value={row.prompt || ""}
                      onChange={e => {
                        onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated', evalStatus: 'outdated', evaluation: undefined, shared: false });
                        setPromptManuallyEdited(true);
                      }}
                      onBlur={() => setIsPromptEditing(false)}
                      autoFocus
                      className="w-full min-h-[100px] border-none p-0 text-sm font-light text-slate-700 outline-none focus:ring-0 bg-transparent resize-none leading-relaxed"
                    />
                  ) : (
                    <div
                      onClick={() => setIsPromptEditing(true)}
                      className="w-full min-h-[100px] cursor-text text-sm font-light text-slate-700 leading-relaxed"
                    >
                      {row.prompt && row.elements && row.elements.length > 0 ? (
                        <PromptRenderer prompt={row.prompt} elements={row.elements} />
                      ) : (
                        <div className="text-slate-400">{row.prompt || ""}</div>
                      )}
                    </div>
                  )}
                  {promptManuallyEdited && row.prompt && row.elements && row.elements.length > 0 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onProcess('bitmap');
                        setPromptManuallyEdited(false);
                      }}
                      className="mt-3 w-full py-2 px-3 bg-white border border-slate-200 hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all flex items-center justify-center gap-2 text-[10px] font-medium uppercase tracking-widest shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
                      title={t('pipeline.produce')}
                    >
                      <Play size={12} />
                      {t('pipeline.produce')}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </StepBox>
          <StepBox id="block-produce" label={t('pipeline.produce')} status={row.bitmapStatus} onRegen={() => onProcess('bitmap')} onStop={onStop} onFocus={() => onFocus('bitmap')} duration={row.bitmapDuration}
            actionNode={row.bitmap && <button onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = row.bitmap!; a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); }} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full flex items-center justify-center bg-white shadow-sm" title="Download Image"><FileDown size={14} /></button>}
          >
            <div className="flex flex-col h-full gap-4">
              {(() => {
                const evalScore = getEvaluationScore(row.evaluation);
                const hasBorder = row.evaluation && row.bitmap;
                return (
                  <div
                    style={{
                      backgroundColor: '#eeeeee',
                      borderColor: hasBorder ? evalScore.color : '#e2e8f0',
                      borderWidth: hasBorder ? '4px' : '2px'
                    }}
                    className="flex-1 border flex items-center justify-center p-4 shadow-inner relative overflow-hidden group/preview min-h-[250px] transition-all"
                  >
                    {row.bitmap ? (
                      <img src={row.bitmap} alt="Generated Pictogram" className="w-full h-full object-contain transition-transform duration-500 group-hover/preview:scale-110" />
                    ) : (
                      <div className="text-[10px] text-slate-400 uppercase font-medium">{t('editor.noBitmapRender')}</div>
                    )}
                    {hasBorder && (
                      <div
                        className="absolute top-2 right-2 px-2 py-1 rounded-sm text-white font-bold text-sm shadow-lg"
                        style={{ backgroundColor: evalScore.color }}
                      >
                        {evalScore.average.toFixed(1)}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* SVG Thumbnails Section */}
              {(row.rawSvg || row.structuredSvg) && (
                <div className="flex gap-4 items-center justify-center pt-4 border-t border-slate-200">
                  <label className="text-[10px] font-medium uppercase text-slate-400 tracking-widest mr-2">SVG:</label>

                  {row.rawSvg && (
                    <SVGThumbnail
                      svg={row.rawSvg}
                      type="raw"
                      utterance={row.UTTERANCE}
                      isProcessing={isProcessingSvg}
                      processingStatus={svgProcessingStatus}
                      aspectRatio={config.aspectRatio}
                      onDownload={() => {
                        const blob = new Blob([row.rawSvg!], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${sanitizeFilename(row.UTTERANCE)}_raw.svg`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                      onRetrace={handleRetraceSVG}
                      onProcess={handleProcessRawSVG}
                    />
                  )}

                  {row.structuredSvg && (
                    <SVGThumbnail
                      svg={row.structuredSvg}
                      type="structured"
                      utterance={row.UTTERANCE}
                      onDownload={() => {
                        const blob = new Blob([row.structuredSvg!], { type: 'image/svg+xml' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${sanitizeFilename(row.UTTERANCE)}.svg`;
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                      }}
                      onRetrace={handleRetraceSVG}
                    />
                  )}
                </div>
              )}

              {/* Evaluation Section - Integrated within Producir */}
              {row.bitmap && (
                <div className="mt-4 pt-4 border-t border-slate-200">
                  <div className="flex justify-between items-center mb-3">
                    <label className="text-[10px] font-medium uppercase text-slate-400 tracking-widest">Evaluación ICAP</label>
                    <div className="flex gap-2 items-center">
                      {(() => {
                        if (!row.evaluation) return null;
                        const avgScore = (
                          row.evaluation.clarity +
                          row.evaluation.recognizability +
                          row.evaluation.semantic_transparency +
                          row.evaluation.pragmatic_fit +
                          row.evaluation.cultural_adequacy +
                          row.evaluation.cognitive_accessibility
                        ) / 6;

                        const canShare = avgScore >= 4.0 && !row.shared;
                        const isShared = row.shared;

                        // Solo mostrar botón si puede compartir o ya está compartido
                        if (!canShare && !isShared) return null;

                        return (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (!isShared) onShare();
                            }}
                            disabled={isShared}
                            className={`p-1.5 border transition-all rounded-full flex items-center justify-center ${
                              isShared
                                ? 'border-emerald-500 text-emerald-600 bg-emerald-50 cursor-default'
                                : 'border-emerald-500 text-emerald-600 bg-slate-50 hover:bg-emerald-50 hover:border-emerald-600'
                            }`}
                            title={isShared ? t('share.alreadyShared') : t('share.shareWithPictos')}
                          >
                            {isShared ? <CheckCircle size={14} /> : <ImageUp size={14} />}
                          </button>
                        );
                      })()}
                      <button
                        onClick={() => onFocus('eval')}
                        className="p-1.5 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full flex items-center justify-center"
                        title="Abrir Editor de Evaluación"
                      >
                        <Hexagon size={14} />
                      </button>
                    </div>
                  </div>
                  {row.evaluation ? (
                    <div className="flex items-center justify-center">
                      <HexagonChart metrics={row.evaluation} size={120} />
                    </div>
                  ) : (
                    <div className="text-center py-4">
                      <button
                        onClick={() => onFocus('eval')}
                        className="flex items-center gap-2 mx-auto bg-violet-50 text-violet-700 border border-violet-200 hover:bg-violet-100 hover:border-violet-300 px-4 py-2 text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm"
                      >
                        <Hexagon size={14} /> Evaluar Pictograma
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </StepBox>
        </div>

        {/* Row Actions: Copy and Delete */}
        <div className="px-8 pb-6 bg-slate-50/30 flex justify-end gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigator.clipboard.writeText(JSON.stringify(row, null, 2))
                .then(() => {
                  onLog('success', t('actions.copyRowSuccess', { utterance: row.UTTERANCE }));
                })
                .catch((err) => {
                  onLog('error', t('actions.copyRowError', { error: err.message }));
                });
            }}
            className="p-2 border border-slate-200 hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all bg-white shadow-sm"
            title={t('actions.copyRow')}
          >
            <Copy size={14} />
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(t('actions.deleteRowConfirm', { utterance: row.UTTERANCE }))) {
                onDelete();
              }
            }}
            className="p-2 border border-slate-200 hover:border-rose-600 text-slate-400 hover:text-rose-600 transition-all bg-white shadow-sm"
            title={t('actions.deleteRow')}
          >
            <Trash2 size={14} />
          </button>
        </div>
      </>
      )}
    </div>
  );
};

const StepBox: React.FC<{ id?: string; label: string; status: StepStatus; onRegen: () => void; onStop: () => void; onFocus: () => void; duration?: number; children: React.ReactNode; actionNode?: React.ReactNode; }> = ({ id, label, status, onRegen, onStop, onFocus, duration, children, actionNode }) => {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    let interval: number;
    if (status === 'processing') {
      setElapsed(0);
      interval = window.setInterval(() => { setElapsed(prev => prev + 1); }, 1000);
    }
    return () => window.clearInterval(interval);
  }, [status]);

  const bg = status === 'processing' ? 'bg-orange-50/50' : status === 'completed' ? 'bg-white' : status === 'outdated' ? 'bg-amber-50/50' : 'bg-slate-50/50';

  return (
    <div id={id} className={`flex flex-col gap-4 min-h-[500px] border p-6 transition-all shadow-sm ${bg}`}>
      <div className="flex items-center justify-between border-b pb-4 border-slate-100">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-900">{label}</h3>
        <div className="flex items-center gap-3">
          {status === 'processing' ? (
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono font-medium text-orange-600 animate-pulse">{elapsed}s</span>
              <button onClick={onStop} className="p-2 bg-orange-600 text-white animate-spectral rounded-full"><Square size={14} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {duration && <span className="text-[10px] text-slate-400 font-mono font-medium">{duration.toFixed(1)}s</span>}
              {actionNode}
              <button onClick={onFocus} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full"><Maximize size={14} /></button>
              <button onClick={onRegen} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full"><Play size={14} /></button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
};

const SmartNLUEditor: React.FC<{ data: any; onUpdate: (v: any) => void }> = ({ data, onUpdate }) => {
  const { t } = useTranslation();
  const nlu = useMemo<Partial<NLUData>>(() => {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch (e) { return {}; }
    }
    return data || {};
  }, [data]);

  const updateField = (path: (string | number)[], value: any) => {
    const next = JSON.parse(JSON.stringify(nlu));
    let current = next;
    for (let i = 0; i < path.length - 1; i++) {
      if (current[path[i]] === undefined) {
        current[path[i]] = (typeof path[i + 1] === 'number') ? [] : {};
      }
      current = current[path[i]];
    }
    current[path[path.length - 1]] = value;
    onUpdate(next);
  };

  const renderEditableDict = (dict: Record<string, string> | undefined, path: string) => {
    return (
      <div className="space-y-2 text-xs bg-slate-50 p-2 border">
        {Object.entries(dict || {}).map(([key, value]) => (
          <div key={key} className="grid grid-cols-3 gap-2 items-center">
            <span className="font-mono text-slate-500 truncate col-span-1">{key}</span>
            <input
              type="text"
              value={value}
              onChange={e => updateField([path, key], e.target.value)}
              className="col-span-2 w-full bg-white border-b outline-none focus:border-violet-400"
            />
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <details className="border bg-white p-3 shadow-sm text-[10px]" open>
        <summary className="nlu-key cursor-pointer uppercase">{t('editor.metadataClassification')}</summary>
        <div className="mt-3 space-y-2 pt-3 border-t">
          <div className="grid grid-cols-3 gap-2 items-center">
            <label className="font-mono text-slate-500 truncate col-span-1">speech_act</label>
            <select
              value={nlu.metadata?.speech_act || ''}
              onChange={e => updateField(['metadata', 'speech_act'], e.target.value)}
              className="col-span-2 w-full bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
            >
              <option value="" disabled>Select...</option>
              {VOCAB.speech_act.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-3 gap-2 items-center">
            <label className="font-mono text-slate-500 truncate col-span-1">intent</label>
            <select
              value={nlu.metadata?.intent || ''}
              onChange={e => updateField(['metadata', 'intent'], e.target.value)}
              className="col-span-2 w-full bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
            >
              <option value="" disabled>Select...</option>
              {VOCAB.intent.map(opt => <option key={opt} value={opt}>{opt}</option>)}
            </select>
          </div>
        </div>
      </details>

      {nlu.frames?.map((frame, fIdx) => (
        <details key={fIdx} className="border bg-white p-3 shadow-sm text-[10px]" open>
          <summary className="nlu-key cursor-pointer uppercase">{frame.frame_name} <span className="font-mono lowercase text-violet-500">({frame.lexical_unit})</span></summary>
          <div className="mt-3 space-y-2 pt-3 border-t">
            {Object.entries(frame.roles || {}).map(([role, rawData]) => {
              const data = rawData as NLUFrameRole;
              return (
                <div key={role} className="flex gap-2">
                  <span className="font-medium w-20 text-slate-500 shrink-0">{role}:</span>
                  <span className="text-slate-900 truncate">{data.surface} <span className="text-[9px] text-violet-400">[{data.type}]</span></span>
                </div>
              )
            })}
          </div>
        </details>
      ))}

      <details className="border bg-white p-3 shadow-sm text-[10px]">
        <summary className="nlu-key cursor-pointer">{t('editor.detailedAnalysis').toUpperCase()}</summary>
        <div className="mt-3 space-y-4 pt-3 border-t">
          <div>
            <h4 className="nlu-key mb-1">{t('editor.nsmExplications').toUpperCase()}</h4>
            {renderEditableDict(nlu.nsm_explications, 'nsm_explications')}
          </div>
          <div>
            <h4 className="nlu-key mb-1">{t('editor.logicalForm').toUpperCase()}</h4>
            {renderEditableDict(nlu.logical_form as unknown as Record<string, string>, 'logical_form')}
          </div>
          <div>
            <h4 className="nlu-key mb-1">PRAGMATICS</h4>
            {renderEditableDict(nlu.pragmatics as unknown as Record<string, string>, 'pragmatics')}
          </div>
        </div>
      </details>
    </div>
  );
};

const PromptRenderer: React.FC<{ prompt: string; elements: VisualElement[] }> = ({ prompt, elements }) => {
  if (!prompt) return null;

  // Collect all element IDs recursively
  const getAllElementIds = (items: VisualElement[]): string[] => {
    return items.flatMap(item => [
      item.id,
      ...(item.children ? getAllElementIds(item.children) : [])
    ]);
  };

  const elementIds = getAllElementIds(elements);

  // Parse prompt and replace 'element_id' with pills
  const renderPromptWithPills = () => {
    // Match single-quoted strings that are element IDs
    const regex = /'([^']+)'/g;
    const parts: React.ReactNode[] = [];
    let lastIndex = 0;
    let match;

    while ((match = regex.exec(prompt)) !== null) {
      const beforeText = prompt.substring(lastIndex, match.index);
      const quotedText = match[1];

      // Add text before the match
      if (beforeText) {
        parts.push(beforeText);
      }

      // Check if quoted text is an element ID
      if (elementIds.includes(quotedText)) {
        parts.push(
          <span key={match.index} className="element-pill">
            {quotedText}
          </span>
        );
      } else {
        // Not an element, keep the quotes
        parts.push(`'${quotedText}'`);
      }

      lastIndex = regex.lastIndex;
    }

    // Add remaining text
    if (lastIndex < prompt.length) {
      parts.push(prompt.substring(lastIndex));
    }

    return parts;
  };

  return (
    <div className="prompt-text text-sm text-slate-600 leading-relaxed p-3 bg-slate-50 rounded border border-slate-200">
      {renderPromptWithPills()}
    </div>
  );
};

const ElementsEditor: React.FC<{ elements: VisualElement[]; onUpdate: (v: VisualElement[]) => void; }> = ({ elements, onUpdate }) => {
  const { t } = useTranslation();
  const safeElements = Array.isArray(elements) ? elements : [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');

  const addElement = (parentId: string | null = null) => {
    const newId = `elemento`;
    const newElement: VisualElement = { id: newId };

    if (parentId === null) {
      onUpdate([...safeElements, newElement]);
    } else {
      const update = (items: VisualElement[]): VisualElement[] => {
        return items.map(item => {
          if (item.id === parentId) {
            return { ...item, children: [...(item.children || []), newElement] };
          }
          if (item.children) {
            return { ...item, children: update(item.children) };
          }
          return item;
        });
      };
      onUpdate(update(safeElements));
    }
    // Auto-select new element for editing
    setTimeout(() => {
      setEditingId(newId);
      setEditingValue(newId);
    }, 50);
  };

  const removeElement = (idToRemove: string) => {
    const filter = (items: VisualElement[]): VisualElement[] => {
      return items
        .filter(item => item.id !== idToRemove)
        .map(item => {
          if (item.children) {
            return { ...item, children: filter(item.children) };
          }
          return item;
        });
    };
    onUpdate(filter(safeElements));
  };

  const updateElementId = (oldId: string, newId: string) => {
    if (!newId.trim() || newId === oldId) {
      setEditingId(null);
      return;
    }
    const update = (items: VisualElement[]): VisualElement[] => {
      return items.map(item => {
        if (item.id === oldId) {
          return { ...item, id: newId.trim() };
        }
        if (item.children) {
          return { ...item, children: update(item.children) };
        }
        return item;
      });
    };
    onUpdate(update(safeElements));
    setEditingId(null);
  };

  const handlePillClick = (element: VisualElement) => {
    setEditingId(element.id);
    setEditingValue(element.id);
  };

  const handleKeyDown = (e: React.KeyboardEvent, elementId: string) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      updateElementId(elementId, editingValue);
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  };

  const renderElement = (element: VisualElement, level = 0, isLast = false) => {
    const isEditing = editingId === element.id;
    const isRoot = level === 0;

    return (
      <div key={element.id} className={`element-item ${isRoot ? 'element-root' : ''}`}>
        {!isRoot && <div className="element-dot" />}

        <div className="flex items-center gap-2">
          {isEditing ? (
            <div className="element-pill element-editing">
              <input
                type="text"
                value={editingValue}
                onChange={(e) => setEditingValue(e.target.value)}
                onBlur={() => updateElementId(element.id, editingValue)}
                onKeyDown={(e) => handleKeyDown(e, element.id)}
                autoFocus
                className="element-pill-input"
              />
            </div>
          ) : (
            <div className="element-pill" onClick={() => handlePillClick(element)}>
              {element.id}
            </div>
          )}

          <div className="element-actions">
            <button
              onClick={() => addElement(element.id)}
              className="element-action-btn"
              title="Agregar hijo"
            >
              <CornerDownRight size={12} />
            </button>
            <button
              onClick={() => removeElement(element.id)}
              className="element-action-btn delete"
              title="Eliminar"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {element.children && element.children.length > 0 && (
          <div>
            {element.children.map((child, idx) =>
              renderElement(child, level + 1, idx === element.children!.length - 1)
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="border p-4 min-h-[120px] bg-white shadow-inner">
      <div className="element-tree">
        {safeElements.map((el, idx) => renderElement(el, 0, idx === safeElements.length - 1))}
      </div>
      <button
        onClick={() => addElement(null)}
        className="mt-4 pt-3 border-t border-slate-200 text-left text-[10px] font-bold text-violet-600 hover:text-violet-900 transition-colors w-full flex items-center gap-2 uppercase tracking-wider"
      >
        <Plus size={14} /> {t('editor.addRootElement')}
      </button>
    </div>
  );
};

const Badge: React.FC<{ label: string; status: StepStatus }> = ({ label, status }) => {
  const styles = {
    idle: 'bg-slate-100 text-slate-300 border-slate-200',
    processing: 'bg-orange-600 text-white animate-pulse border-orange-500',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    outdated: 'bg-amber-50 text-amber-800 border-amber-300',
    error: 'bg-rose-50 text-rose-700 border-rose-300'
  };
  return <div className={`px-2.5 py-0.5 text-[8px] font-medium uppercase tracking-widest border transition-all ${styles[status]}`}>{label}</div>;
};

const FocusViewModal: React.FC<{
  mode: 'nlu' | 'visual' | 'bitmap' | 'eval';
  row: RowData;
  onClose: () => void;
  onUpdate: (updates: Partial<RowData>) => void;
  onShare: () => void;
  onRegeneratePrompt: () => void;
  config: GlobalConfig;
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
}> = ({ mode, row, onClose, onUpdate, onShare, onRegeneratePrompt, config, onLog }) => {
  const { t } = useTranslation();
  const [copyStatus, setCopyStatus] = useState(t('actions.copy'));
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [elementsManuallyEdited, setElementsManuallyEdited] = useState(false);
  const [isRegeneratingPrompt, setIsRegeneratingPrompt] = useState(false);

  const handleCopy = () => {
    let contentToCopy: string = '';
    if (mode === 'nlu') {
      contentToCopy = JSON.stringify(row.NLU, null, 2);
    } else if (mode === 'visual') {
      contentToCopy = JSON.stringify({ "elements": row.elements, "prompt": row.prompt }, null, 2);
    } else if (mode === 'bitmap') {
      contentToCopy = row.prompt || '';
    } else if (mode === 'eval') {
      contentToCopy = JSON.stringify(row.evaluation, null, 2);
    }

    if (contentToCopy) {
      navigator.clipboard.writeText(contentToCopy).then(() => {
        setCopyStatus(t('actions.copied'));
        setTimeout(() => setCopyStatus(t('actions.copy')), 2000);
      });
    }
  };

  const titleMap = {
    nlu: t('pipeline.understand'),
    visual: t('pipeline.compose'),
    bitmap: t('pipeline.produce'),
    eval: t('evaluation.icap')
  };

  const renderContent = () => {
    switch (mode) {
      case 'nlu': return <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' })} />;
      case 'visual': return (
        <div className="flex flex-col h-full gap-6">
          <div>
            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">{t('editor.hierarchicalElements')}</label>
            <ElementsEditor elements={row.elements || []} onUpdate={val => {
              onUpdate({ elements: val, bitmapStatus: 'outdated', evalStatus: 'outdated', evaluation: undefined, shared: false });
              setElementsManuallyEdited(true);
            }} />
            {elementsManuallyEdited && row.NLU && row.elements && row.elements.length > 0 && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  setIsRegeneratingPrompt(true);
                  await onRegeneratePrompt();
                  setIsRegeneratingPrompt(false);
                  setElementsManuallyEdited(false);
                }}
                disabled={isRegeneratingPrompt}
                className="mt-3 w-full py-2 px-3 bg-violet-950 hover:bg-black text-white transition-all flex items-center justify-end gap-2 text-[10px] font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 disabled:cursor-not-allowed animate-in fade-in slide-in-from-top-2 duration-300"
                title={t('actions.regeneratePrompt')}
              >
                {isRegeneratingPrompt ? (
                  <>
                    <RefreshCw size={12} className="animate-spin" />
                    {t('actions.regenerate')}...
                  </>
                ) : (
                  <>
                    <RefreshCw size={12} />
                    {t('actions.regeneratePrompt')}
                  </>
                )}
              </button>
            )}
          </div>
          <div className="flex-1 mt-6 border-t pt-6 border-slate-200">
            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-3 tracking-widest">{t('editor.spatialLogic')}</label>
            {isPromptEditing ? (
              <textarea
                value={row.prompt || ""}
                onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated', evalStatus: 'outdated', evaluation: undefined, shared: false })}
                onBlur={() => setIsPromptEditing(false)}
                autoFocus
                className="w-full h-full border-none p-0 text-lg font-light text-slate-700 outline-none focus:ring-0 bg-transparent resize-none leading-relaxed"
              />
            ) : (
              <div
                onClick={() => setIsPromptEditing(true)}
                className="w-full h-full cursor-text text-lg font-light text-slate-700 leading-relaxed"
              >
                {row.prompt && row.elements && row.elements.length > 0 ? (
                  <PromptRenderer prompt={row.prompt} elements={row.elements} />
                ) : (
                  <div className="text-slate-400">{row.prompt || ""}</div>
                )}
              </div>
            )}
          </div>
        </div>
      );
      case 'bitmap':
        return (
          <div className="flex items-center justify-center h-full bg-neutral-200 p-8 border-2 border-slate-300 shadow-inner">
            {row.bitmap ? (
              <img src={row.bitmap} className="max-w-full max-h-full object-contain shadow-2xl bg-white" alt="Full size render" />
            ) : (
              <p className="text-slate-400 font-mono">No bitmap generated yet.</p>
            )}
          </div>
        );
      case 'eval':
        return (
          <div className="flex h-full bg-slate-50 gap-0">
            {/* Left Column: Image Section + SVG Generator */}
            <div className="w-5/12 bg-white border-r border-slate-200 flex flex-col">
              {/* Top half: Bitmap */}
              <div className="h-1/2 flex items-center justify-center p-8 relative border-b border-slate-100">
                <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                {row.bitmap ? (
                  <img src={row.bitmap} alt="Evaluation Context" className="max-w-full max-h-full object-contain shadow-lg" />
                ) : (
                  <div className="text-slate-300 font-mono text-xs">{t('editor.noBitmapReference')}</div>
                )}
              </div>

              {/* Bottom half: SVG Generator + Share */}
              <div className="h-1/2 p-6 bg-slate-50 flex flex-col">
                <div className="flex justify-between items-center mb-3">
                  <h3 className="text-[10px] font-bold uppercase text-slate-400 tracking-widest">SVG Output (SSoT)</h3>
                  {(() => {
                    if (!row.evaluation) return null;
                    const avgScore = (
                      row.evaluation.clarity +
                      row.evaluation.recognizability +
                      row.evaluation.semantic_transparency +
                      row.evaluation.pragmatic_fit +
                      row.evaluation.cultural_adequacy +
                      row.evaluation.cognitive_accessibility
                    ) / 6;

                    const canShare = avgScore >= 4.0 && !row.shared;
                    const isShared = row.shared;

                    if (!canShare && !isShared) return null;

                    return (
                      <button
                        onClick={onShare}
                        disabled={isShared}
                        className={`p-2 transition-all shadow-sm ${
                          isShared
                            ? 'bg-emerald-50 text-emerald-600 border border-emerald-200 cursor-default'
                            : 'bg-slate-50 text-emerald-600 border border-emerald-500 hover:bg-emerald-50 hover:border-emerald-600'
                        }`}
                        title={isShared ? t('share.alreadyShared') : t('share.shareWithPictos')}
                      >
                        {isShared ? <CheckCircle size={14} /> : <ImageUp size={14} />}
                      </button>
                    );
                  })()}
                </div>
                <div className="flex-1 overflow-hidden">
                  <SVGGenerator row={row} config={config} onLog={onLog} onUpdate={onUpdate} />
                </div>
              </div>
            </div>

            {/* Right Column: Editor Section */}
            <div className="w-7/12 p-8 flex flex-col overflow-hidden">
              <div className="flex-1 flex flex-col min-h-0">
                <EvaluationEditor
                  metrics={row.evaluation}
                  onUpdate={(m) => onUpdate({ evaluation: m })}
                  compact={true}
                />
              </div>
            </div>
          </div>
        );
      default: return null;
    }
  }

  return (
    <div className="focus-modal-backdrop animate-in fade-in duration-300" onClick={onClose}>
      <div className="focus-modal-content animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
        <header className="p-4 border-b bg-white flex justify-between items-center">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider">{titleMap[mode]}</h2>
            <p className="text-xs text-slate-400 truncate max-w-md">{row.UTTERANCE}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100"><X size={18} /></button>
        </header>
        <main className="flex-1 p-6 overflow-auto bg-slate-50">{renderContent()}</main>
        <footer className="p-4 border-t bg-white flex justify-end gap-3">
          {mode === 'bitmap' && row.bitmap && (
            <button onClick={() => { const a = document.createElement('a'); a.href = row.bitmap!; a.download = 'pictogram.png'; a.click(); }} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-6 py-3 font-bold uppercase text-[10px] tracking-widest hover:bg-slate-200 transition-all">
              <Download size={14} /> Download PNG
            </button>
          )}
          <button onClick={handleCopy} className="flex items-center gap-2 bg-violet-950 text-white px-6 py-3 font-bold uppercase text-[10px] tracking-widest hover:bg-black transition-all shadow-lg">
            <Copy size={14} /> {copyStatus}
          </button>
          {mode === 'eval' && (
            <button
              onClick={() => {
                onUpdate({ evalStatus: 'completed' });
                onClose();
              }}
              className="flex items-center gap-2 bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 hover:border-emerald-300 px-6 py-3 text-[10px] font-bold uppercase tracking-widest transition-all rounded-sm shadow-sm"
            >
              <CheckCircle size={14} className="text-emerald-600" /> Confirmar Evaluación
            </button>
          )}
        </footer>
      </div>
    </div>
  )
};

export default App;
