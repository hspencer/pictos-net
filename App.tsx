
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { 
  Upload, Download, Trash2, Terminal, RefreshCw, ChevronDown, 
  PlayCircle, BookOpen, Search, FileDown, StopCircle, Sparkles, Sliders,
  X, Code, Plus, FileText, Maximize, Copy, BrainCircuit, PlusCircle, CornerDownRight, Image as ImageIcon,
  Library, Share2, MapPin, Globe, Crosshair
} from 'lucide-react';
import { RowData, LogEntry, StepStatus, NLUData, GlobalConfig, VOCAB, VisualElement } from './types';
import * as Gemini from './services/geminiService';
import { VCSCI_MODULE } from './data/canonicalData';

const STORAGE_KEY = 'pictonet_v19_storage';
const CONFIG_KEY = 'pictonet_v19_config';

const PipelineIcon = ({ size = 24 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="6" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <line x1="20" y1="4" x2="8.12" y2="15.88" />
    <line x1="14.47" y1="14.48" x2="20" y2="20" />
    <line x1="8.12" y1="8.12" x2="12" y2="12" />
    <circle cx="18" cy="18" r="3" />
    <circle cx="18" cy="6" r="3" />
  </svg>
);

const SearchComponent: React.FC<{
  rows: RowData[];
  searchValue: string;
  onSearchChange: (value: string) => void;
  onAddNewRow: (utterance: string) => void;
  isFocused: boolean;
  setIsFocused: (isFocused: boolean) => void;
}> = ({ rows, searchValue, onSearchChange, onAddNewRow, isFocused, setIsFocused }) => {
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
          placeholder="Buscar nodo o crear nueva intención..."
          className="flex-1 bg-transparent border-none focus:ring-0 text-sm font-bold ml-2"
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
              Crear nuevo nodo semántico: "{searchValue}"
            </div>
          )}
        </div>
      )}
    </div>
  );
};


const App: React.FC = () => {
  const [rows, setRows] = useState<RowData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'home' | 'list'>('home');
  const [config, setConfig] = useState<GlobalConfig>({ 
    lang: 'es', 
    aspectRatio: '1:1',
    imageModel: 'flash', // 'flash' (2.5) or 'pro' (3.0/NanoBanana Pro)
    author: 'PICTOS.NET', // Default Author Signature
    license: 'CC BY 4.0',
    visualStylePrompt: "Diseño de pictograma universal estilo ISO con un enfoque en accesibilidad cognitiva y alto contraste.",
    geoContext: { lat: '40.4168', lng: '-3.7038', region: 'Madrid, ES' }
  });
  const [focusMode, setFocusMode] = useState<{ step: 'nlu' | 'visual' | 'bitmap', rowId: string } | null>(null);
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
        bitmapStatus: 'idle'
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
      version: '2.5',
      type: 'pictonet_graph_dump',
      timestamp: new Date().toISOString(),
      config,
      rows // This already includes the 'bitmap' field with base64 data
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    
    // Use the Author Signature as the filename prefix (sanitized)
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
        
        // Handle legacy array format (just rows)
        if (Array.isArray(parsed)) {
            setRows(parsed);
            addLog('success', `Importados ${parsed.length} nodos (Formato Legacy).`);
        } 
        // Handle new full dump format { config, rows }
        else if (parsed.rows && Array.isArray(parsed.rows)) {
            setRows(parsed.rows);
            if (parsed.config) {
                // Compatibility check: if imported config has width/height, default to 1:1
                const newConfig = { ...parsed.config };
                if (!newConfig.aspectRatio) newConfig.aspectRatio = '1:1';
                // Ensure model exists if not present in old config
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
    e.target.value = ''; // Reset for next use
  };

  const addNewRow = (textValue: string = "") => {
    const newId = `R_MANUAL_${Date.now()}`;
    const newEntry: RowData = {
      id: newId, 
      UTTERANCE: textValue.trim() || 'Nueva Unidad Semántica', 
      status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle'
    };
    setRows(prev => [newEntry, ...prev]);
    setViewMode('list');
    setOpenRowId(newId);
    setSearchValue('');
    setIsSearching(false);
  };

  const updateRow = (index: number, updates: Partial<RowData>) => {
    setRows(prev => {
      const updated = [...prev];
      if (!updated[index]) return prev;
      updated[index] = { ...updated[index], ...updates };
      return updated;
    });
  };

  const processStep = async (index: number, step: 'nlu' | 'visual' | 'bitmap'): Promise<boolean> => {
    const row = rows[index];
    if (!row) return false;
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
      } else if (step === 'bitmap') result = await Gemini.generateImage(row.elements || [], row.prompt || "", row, config);

      if (stopFlags.current[row.id]) return false;

      const duration = (Date.now() - startTime) / 1000;
      updateRow(index, { 
        [statusKey]: 'completed', 
        [durationKey]: duration,
        ...(step === 'nlu' ? { NLU: result, visualStatus: 'outdated', bitmapStatus: 'outdated' } : {}),
        ...(step === 'visual' ? { elements: result.elements, prompt: result.prompt, bitmapStatus: 'outdated' } : {}),
        ...(step === 'bitmap' ? { bitmap: result, status: 'completed' } : {})
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
        updateRow(index, { nluStatus: 'processing', visualStatus: 'idle', bitmapStatus: 'idle' });
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

  const filteredRows = useMemo(() => {
    if (!searchValue) return rows;
    const lowSearch = searchValue.toLowerCase();
    return rows.filter(r => r.UTTERANCE.toLowerCase().includes(lowSearch));
  }, [rows, searchValue]);

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
            <span className="text-[9px] text-slate-400 font-mono tracking-widest uppercase">v2.5 Semantic Graph Architecture</span>
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
          
          <div className="relative flex items-center bg-white border border-slate-200 shadow-sm rounded-md transition-all hover:border-violet-200 group">
             <button 
                onClick={() => setViewMode('list')} 
                className="p-2.5 hover:bg-slate-50 text-slate-600 border-r border-slate-100 flex items-center gap-2" 
                title="Ir a la Librería (Workbench)"
             >
                <Library size={18}/>
                <span className="text-xs font-medium text-slate-500 hidden md:inline">Librería</span>
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
                            Gestión de Grafo
                        </div>
                        <button 
                            onClick={() => { importInputRef.current?.click(); setShowLibraryMenu(false); }} 
                            className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
                        >
                            <Upload size={14} className="text-violet-950"/> Importar JSON
                        </button>
                        <button 
                            onClick={() => { exportProject(); setShowLibraryMenu(false); }} 
                            disabled={rows.length === 0}
                            className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-50"
                        >
                            <Download size={14} className="text-emerald-600"/> Exportar Grafo (Full Dump)
                        </button>
                    </div>
                </>
             )}
          </div>

          <div className="w-px h-8 bg-slate-200 mx-2"></div>

          <button onClick={() => setShowConfig(!showConfig)} className={`p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all ${showConfig ? 'bg-slate-100 text-violet-950' : ''}`} title="Ajustes de Grafo"><Sliders size={18}/></button>
          <button onClick={() => setShowConsole(!showConsole)} className="p-2.5 hover:bg-slate-50 text-slate-400 border border-transparent hover:border-slate-200 rounded-md transition-all" title="Monitor Semántico"><Terminal size={18}/></button>
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
        {viewMode === 'home' ? (
          <div className="py-20 text-center space-y-16 animate-in fade-in zoom-in-95 duration-700">
            <div className="space-y-4">
              <div className="inline-flex gap-4 bg-violet-950 text-white px-6 py-2 text-[10px] font-medium uppercase tracking-[0.4em] shadow-lg">
                <Share2 size={14}/> Graph Architecture
              </div>
              <h2 className="text-8xl font-black tracking-tighter text-slate-900 leading-none">{config.author}</h2>
              <p className="text-slate-400 text-xl font-medium max-w-2xl mx-auto leading-relaxed italic">
                Arquitectura de nodos semánticos basada en NSM y accesibilidad cognitiva.
                Integración de Módulos (MediaFranca).
              </p>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto">
              <div onClick={() => { setRows(VCSCI_MODULE.data as RowData[]); setViewMode('list'); }} className="bg-white p-12 border border-slate-200 text-left space-y-6 shadow-xl hover:border-violet-950 transition-all cursor-pointer group hover:-translate-y-1 relative overflow-hidden">
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
    onFocus: (step: 'nlu' | 'visual' | 'bitmap') => void;
}> = ({ row, isOpen, setIsOpen, onUpdate, onProcess, onStop, onCascade, onDelete, onFocus }) => {
    return (
      <div className={`border transition-all duration-300 ${isOpen ? 'ring-8 ring-slate-100 border-violet-950 bg-white' : 'hover:border-slate-300 bg-white shadow-sm'}`}>
        <div className="p-6 flex items-center gap-8 group">
          <input 
            type="text" value={row.UTTERANCE} onChange={e => onUpdate({ UTTERANCE: e.target.value, nluStatus: 'outdated', visualStatus: 'outdated', bitmapStatus: 'outdated' })}
            className="flex-1 w-full bg-transparent border-none outline-none focus:ring-0 utterance-title text-slate-900 uppercase font-light truncate"
          />
          <div className="flex gap-2 cursor-pointer" onClick={() => setIsOpen(!isOpen)}>
            <Badge label="NLU" status={row.nluStatus} />
            <Badge label="VISUAL" status={row.visualStatus} />
            <Badge label="BITMAP" status={row.bitmapStatus} />
          </div>
          <div className="w-14 h-14 border bg-slate-50 flex items-center justify-center p-1 group-hover:scale-110 transition-transform cursor-pointer overflow-hidden" onClick={() => setIsOpen(!isOpen)}>
            {row.bitmap ? <img src={row.bitmap} alt="Miniature" className="w-full h-full object-contain" /> : <div className="text-slate-200"><ImageIcon size={20} /></div>}
          </div>
          <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-all">
            <button onClick={e => { e.stopPropagation(); onCascade(); }} className="p-3 bg-violet-950 text-white shadow-lg hover:bg-black transition-all"><PlayCircle size={18}/></button>
            <button onClick={e => { e.stopPropagation(); onDelete(); }} className="p-3 text-rose-300 hover:text-rose-600 transition-colors"><Trash2 size={18}/></button>
          </div>
          <ChevronDown onClick={() => setIsOpen(!isOpen)} size={20} className={`text-slate-300 transition-transform duration-500 cursor-pointer ${isOpen ? 'rotate-180 text-violet-950' : ''}`} />
        </div>
  
        {isOpen && (
          <div className="p-8 border-t bg-slate-50/30 grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in slide-in-from-top-2">
            <StepBox label="NLU Architecture" status={row.nluStatus} onRegen={() => onProcess('nlu')} onStop={onStop} onFocus={() => onFocus('nlu')} duration={row.nluDuration}>
              <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated' })} />
            </StepBox>
            <StepBox label="Visual Strategy" status={row.visualStatus} onRegen={() => onProcess('visual')} onStop={onStop} onFocus={() => onFocus('visual')} duration={row.visualDuration}>
                <div className="flex flex-col h-full">
                    <div className="flex-1 flex flex-col gap-6 overflow-y-auto">
                        <div>
                            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">Hierarchical Elements</label>
                            <ElementsEditor elements={row.elements || []} onUpdate={val => onUpdate({ elements: val, bitmapStatus: 'outdated' })} />
                        </div>
                        <div className="flex-1 mt-6 border-t pt-6 border-slate-200 flex flex-col">
                            <label className="text-[10px] font-medium uppercase text-slate-400 block mb-3 tracking-widest">Spatial Articulation Logic</label>
                            <textarea 
                                value={row.prompt || ""} 
                                onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated' })} 
                                className="w-full flex-1 min-h-[100px] border-none p-0 text-lg font-light text-slate-700 outline-none focus:ring-0 bg-transparent resize-none leading-relaxed" 
                            />
                        </div>
                    </div>
                    <div className="mt-4 pt-4 border-t border-slate-200 flex justify-end">
                        <button
                            onClick={() => onProcess('bitmap')}
                            disabled={!row.elements || row.elements.length === 0 || row.bitmapStatus === 'processing' || ['error', 'idle'].includes(row.visualStatus)}
                            className="flex items-center gap-2 bg-violet-800 text-white px-4 py-2 font-bold uppercase text-[10px] tracking-widest hover:bg-violet-950 transition-all shadow-md disabled:bg-slate-300 disabled:cursor-not-allowed"
                        >
                            <RefreshCw size={14} /> Generate Bitmap
                        </button>
                    </div>
                </div>
            </StepBox>
            <StepBox label="Bitmap Render" status={row.bitmapStatus} onRegen={() => onProcess('bitmap')} onStop={onStop} onFocus={() => onFocus('bitmap')} duration={row.bitmapDuration}
              actionNode={row.bitmap && <button onClick={(e) => { e.stopPropagation(); const a = document.createElement('a'); a.href = row.bitmap!; a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}.png`; a.click(); }} className="p-2 border hover:border-violet-950 text-slate-400 hover:text-violet-950 transition-all rounded-full flex items-center justify-center bg-white shadow-sm" title="Download Image"><FileDown size={14}/></button>}
            >
              <div className="flex flex-col h-full gap-4">
                  <div style={{ backgroundColor: '#eeeeee' }} className="flex-1 border-2 border-slate-200 flex items-center justify-center p-4 shadow-inner relative overflow-hidden group/preview min-h-[250px]">
                    {row.bitmap ? (
                      <img src={row.bitmap} alt="Generated Pictogram" className="w-full h-full object-contain transition-transform duration-500 group-hover/preview:scale-110" />
                    ) : (
                      <div className="text-[10px] text-slate-400 uppercase font-medium">No Bitmap Render</div>
                    )}
                  </div>
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
                    {Object.entries(frame.roles || {}).map(([role, data]) => (
                        <div key={role} className="flex gap-2">
                            <span className="font-medium w-20 text-slate-500 shrink-0">{role}:</span>
                            <span className="text-slate-900 truncate">{data.surface} <span className="text-[9px] text-violet-400">[{data.type}]</span></span>
                        </div>
                    ))}
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


  const renderElement = (element: VisualElement, level = 0) => (
    <div key={element.id} style={{ marginLeft: `${level * 20}px` }} className="group">
      <div className="flex items-center gap-2 py-1">
        <input 
          type="text" 
          value={element.id} 
          onChange={(e) => updateElementId(element.id, e.target.value)}
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
    mode: 'nlu' | 'visual' | 'bitmap';
    row: RowData;
    onClose: () => void;
    onUpdate: (updates: Partial<RowData>) => void;
  }> = ({ mode, row, onClose, onUpdate }) => {
    const [copyStatus, setCopyStatus] = useState('Copiar Contenido');
    
    const handleCopy = () => {
      let contentToCopy: string = '';
      if (mode === 'nlu') {
        contentToCopy = JSON.stringify(row.NLU, null, 2);
      } else if (mode === 'visual') {
        contentToCopy = JSON.stringify({ "elements": row.elements, "prompt": row.prompt }, null, 2);
      } else if (mode === 'bitmap') {
        // For bitmaps we can't easily copy to clipboard as text, so we skip or maybe copy the prompt?
        // Let's copy the prompt used for generation as a fallback
        contentToCopy = row.prompt || '';
      }
  
      if (contentToCopy) {
        navigator.clipboard.writeText(contentToCopy).then(() => {
          setCopyStatus('¡Copiado!');
          setTimeout(() => setCopyStatus('Copiar Contenido'), 2000);
        });
      }
    };

    const titleMap = { nlu: 'NLU Architecture', visual: 'Visual Strategy', bitmap: 'Bitmap Render' };
  
    const renderContent = () => {
      switch (mode) {
        case 'nlu': return <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated' })} />;
        case 'visual': return (
          <div className="flex flex-col h-full gap-6">
            <div>
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-2 tracking-widest">Hierarchical Elements</label>
              <ElementsEditor elements={row.elements || []} onUpdate={val => onUpdate({ elements: val, bitmapStatus: 'outdated' })} />
            </div>
            <div className="flex-1 mt-6 border-t pt-6 border-slate-200">
              <label className="text-[10px] font-medium uppercase text-slate-400 block mb-3 tracking-widest">Spatial Articulation Logic</label>
              <textarea 
                value={row.prompt || ""} onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated' })} 
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
           </footer>
        </div>
      </div>
    )
};
  
export default App;
