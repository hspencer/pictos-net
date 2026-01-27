
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import {
  Upload, Download, Trash2, Terminal, RefreshCw, ChevronDown,
  PlayCircle, BookOpen, Search, FileDown, StopCircle, Sparkles, Sliders,
  X, Code, Plus, FileText, Maximize, Copy, BrainCircuit, PlusCircle, CornerDownRight, Image as ImageIcon,
  Library, Share2, MapPin, Globe, Crosshair, Hexagon, Save, Edit3, HelpCircle, CheckCircle, Languages
} from 'lucide-react';
import { RowData, LogEntry, StepStatus, NLUData, GlobalConfig, VOCAB, VisualElement, EvaluationMetrics, NLUFrameRole } from './types';
import * as Gemini from './services/geminiService';
import { VCSCI_MODULE } from './data/canonicalData';
import { useTranslation } from './hooks/useTranslation';
import type { Locale } from './locales';

const STORAGE_KEY = 'pictonet_v19_storage';
const CONFIG_KEY = 'pictonet_v19_config';
const APP_VERSION = '2.6';

const PipelineIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

// Helper function to get evaluation score total and color
const getEvaluationScore = (metrics: EvaluationMetrics | undefined): { total: number; average: number; color: string } => {
  if (!metrics) return { total: 0, average: 0, color: '#64748b' };
  const { semantics, syntactics, pragmatics, clarity, universality, aesthetics } = metrics;
  const total = semantics + syntactics + pragmatics + clarity + universality + aesthetics;
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
    
    // Order: Semantics, Syntactics, Pragmatics, Clarity, Universality, Aesthetics
    const axes = ['semantics', 'syntactics', 'pragmatics', 'clarity', 'universality', 'aesthetics'];
    const labels = ['SEM', 'SYN', 'PRA', 'CLA', 'UNI', 'AES'];
    
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
                    <div className="text-[9px] font-bold text-slate-400 uppercase tracking-widest">VCSCI</div>
                    <div className="text-2xl font-bold text-violet-950 leading-none">{average}</div>
                </div>
            </div>
        </div>
    );
};

// --- Evaluation Editor Component (Likert 1-5) ---
const EvaluationEditor: React.FC<{
    metrics: EvaluationMetrics | undefined;
    onUpdate: (m: EvaluationMetrics) => void;
    compact?: boolean; // New prop for modal view
}> = ({ metrics, onUpdate, compact = false }) => {

    // Default state: 3 (Neutral)
    const current = metrics || {
        semantics: 3, syntactics: 3, pragmatics: 3,
        clarity: 3, universality: 3, aesthetics: 3,
        reasoning: ''
    };

    const handleChange = (key: keyof EvaluationMetrics, value: any) => {
        onUpdate({ ...current, [key]: value });
    };

    const axes = [
        { key: 'semantics', label: 'Semantics', desc: 'Accuracy of meaning' },
        { key: 'syntactics', label: 'Syntactics', desc: 'Visual composition' },
        { key: 'pragmatics', label: 'Pragmatics', desc: 'Context fitness' },
        { key: 'clarity', label: 'Clarity', desc: 'Legibility' },
        { key: 'universality', label: 'Universality', desc: 'Neutrality' },
        { key: 'aesthetics', label: 'Aesthetics', desc: 'Appeal' }
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
                                 <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider">{axis.label}</span>
                                 <div className="flex gap-1">
                                    {[1,2,3,4,5].map(v => (
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
                     <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Reasoning</label>
                     <textarea
                         value={current.reasoning}
                         onChange={(e) => handleChange('reasoning', e.target.value)}
                         placeholder="Optional rationale..."
                         className="w-full text-xs p-2 border bg-slate-50 focus:bg-white flex-1 resize-none rounded-sm outline-none focus:border-violet-300 transition-colors"
                     />
                </div>
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
                                 <span className="text-[10px] font-bold uppercase text-slate-600 tracking-wider">{axis.label}</span>
                                 <div className="flex gap-1">
                                    {[1,2,3,4,5].map(v => (
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
                 <label className="text-[10px] font-medium uppercase text-slate-400 block mb-1">Human Reasoning</label>
                 <textarea
                     value={current.reasoning}
                     onChange={(e) => handleChange('reasoning', e.target.value)}
                     placeholder="Rationale for the score..."
                     className="w-full text-xs p-2 border bg-slate-50 focus:bg-white h-24 resize-none rounded-sm outline-none focus:border-violet-300 transition-colors"
                 />
            </div>
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
    geoContext: { lat: '40.4168', lng: '-3.7038', region: 'Madrid, ES' }
  });
  const [focusMode, setFocusMode] = useState<{ step: 'nlu' | 'visual' | 'bitmap' | 'eval', rowId: string } | null>(null);
  const [showMapInputs, setShowMapInputs] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const stopFlags = useRef<Record<string, boolean>>({});

  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    const savedConfig = localStorage.getItem(CONFIG_KEY);
    if (saved) { try { const parsed = JSON.parse(saved); setRows(parsed); if(parsed.length > 0) setViewMode('list'); } catch(e){} }
    if (savedConfig) { try { setConfig(JSON.parse(savedConfig)); } catch(e){} }
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(rows));
    localStorage.setItem(CONFIG_KEY, JSON.stringify(config));
  }, [rows, config]);

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
    const dataToExport = {
      version: APP_VERSION,
      type: 'pictonet_graph_dump',
      timestamp: new Date().toISOString(),
      config,
      rows 
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
            setRows(parsed);
            addLog('success', `Importados ${parsed.length} nodos (Formato Legacy).`);
        } 
        else if (parsed.rows && Array.isArray(parsed.rows)) {
            setRows(parsed.rows);
            if (parsed.config) {
                const newConfig = { ...parsed.config };
                if (!newConfig.aspectRatio) newConfig.aspectRatio = '1:1';
                if (!newConfig.imageModel) newConfig.imageModel = 'flash';
                setConfig(newConfig);
                addLog('info', 'Configuración global restaurada.');
            }
            addLog('success', `Grafo restaurado: ${parsed.rows.length} nodos.`);
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
    const confirmed = window.confirm(t('actions.deleteAllConfirm'));
    if (confirmed) {
      setRows([]);
      setLogs([]);
      localStorage.removeItem(STORAGE_KEY);
      setViewMode('home');
      setShowLibraryMenu(false);
      addLog('info', t('messages.allCleared'));
    }
  };

  const loadVCSCIModule = () => {
    if (rows.length > 0) {
      const confirmed = window.confirm(t('home.loadVCSCIWarning', { count: rows.length }));
      if (!confirmed) return;
    }
    setRows(VCSCI_MODULE.data as RowData[]);
    setViewMode('list');
  };

  const updateRow = (index: number, updates: Partial<RowData>) => {
    setRows(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
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
      if (step === 'nlu') result = await Gemini.generateNLU(row.UTTERANCE);
      else if (step === 'visual') {
        const nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
        result = await Gemini.generateVisualBlueprint(nluObj as NLUData, config);
      } else if (step === 'bitmap') {
          result = await Gemini.generateImage(row.elements || [], row.prompt || "", row, config);
      }

      if (stopFlags.current[row.id]) return false;

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
        updateRow(index, { nluStatus: 'processing', visualStatus: 'idle', bitmapStatus: 'idle', evalStatus: 'idle' });
        const nluStartTime = Date.now();
        const nluResult = await Gemini.generateNLU(row.UTTERANCE);
        if (stopFlags.current[row.id]) { addLog('info', `Cascada detenida en NLU para ${row.UTTERANCE}`); updateRow(index, { nluStatus: 'idle' }); return; }
        finalUpdates.NLU = nluResult;
        finalUpdates.nluStatus = 'completed';
        finalUpdates.nluDuration = (Date.now() - nluStartTime) / 1000;
        addLog('success', `NLU Node calculado en ${finalUpdates.nluDuration.toFixed(1)}s`);
        
        // --- Visual Step ---
        updateRow(index, { nluStatus: 'completed', nluDuration: finalUpdates.nluDuration, NLU: nluResult, visualStatus: 'processing' });
        const visualStartTime = Date.now();
        const visualResult = await Gemini.generateVisualBlueprint(nluResult, config);
        if (stopFlags.current[row.id]) { addLog('info', `Cascada detenida en Visual para ${row.UTTERANCE}`); updateRow(index, { visualStatus: 'idle' }); return; }
        finalUpdates.elements = visualResult.elements;
        finalUpdates.prompt = visualResult.prompt;
        finalUpdates.visualStatus = 'completed';
        finalUpdates.visualDuration = (Date.now() - visualStartTime) / 1000;
        addLog('success', `Visual Topology generada en ${finalUpdates.visualDuration.toFixed(1)}s`);

        // --- Bitmap Step (NanoBanana) ---
        updateRow(index, { visualStatus: 'completed', visualDuration: finalUpdates.visualDuration, elements: visualResult.elements, prompt: visualResult.prompt, bitmapStatus: 'processing' });
        const bitmapStartTime = Date.now();
        const bitmapResult = await Gemini.generateImage(visualResult.elements!, visualResult.prompt!, row, config);
        if (stopFlags.current[row.id]) { addLog('info', `Cascada detenida en Bitmap para ${row.UTTERANCE}`); updateRow(index, { bitmapStatus: 'idle' }); return; }
        finalUpdates.bitmap = bitmapResult;
        finalUpdates.bitmapStatus = 'completed';
        finalUpdates.bitmapDuration = (Date.now() - bitmapStartTime) / 1000;
        addLog('success', `Bitmap Renderizado en ${finalUpdates.bitmapDuration.toFixed(1)}s`);
        
        // --- End of Automation ---
        // We do NOT auto-run evaluation. It is manual.
        // We set evalStatus to 'idle' to indicate it is ready for input.
        finalUpdates.evalStatus = 'idle';

        finalUpdates.status = 'completed';
        updateRow(index, finalUpdates);

    } catch (err: any) {
        let stepFailed: 'nlu' | 'visual' | 'bitmap' = 'nlu';
        if (finalUpdates.nluStatus === 'completed' && finalUpdates.visualStatus !== 'completed') stepFailed = 'visual';
        else if (finalUpdates.visualStatus === 'completed') stepFailed = 'bitmap';
        
        updateRow(index, { [`${stepFailed}Status`]: 'error', status: 'error' });
        addLog('error', `Fallo de nodo (${stepFailed.toUpperCase()}) para "${row.UTTERANCE}": ${err.message}`);
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
    const { semantics, syntactics, pragmatics, clarity, universality, aesthetics } = row.evaluation;
    return semantics + syntactics + pragmatics + clarity + universality + aesthetics;
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
      <header className="h-20 bg-white border-b border-slate-200 sticky top-0 z-50 flex items-center px-8 justify-between shadow-sm">
        <div className="flex items-center gap-4 cursor-pointer" onClick={() => setViewMode('home')}>
          <div className="bg-violet-950 p-2.5 text-white"><PipelineIcon size={24} /></div>
          <div>
            <h1 className="font-bold uppercase tracking-tight text-xl text-slate-900 leading-none">{config.author}</h1>
            <span className="text-[9px] text-slate-400 font-mono tracking-widest uppercase">v{APP_VERSION} {t('header.subtitle')}</span>
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
                <Library size={18}/>
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
                            <Upload size={14} className="text-violet-950"/> {t('actions.import')}
                        </button>
                        <button
                            onClick={() => { exportProject(); setShowLibraryMenu(false); }}
                            disabled={rows.length === 0}
                            className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-50"
                        >
                            <Download size={14} className="text-emerald-600"/> {t('actions.export')}
                        </button>
                        <div className="border-t border-slate-100 my-1"></div>
                        <button
                            onClick={clearAll}
                            disabled={rows.length === 0}
                            className="w-full text-left px-4 py-3 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-3 transition-colors disabled:opacity-50 disabled:text-slate-400"
                        >
                            <Trash2 size={14} className="text-rose-600"/> {t('actions.deleteAll')}
                        </button>
                    </div>
                </>
             )}
          </div>

          <div className="w-px h-8 bg-slate-200 mx-2"></div>

          <button onClick={() => setShowConfig(!showConfig)} className={`p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all ${showConfig ? 'bg-slate-100 text-violet-950' : ''}`} title={t('header.settingsTooltip')}><Sliders size={18}/></button>
          <button onClick={() => setShowConsole(!showConsole)} className="p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all" title={t('header.consoleTooltip')}><Terminal size={18}/></button>
        </div>
      </header>

      {showConfig && (
        <div className="fixed top-20 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b shadow-2xl p-8 animate-in slide-in-from-top duration-200">
          <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-6">
            <div className="md:col-span-4">
                <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Visual Style Prompt (Node Attribute)</label>
                <textarea value={config.visualStylePrompt} onChange={e => setConfig({...config, visualStylePrompt: e.target.value})} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-24" />
            </div>
            
            <div className="md:col-span-1 relative group">
               <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 flex justify-between">
                  <span>Geo-Linguistic Context</span>
                  <button onClick={() => setShowMapInputs(!showMapInputs)} className="text-violet-600 hover:text-violet-900 flex items-center gap-1">
                     <MapPin size={10} /> {showMapInputs ? 'Simple' : 'Map Mode'}
                  </button>
               </label>
               <div className={`border p-3 bg-slate-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-200 transition-colors flex flex-col gap-2 ${showMapInputs ? 'h-32' : ''}`}>
                  <div className="flex items-center gap-2">
                     <Globe size={14} className="text-slate-400"/>
                     <input type="text" placeholder="Language (es, en...)" value={config.lang} onChange={e => setConfig({...config, lang: e.target.value})} className="w-full text-xs bg-transparent border-none outline-none font-medium" />
                  </div>
                  {showMapInputs && (
                    <div className="animate-in fade-in slide-in-from-top-1 pt-2 border-t border-slate-200 flex flex-col gap-2">
                        <div className="flex items-center gap-2">
                            <MapPin size={14} className="text-rose-400"/>
                            <input type="text" placeholder="Region Name (e.g. Madrid)" value={config.geoContext?.region || ''} onChange={e => setConfig({...config, geoContext: { ...config.geoContext, region: e.target.value } as any })} className="w-full text-[10px] bg-transparent border-none outline-none" />
                        </div>
                        <div className="flex gap-2">
                           <div className="flex items-center gap-1 bg-white border rounded px-1">
                              <Crosshair size={10} className="text-slate-400"/>
                              <input type="text" placeholder="Lat" value={config.geoContext?.lat || ''} onChange={e => setConfig({...config, geoContext: { ...config.geoContext, lat: e.target.value } as any })} className="w-full text-[9px] bg-transparent outline-none" />
                           </div>
                           <div className="flex items-center gap-1 bg-white border rounded px-1">
                              <Crosshair size={10} className="text-slate-400"/>
                              <input type="text" placeholder="Lng" value={config.geoContext?.lng || ''} onChange={e => setConfig({...config, geoContext: { ...config.geoContext, lng: e.target.value } as any })} className="w-full text-[9px] bg-transparent outline-none" />
                           </div>
                        </div>
                    </div>
                  )}
               </div>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Aspect Ratio</label>
              <select value={config.aspectRatio} onChange={e => setConfig({...config, aspectRatio: e.target.value})} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]">
                <option value="1:1">Square (1:1)</option>
                <option value="4:3">Standard (4:3)</option>
                <option value="3:4">Portrait (3:4)</option>
                <option value="16:9">Widescreen (16:9)</option>
                <option value="9:16">Mobile (9:16)</option>
              </select>
            </div>

            <div className="md:col-span-1">
                <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Image Model</label>
                <select value={config.imageModel || 'flash'} onChange={e => setConfig({...config, imageModel: e.target.value})} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]">
                    <option value="flash">NanoBanana (Flash 2.5)</option>
                    <option value="pro">NanoBanana Pro (Gemini 3 Pro)</option>
                </select>
            </div>

            <div className="md:col-span-1">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2">Author Signature</label>
              <input type="text" value={config.author} onChange={e => setConfig({...config, author: e.target.value})} className="w-full text-xs border p-3 bg-slate-50 focus:bg-white transition-colors h-[42px]" />
            </div>
          </div>
        </div>
      )}

      <main className="flex-1 p-8 max-w-7xl mx-auto w-full">
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
                <Share2 size={14}/> Graph Architecture
              </div>
              <h2 className="text-8xl font-black tracking-tighter text-slate-900 leading-none">{config.author}</h2>
              <p className="text-slate-400 text-xl font-medium max-w-2xl mx-auto leading-relaxed">
                {t('home.description')}
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div onClick={loadVCSCIModule} className="bg-white p-12 border border-slate-200 text-left space-y-6 shadow-xl hover:border-violet-950 transition-all cursor-pointer group hover:-translate-y-1 relative overflow-hidden">
                <div className="absolute top-0 right-0 bg-emerald-100 text-emerald-800 text-[9px] font-bold px-2 py-1 uppercase tracking-widest">{VCSCI_MODULE.version}</div>
                <div className="text-emerald-600 group-hover:scale-110 transition-transform"><BookOpen size={40}/></div>
                <div>
                    <h3 className="font-bold text-xl uppercase tracking-wider text-slate-900">VCSCI Core Module</h3>
                    <div className="text-[10px] text-slate-400 font-mono mt-1">{VCSCI_MODULE.namespace}</div>
                </div>
                <p className="text-xs text-slate-500 leading-relaxed font-medium">{VCSCI_MODULE.description}</p>
              </div>

              <div onClick={() => fileInputRef.current?.click()} className="bg-violet-950 p-12 text-left space-y-6 shadow-xl hover:bg-black transition-all cursor-pointer group hover:-translate-y-1">
                <div className="text-white group-hover:scale-110 transition-transform"><FileText size={40}/></div>
                <div>
                    <h3 className="font-bold text-xl uppercase tracking-wider text-white">Import Text Node</h3>
                    <div className="text-[10px] text-violet-400 font-mono mt-1">raw_text_ingest</div>
                </div>
                <p className="text-xs text-violet-300 leading-relaxed font-medium">Carga un archivo de texto con una frase por línea para iniciar el proceso de grafado.</p>
                <input ref={fileInputRef} type="file" accept=".txt" className="hidden" onChange={e => e.target.files?.[0]?.text().then(processPhrases)}/>
              </div>
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
                  onStop={() => stopFlags.current[row.id] = true}
                  onCascade={() => processCascade(globalIndex)}
                  onDelete={() => setRows(prev => prev.filter(r => r.id !== row.id))}
                  onFocus={step => setFocusMode({ step, rowId: row.id })}
                />
              );
            })}
          </div>
        )}
      </main>
      
      {showConsole && (
        <div className="fixed bottom-0 inset-x-0 h-64 bg-slate-950 text-slate-400 mono text-[10px] p-6 z-50 border-t border-slate-800 overflow-auto shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-900 font-medium tracking-widest uppercase">
            <span className="flex items-center gap-3"><Terminal size={14}/> Semantic Trace Monitor</span> 
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
        />
      )}
    </div>
  );
};

const RowComponent: React.FC<{
    row: RowData; isOpen: boolean; setIsOpen: (v: boolean) => void;
    onUpdate: (u: any) => void; onProcess: (s: any) => Promise<boolean>;
    onStop: () => void; onCascade: () => void; onDelete: () => void;
    onFocus: (step: 'nlu' | 'visual' | 'bitmap' | 'eval') => void;
}> = ({ row, isOpen, setIsOpen, onUpdate, onProcess, onStop, onCascade, onDelete, onFocus }) => {
    const { t } = useTranslation();
    return (
      <div className={`border transition-all duration-300 ${isOpen ? 'ring-8 ring-slate-100 border-violet-950 bg-white' : 'hover:border-slate-300 bg-white shadow-sm'}`}>
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
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={e => { e.stopPropagation(); onCascade(); }} className="p-3 bg-violet-950 text-white shadow-lg hover:bg-black transition-all"><PlayCircle size={18}/></button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-3 text-rose-300 hover:text-rose-600 transition-colors"><Trash2 size={18}/></button>
          </div>
          <ChevronDown onClick={() => setIsOpen(!isOpen)} size={20} className={`text-slate-300 transition-transform duration-500 cursor-pointer ${isOpen ? 'rotate-180 text-violet-950' : ''}`} />
        </div>
  
        {isOpen && (
          <div className="p-8 border-t bg-slate-50/30 grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in slide-in-from-top-2">
            <StepBox label={t('pipeline.understand')} status={row.nluStatus} onRegen={() => onProcess('nlu')} onStop={onStop} onFocus={() => onFocus('nlu')} duration={row.nluDuration}>
              <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' })} />
            </StepBox>
            <StepBox label={t('pipeline.compose')} status={row.visualStatus} onRegen={() => onProcess('visual')} onStop={onStop} onFocus={() => onFocus('visual')} duration={row.visualDuration}>
                <div className="flex flex-col h-full">
                    <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                        <div>
                            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">Hierarchical Elements</label>
                            <ElementsEditor elements={row.elements || []} onUpdate={val => onUpdate({ elements: val, bitmapStatus: 'outdated', evalStatus: 'outdated' })} />
                        </div>
                        <div className="flex-1 mt-6 border-t pt-6 border-slate-200 flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-3 tracking-widest">Spatial Articulation Logic</label>
                            <textarea
                                value={row.prompt || ""}
                                onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated', evalStatus: 'outdated' })}
                                className="w-full flex-1 min-h-[100px] border-none p-0 text-lg font-light text-slate-700 outline-none focus:ring-0 bg-transparent resize-none leading-relaxed"
                            />
                        </div>
                    </div>
                </div>
            </StepBox>
            <StepBox label={t('pipeline.produce')} status={row.bitmapStatus} onRegen={() => onProcess('bitmap')} onStop={onStop} onFocus={() => onFocus('bitmap')} duration={row.bitmapDuration}
              actionNode={row.bitmap && <button onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = row.bitmap!; a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); }} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full flex items-center justify-center bg-white shadow-sm" title="Download Image"><FileDown size={14}/></button>}
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
                          <div className="text-[10px] text-slate-400 uppercase font-medium">No Bitmap Render</div>
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

                  {/* Evaluation Section - Integrated within Producir */}
                  {row.bitmap && (
                    <div className="mt-4 pt-4 border-t border-slate-200">
                      <div className="flex justify-between items-center mb-3">
                        <label className="text-[10px] font-medium uppercase text-slate-400 tracking-widest">Evaluación VCSCI</label>
                        <button
                          onClick={() => onFocus('eval')}
                          className="p-1.5 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full flex items-center justify-center"
                          title="Abrir Editor de Evaluación"
                        >
                          <Hexagon size={14}/>
                        </button>
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
                            <Hexagon size={14}/> Evaluar Pictograma
                          </button>
                        </div>
                      )}
                    </div>
                  )}
              </div>
            </StepBox>
          </div>
        )}
      </div>
    );
};

const StepBox: React.FC<{ label: string; status: StepStatus; onRegen: () => void; onStop: () => void; onFocus: () => void; duration?: number; children: React.ReactNode; actionNode?: React.ReactNode; }> = ({ label, status, onRegen, onStop, onFocus, duration, children, actionNode }) => {
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
    <div className={`flex flex-col gap-4 min-h-[500px] border p-6 transition-all shadow-sm ${bg}`}>
      <div className="flex items-center justify-between border-b pb-4 border-slate-100">
        <h3 className="text-[11px] font-medium uppercase tracking-wider text-slate-900">{label}</h3>
        <div className="flex items-center gap-3">
          {status === 'processing' ? (
            <div className="flex items-center gap-3">
              <span className="text-[11px] font-mono font-medium text-orange-600 animate-pulse">{elapsed}s</span>
              <button onClick={onStop} className="p-2 bg-orange-600 text-white animate-spectral rounded-full"><StopCircle size={14}/></button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {duration && <span className="text-[10px] text-slate-400 font-mono font-medium">{duration.toFixed(1)}s</span>}
              {actionNode}
              <button onClick={onFocus} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full"><Maximize size={14}/></button>
              <button onClick={onRegen} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full"><RefreshCw size={14}/></button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto">{children}</div>
    </div>
  );
};

const SmartNLUEditor: React.FC<{ data: any; onUpdate: (v: any) => void }> = ({ data, onUpdate }) => {
  const nlu = useMemo<Partial<NLUData>>(() => {
    if (typeof data === 'string') {
      try { return JSON.parse(data); } catch(e) { return {}; }
    }
    return data || {};
  }, [data]);
  
  const updateField = (path: (string|number)[], value: any) => {
    const next = JSON.parse(JSON.stringify(nlu));
    let current = next;
    for (let i = 0; i < path.length - 1; i++) { 
      if (current[path[i]] === undefined) {
         current[path[i]] = (typeof path[i+1] === 'number') ? [] : {};
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
            <summary className="nlu-key cursor-pointer uppercase">Metadata Classification</summary>
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
                    )})}
                </div>
            </details>
        ))}

        <details className="border bg-white p-3 shadow-sm text-[10px]">
            <summary className="nlu-key cursor-pointer">DETAILED LINGUISTIC ANALYSIS</summary>
            <div className="mt-3 space-y-4 pt-3 border-t">
                <div>
                    <h4 className="nlu-key mb-1">NSM EXPLICATIONS</h4>
                    {renderEditableDict(nlu.nsm_explications, 'nsm_explications')}
                </div>
                <div>
                    <h4 className="nlu-key mb-1">LOGICAL FORM</h4>
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

const ElementsEditor: React.FC<{ elements: VisualElement[]; onUpdate: (v: VisualElement[]) => void; }> = ({ elements, onUpdate }) => {
  const [editingValues, setEditingValues] = useState<{ [key: string]: string }>({});

  const addElement = (parentId: string | null = null) => {
    const newId = `new_element_${Date.now()}`;
    const newElement: VisualElement = { id: newId };

    if (parentId === null) {
      onUpdate([...elements, newElement]);
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
      onUpdate(update(elements));
    }
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
    onUpdate(filter(elements));
  };

  const updateElementId = (oldId: string, newId: string) => {
    const update = (items: VisualElement[]): VisualElement[] => {
      return items.map(item => {
        if (item.id === oldId) {
          return { ...item, id: newId };
        }
        if (item.children) {
          return { ...item, children: update(item.children) };
        }
        return item;
      });
    };
    onUpdate(update(elements));
  };

  const handleInputChange = (elementId: string, newValue: string) => {
    setEditingValues(prev => ({ ...prev, [elementId]: newValue }));
  };

  const handleInputBlur = (elementId: string) => {
    const newValue = editingValues[elementId];
    if (newValue !== undefined && newValue !== elementId) {
      updateElementId(elementId, newValue);
    }
    setEditingValues(prev => {
      const { [elementId]: _, ...rest } = prev;
      return rest;
    });
  };

  const handleInputKeyDown = (e: React.KeyboardEvent, elementId: string) => {
    if (e.key === 'Enter') {
      (e.target as HTMLInputElement).blur();
    }
  };

  const renderElement = (element: VisualElement, level = 0) => (
    <div key={element.id} style={{ marginLeft: `${level * 20}px` }} className="group">
      <div className="flex items-center gap-2 py-1">
        <input
          type="text"
          value={editingValues[element.id] ?? element.id}
          onChange={(e) => handleInputChange(element.id, e.target.value)}
          onBlur={() => handleInputBlur(element.id)}
          onKeyDown={(e) => handleInputKeyDown(e, element.id)}
          className="text-sm font-mono flex-1 bg-transparent outline-none focus:bg-white focus:ring-1 focus:ring-violet-300 px-1"
        />
        <div className="opacity-0 group-hover:opacity-100 transition-opacity flex gap-1">
            <button onClick={() => addElement(element.id)} className="p-1 hover:bg-slate-200 text-slate-400 rounded"><CornerDownRight size={12}/></button>
            <button onClick={() => removeElement(element.id)} className="p-1 hover:bg-rose-100 text-rose-400 rounded"><X size={12} /></button>
        </div>
      </div>
      {element.children && element.children.map(child => renderElement(child, level + 1))}
    </div>
  );

  return (
    <div className="border p-4 min-h-[120px] bg-white shadow-inner flex flex-col gap-1">
      {elements.map(el => renderElement(el))}
      <button onClick={() => addElement(null)} className="mt-2 pt-2 border-t border-slate-100 text-left text-xs font-bold text-violet-600 hover:text-violet-900 transition-colors w-full flex items-center gap-2">
        <Plus size={14}/> Add Root Element
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
  }> = ({ mode, row, onClose, onUpdate }) => {
    const { t } = useTranslation();
    const [copyStatus, setCopyStatus] = useState(t('actions.copy'));

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
      eval: t('evaluation.vcsci')
    };
  
    const renderContent = () => {
      switch (mode) {
        case 'nlu': return <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated', evalStatus: 'outdated' })} />;
        case 'visual': return (
          <div className="flex flex-col h-full gap-6">
            <div>
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">Hierarchical Elements</label>
              <ElementsEditor elements={row.elements || []} onUpdate={val => onUpdate({ elements: val, bitmapStatus: 'outdated', evalStatus: 'outdated' })} />
            </div>
            <div className="flex-1 mt-6 border-t pt-6 border-slate-200">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-3 tracking-widest">Spatial Articulation Logic</label>
              <textarea 
                value={row.prompt || ""} onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated', evalStatus: 'outdated' })} 
                className="w-full h-full border-none p-0 text-lg font-light text-slate-700 outline-none focus:ring-0 bg-transparent resize-none leading-relaxed" 
              />
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
                    {/* Left Column: Image Section */}
                    <div className="w-1/2 bg-white border-r border-slate-200 flex items-center justify-center p-8 relative">
                        <div className="absolute inset-0 pattern-grid-sm opacity-5 pointer-events-none"></div>
                        {row.bitmap ? (
                            <img src={row.bitmap} alt="Evaluation Context" className="max-w-full max-h-full object-contain shadow-lg" />
                        ) : (
                            <div className="text-slate-300 font-mono text-xs">No Bitmap Reference</div>
                        )}
                    </div>

                    {/* Right Column: Editor Section */}
                    <div className="w-1/2 p-8 flex flex-col overflow-hidden">
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
             <button onClick={onClose} className="p-2 hover:bg-slate-100"><X size={18}/></button>
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
                    <CheckCircle size={14} className="text-emerald-600"/> Confirmar Evaluación
                </button>
             )}
           </footer>
        </div>
      </div>
    )
};
  
export default App;
