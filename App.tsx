
import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import ReactDOM from 'react-dom';
import JSZip from 'jszip';
import {
  Upload, Download, Trash2, Terminal, RefreshCw, ChevronDown,
  Play, BookOpen, Search, FileDown, Square, Settings,
  X, Code, Plus, FileText, Maximize, Copy, BrainCircuit, PlusCircle, CornerDownRight, Image as ImageIcon,
  Library, ScreenShare, Globe, HelpCircle, ExternalLink, Palette, GripVertical, Edit,
  ChevronLeft, ChevronRight, ArrowUp, FileCode, Layers, LogOut, LogIn, History,
  List, LayoutGrid, Clock, Scan, CheckCircle2, XCircle, Wifi
} from 'lucide-react';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, verticalListSortingStrategy, useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { RowData, LogEntry, StepStatus, NLUData, GlobalConfig, VOCAB, VisualElement, NLUFrameRole, ElementOpKind, RowInterventionLog, SvgMetrics, DEFAULT_PHASE5_MODEL, PHASE5_MODELS, Phase5StructuringModel, LibraryMeta, Sequence, Step, NluModel, NLU_MODELS, DEFAULT_NLU_MODEL } from './types';
import * as Claude from './services/claudeService';
import * as Recraft from './services/recraftService';
import * as Gemini from './services/geminiService';
import { QuotaExceededError, callCheck } from './services/aiClient';
import { GenerationModel, DEFAULT_GENERATION_MODEL, migrateImageModel, migrateGenerationModel, GENERATION_MODEL_LABELS, INOPERATIVE_GENERATION_MODELS, Phase3Result, getModelFamily } from './types';
import { structureSVG } from './services/svgStructureService';
import * as Recording from './services/interventionRecording';
import { validBitmap, validRawSvg, validStructuredSvg, validDownstreamSvg, hasValidBitmap, hasAnyValidArtifact, hasAnyValidSvg } from './utils/rowArtifacts';
import { useTranslation } from './hooks/useTranslation';
import { useDialogA11y } from './hooks/useDialogA11y';
import type { Locale } from './locales';
import { SVGGenerator } from './components/SVGGenerator';
import useSVGLibrary from './hooks/useSVGLibrary';
import { StyleEditor } from './components/PictoForge/StyleEditor';
import { GeoAutocomplete } from './components/GeoAutocomplete';
import * as IndexedDBService from './services/indexedDBService';
import * as libraryService from './services/libraryService';
import { INITIAL_STYLES } from './lib/style-editor/lib/constants';
import { INITIAL_KEYFRAMES } from './lib/style-editor/lib/keyframeConstants';
import packageJson from './package.json';
import { SVGEditorModal } from './components/SVGEditor/SVGEditorModal';
import OnboardingModal from './components/OnboardingModal';
import { PDFExportModal } from './components/PDFExportModal';
import ParticipateModal from './components/ParticipateModal';
import { exportLibraryToPdf, pdfExportFilename, downloadPdf, PdfExportCancelledError, type PdfProgress } from './services/pdfExportService';
import { exportSequenceToPdf, sequencePdfFilename } from './services/sequencePdfService';
import { RowAuditPanel } from './components/RowAuditPanel';
import { PictogramGridCell } from './components/PictogramGridCell';
import { injectSvgA11y } from './utils/svgAccessibility';
import { AuthProvider, logout, requestLogin, onLogin, ensureAuth } from './components/AuthGate';
import { VectorizerModal } from './components/VectorizerModal';
import type { VectorizerResult } from './services/vtracerService';
import { LibraryHome } from './components/LibraryHome';
import { SequenceList } from './components/SequenceList';
import { SequenceEditor } from './components/SequenceEditor';


const STORAGE_KEY = 'pictonet_v19_storage';
const CONFIG_KEY = 'pictonet_v19_config';
const APP_VERSION = packageJson.version;
/**
 * Library export schema version. Increment when the shape of the
 * exported JSON changes in a non-additive way. Importers branch on
 * this to migrate older exports forward.
 *
 *   v1  pre-2026-05  events carry a per-event context object;
 *                    svgs field is a JSON-stringified string
 *   v2  2026-05      events drop context; events get a stable id;
 *                    svgs is a real array; copy-row injects a
 *                    portability context header
 */
const EXPORT_SCHEMA_VERSION = 2;

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

// Rasterize a row's best artifact (SVG preferred, bitmap fallback) to a JPEG
// data URL at the given pixel size. SVGs are loaded via Blob URL so the browser
// can decode them without cross-origin restrictions.
async function rasterizeToThumbnail(row: RowData, size = 300): Promise<string> {
  const svgString = row.structuredSvg || row.rawSvg;

  if (svgString) {
    const blob = new Blob([svgString], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = () => reject(new Error('svg load failed'));
        img.src = url;
      });
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
      return canvas.toDataURL('image/jpeg', 0.85);
    } catch {
      return '';
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  if (row.bitmap) {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = size;
          canvas.height = size;
          const ctx = canvas.getContext('2d')!;
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, size, size);
          ctx.drawImage(img, 0, 0, size, size);
          resolve(canvas.toDataURL('image/jpeg', 0.85));
        } catch { resolve(''); }
      };
      img.onerror = () => resolve('');
      img.src = row.bitmap!;
    });
  }

  return '';
}

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
    <circle className="st0" cx="23.9" cy="17.8" r="3.1" />
    <path className="st0" d="M23.6,4c-9.4,0-17.1,6.3-17.1,14.1s0,0,0,0c0,0,0,0,0,0v19.7c0,2.1,1.7,3.9,3.9,3.9h1.6c2.1,0,3.9-1.7,3.9-3.9v-7.3c2.3,1,4.9,1.5,7.7,1.5,9.4,0,17.1-6.3,17.1-14.1S33,4,23.6,4ZM23.9,24.5c-6.4,0-9.2-6.4-9.2-6.4,0,0,2.8-6.4,9.2-6.4s9.2,6.4,9.2,6.4c0,0-2.8,6.4-9.2,6.4Z" />
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
        <Search size={18} className="text-slate-500" />
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


const FieldLabel: React.FC<{ label: string; tooltip: string }> = ({ label, tooltip }) => (
  <label className="text-xs font-medium text-slate-500 mb-2 flex items-center gap-1">
    {label}
    <div className="group/tooltip relative">
      <HelpCircle size={14} className="text-orange-400 hover:text-orange-600 cursor-help" />
      <div className="invisible group-hover/tooltip:visible absolute left-0 bottom-full mb-2 w-64 bg-slate-900 text-white text-xs p-2 rounded shadow-lg z-[56] leading-relaxed">
        {tooltip}
      </div>
    </div>
  </label>
);

const DEFAULT_PALETTE = ['#ffffff', '#000000', '#da1010', '#8ac51b', '#86a8f9', '#f5ed0a'];

const DEFAULT_STYLE_PROMPTS: Record<string, string> = {
  'es-419': 'Pictograma vectorial plano, estilo señalética AIGA/DOT, silueta simplificada y contundente, abstracción media conservando los detalles concretos relevantes, grosor de trazo uniforme, contornos monolineales, colores planos y sólidos — sin degradados, sin sombras, sin texturas, sin elementos decorativos. Estética adulta y neutra, sobria y funcional. Formas geométricas limpias, silueta clara y legible, peso visual consistente en toda la serie.',
  'en-GB': 'Flat vector pictogram, AIGA/DOT wayfinding style, bold simplified silhouette, medium abstraction with key concrete details preserved, uniform stroke weight, monoline outlines, flat solid colors — no gradients, no shadows, no textures, no decorative elements. Neutral adult aesthetic, sober and functional. Clean geometric forms, strong silhouette clarity, consistent visual weight across the set.',
};

function getDefaultStylePrompt(lang: string): string {
  return DEFAULT_STYLE_PROMPTS[lang] || DEFAULT_STYLE_PROMPTS['es-419'];
}

interface AppProps {
  authUser?: { email: string; user_metadata?: { full_name?: string } } | null;
}

const App: React.FC<AppProps> = ({ authUser }) => {
  const { t, lang, setLang } = useTranslation();
  const { svgs, exportSVGs, importSVGs, clearLibrary, addSVG } = useSVGLibrary();
  const [rows, setRows] = useState<RowData[]>([]);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [showConsole, setShowConsole] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [basicConfigOpen, setBasicConfigOpen] = useState(true);
  const [showLibraryMenu, setShowLibraryMenu] = useState(false);
  const [showParticipateModal, setShowParticipateModal] = useState(false);
  const [libraryMenuPos, setLibraryMenuPos] = useState({ top: 0, left: 0 });
  const libraryBtnRef = useRef<HTMLDivElement>(null);
  const [showLangMenu, setShowLangMenu] = useState(false);
  const [langMenuPos, setLangMenuPos] = useState({ top: 0, left: 0 });
  const langBtnRef = useRef<HTMLDivElement>(null);
  const [searchValue, setSearchValue] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const scrollToRowRef = useRef<string | null>(null);
  const [activeLibraryId, setActiveLibraryId] = useState<string | null>(null);
  const [viewingLibraryHome, setViewingLibraryHome] = useState(true);
  const [libraryIndex, setLibraryIndex] = useState<LibraryMeta[]>([]);
  const [sortBy, setSortBy] = useState<'alphabetical' | 'completeness'>('alphabetical');
  const [config, setConfig] = useState<GlobalConfig>({
    lang: 'es-419',
    generationModel: DEFAULT_GENERATION_MODEL,
    name: 'PICTOS.NET',
    credits: '',
    license: 'CC BY 4.0',
    visualStylePrompt: getDefaultStylePrompt('es-419'),
    geoContext: { lat: '-33.0245', lng: '-71.5518', region: 'Viña del Mar, CL' },
    annotatedContext: '',
    svgStyleDefs: INITIAL_STYLES,
    svgKeyframes: INITIAL_KEYFRAMES,
    recording: { enabled: false },
    paletteColors: DEFAULT_PALETTE,
    advancedConfigOpen: false,
  });
  const [modelChangeWarning, setModelChangeWarning] = useState<{
    pendingModel: GenerationModel;
    affectedCount: number;
  } | null>(null);
  const [focusMode, setFocusMode] = useState<{ step: 'nlu' | 'visual' | 'produce' | 'format', rowId: string } | null>(null);
  const [showStyleEditor, setShowStyleEditor] = useState(false);
  const [pdfExportProgress, setPdfExportProgress] = useState<PdfProgress | null>(null);
  const pdfExportAbortRef = useRef<AbortController | null>(null);
  const [reduceMotion, setReduceMotion] = useState(() => {
    const stored = localStorage.getItem('pictonet_reduce_motion');
    return stored === null ? true : stored === 'true';
  });
  const [highContrast, setHighContrast] = useState(() => {
    return localStorage.getItem('pictonet_high_contrast') === 'true';
  });
  const [statusAnnouncement, setStatusAnnouncement] = useState('');

  const announce = useCallback((msg: string) => {
    setStatusAnnouncement(msg);
    setTimeout(() => setStatusAnnouncement(''), 5000);
  }, []);

  // Populate credits field on first login (name + email or just email)
  useEffect(() => {
    return onLogin((user) => {
      setConfig(prev => {
        if (prev.credits) return prev; // don't overwrite user-set credits
        const name = user.user_metadata?.full_name;
        const credit = name ? `${name} <${user.email}>` : user.email;
        return { ...prev, credits: credit };
      });
    });
  }, []);

  useEffect(() => {
    localStorage.setItem('pictonet_reduce_motion', String(reduceMotion));
    document.documentElement.classList.toggle('reduce-motion', reduceMotion);
  }, [reduceMotion]);
  useEffect(() => {
    localStorage.setItem('pictonet_high_contrast', String(highContrast));
    document.documentElement.classList.toggle('high-contrast', highContrast);
  }, [highContrast]);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return !localStorage.getItem('pictonet_onboarding_done');
  });
  const [isInitialized, setIsInitialized] = useState(false);
  // Tracks row IDs whose IndexedDB SVG entry currently exists. Seeded from
  // loadData (which reads IDB) and maintained by the save effect so that
  // when a row's rawSvg AND structuredSvg both go undefined we can issue
  // an explicit deleteSvgs(id). Without this, the save effect would skip
  // the row entirely and the old SVG would resurrect on next reload.
  const svgRowIdsRef = useRef<Set<string>>(new Set());
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
    onConfirm: () => { }
  });
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [loadingLibraryName, setLoadingLibraryName] = useState('');
  // Model helpers (changes persist via setConfig → localStorage)
  const setPhase5Model = (m: string) => setConfig(prev => ({ ...prev, phase5Model: m as Phase5StructuringModel }));
  const setNluModel = (m: string) => setConfig(prev => ({ ...prev, nluModel: m as NluModel }));

  // Connection check state per phase key ('nlu' | 'generation' | 'structuring')
  const [connectionChecks, setConnectionChecks] = useState<Record<string, {
    status: 'idle' | 'checking' | 'ok' | 'error';
    latency?: number;
    error?: string;
  }>>({});

  const checkConnection = async (key: string, service: string, model?: string) => {
    setConnectionChecks(prev => ({ ...prev, [key]: { status: 'checking' } }));
    const result = await callCheck(service, model);
    setConnectionChecks(prev => ({
      ...prev,
      [key]: result.ok
        ? { status: 'ok', latency: result.latency }
        : { status: 'error', latency: result.latency, error: result.error },
    }));
  };
  const [svgEditorState, setSvgEditorState] = useState<{
    isOpen: boolean;
    rowId: string | null;
    svg: string | null;
    svgSource: 'raw' | 'structured' | null;
  }>({
    isOpen: false,
    rowId: null,
    svg: null,
    svgSource: null,
  });

  const [vectorizerState, setVectorizerState] = useState<{ isOpen: boolean; rowId: string | null }>({ isOpen: false, rowId: null });

  const [quotaModal, setQuotaModal] = useState<{ units_used: number; limit: number } | null>(null);

  const closeConfirmDialog = useCallback(() => setConfirmDialog(prev => ({ ...prev, isOpen: false })), []);
  const { dialogProps: confirmDialogProps } = useDialogA11y({ isOpen: confirmDialog.isOpen, onClose: closeConfirmDialog, label: confirmDialog.title || 'Confirm' });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInputRef = useRef<HTMLInputElement>(null);
  const appendPhrasesInputRef = useRef<HTMLInputElement>(null);
  // Separate ref for importing phrases from the home portada (no active library).
  // Auto-opens the most recent library (or creates one) before processing.
  const homeImportRef = useRef<HTMLInputElement>(null);
  const stopFlags = useRef<Record<string, boolean>>({});
  const autoCascadeRef = useRef<string | null>(null);

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
      status: ['idle', 'processing', 'completed', 'error'].includes(row.status) ? row.status : 'idle',
      nluStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.nluStatus) ? row.nluStatus : 'idle',
      visualStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.visualStatus) ? row.visualStatus : 'idle',
      bitmapStatus: ['idle', 'processing', 'completed', 'error', 'outdated'].includes(row.bitmapStatus) ? row.bitmapStatus : 'idle',
      nluDuration: typeof row.nluDuration === 'number' ? row.nluDuration : undefined,
      visualDuration: typeof row.visualDuration === 'number' ? row.visualDuration : undefined,
      bitmapDuration: typeof row.bitmapDuration === 'number' ? row.bitmapDuration : undefined,
      interventionLog: sanitizeInterventionLog(row.interventionLog),
    };
  };

  // Close any session left "active" by a previous tab close. Without this
  // sweep, an orphaned active session would coexist with a new one on next
  // open of the same row, violating SingleActiveSessionPerRow.
  // Also migrates v1 event shape forward: drop event.context (it lived in
  // the library config); promote a missing event.id to a fresh short hex.
  const sanitizeInterventionLog = (log: any): RowInterventionLog | undefined => {
    if (!log || !Array.isArray(log.sessions)) return undefined;
    const orphanCutoff = new Date().toISOString();
    const newId = (): string => {
      const bytes = new Uint8Array(4);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    };
    const migrateEvent = (e: any) => {
      if (!e || typeof e !== 'object') return e;
      // Lift modelId out of legacy context, then drop the context wrapper.
      if (e.context && typeof e.context === 'object') {
        if (e.context.modelId && !e.modelId) e.modelId = e.context.modelId;
        delete e.context;
      }
      if (!e.id) e.id = newId();
      return e;
    };
    const sessions = log.sessions
      .filter((s: any) => s && typeof s.startedAt === 'string' && Array.isArray(s.events))
      .map((s: any) => ({
        startedAt: s.startedAt,
        endedAt: typeof s.endedAt === 'string' ? s.endedAt : orphanCutoff,
        events: s.events.map(migrateEvent),
      }));
    return { sessions };
  };

  useEffect(() => {
    const loadData = async () => {
      // ── Step 0: migration check ──────────────────────────────────────────────
      if (libraryService.needsMigration()) {
        await libraryService.migrateFromSingleLibrary();
      }

      // ── Step 1: library index ────────────────────────────────────────────────
      const index = libraryService.getLibraryIndex();
      setLibraryIndex(index);

      // Determine which library to open: the previously active one, or the first
      const savedActiveId = localStorage.getItem(libraryService.ACTIVE_LIBRARY_KEY);
      const targetId = (savedActiveId && index.find(l => l.id === savedActiveId))
        ? savedActiveId
        : null;

      if (!targetId) {
        // No library to open — show home screen
        setIsInitialized(true);
        return;
      }

      // ── Step 2: config (scoped to library) ──────────────────────────────────
      const savedConfig = libraryService.getLibraryConfig(targetId);
      if (savedConfig) {
        try {
          const parsed = typeof savedConfig === 'string' ? JSON.parse(savedConfig) : savedConfig;
          if (parsed.imageModel !== undefined && !parsed.generationModel) {
            parsed.generationModel = migrateImageModel(parsed.imageModel);
            delete parsed.imageModel;
          } else if (!parsed.generationModel) {
            parsed.generationModel = DEFAULT_GENERATION_MODEL;
          } else {
            parsed.generationModel = migrateGenerationModel(parsed.generationModel);
          }
          setConfig(parsed);
        } catch (e) { console.error('Failed to load config', e); }
      }

      // ── Step 3: row metadata (scoped to library) ─────────────────────────────
      let loadedRows: RowData[] = [];
      const savedRows = libraryService.getLibraryRows(targetId);
      if (Array.isArray(savedRows)) {
        loadedRows = savedRows.map(sanitizeRow);
      }

      if (loadedRows.length > 0) {
        setRows(loadedRows);
      }
      setActiveLibraryId(targetId);
      setViewingLibraryHome(false);
      setIsInitialized(true);

      // ── Step 4: binary data (IndexedDB, async → merge when ready) ────────────
      if (loadedRows.length > 0) {
        try {
          const [bitmapsMap, svgsMap] = await Promise.all([
            IndexedDBService.getAllBitmapsForLibrary(targetId),
            IndexedDBService.getAllSvgsForLibrary(targetId),
          ]);
          const hasBinaryData = bitmapsMap.size > 0 || svgsMap.size > 0;
          if (hasBinaryData) {
            setRows((prev: RowData[]) => prev.map((row: RowData) => ({
              ...row,
              bitmap: bitmapsMap.get(row.id) || row.bitmap,
              rawSvg: svgsMap.get(row.id)?.rawSvg || row.rawSvg,
              structuredSvg: svgsMap.get(row.id)?.structuredSvg || row.structuredSvg,
            })));
          }
          const seeded = new Set<string>();
          svgsMap.forEach((value, id) => {
            if (value.rawSvg || value.structuredSvg) seeded.add(id);
          });
          svgRowIdsRef.current = seeded;
        } catch (err) {
          console.error('Failed to load binary data from IndexedDB:', err);
        }
      }
    };

    loadData();
  }, []);

  useEffect(() => {
    if (!isInitialized) return;

    // 1. Metadata → scoped localStorage (synchronous, always runs first)
    if (activeLibraryId) {
      const rowsMeta = rows.map((row: RowData) => {
        const { bitmap, rawSvg, structuredSvg, ...meta } = row;
        return meta;
      });
      try {
        libraryService.saveLibraryRows(activeLibraryId, rowsMeta);
        libraryService.saveLibraryConfig(activeLibraryId, config);
        // Update modifiedAt on every save. Keep the library card name
        // (LibraryMeta.name) in sync with the space name (config.name) so the
        // two never diverge; config.name is the canonical name. Only sync when
        // non-empty so clearing the field doesn't blank the card.
        libraryService.updateLibraryMeta(activeLibraryId, {
          ...(config.name && config.name.trim() ? { name: config.name } : {}),
          modifiedAt: new Date().toISOString(),
          pictogramCount: rowsMeta.length,
          language: config.lang,
        });
        setLibraryIndex(libraryService.getLibraryIndex());
      } catch (error) {
        console.error('[save] library storage write failed:', error);
      }

      // 4. Preview thumbnails → localStorage (async, cosmetic, never blocks)
      // Prefer SVG rows (Recraft output) — bitmap filter missed them entirely.
      const previewRows = rows
        .filter((row: RowData) => row.structuredSvg || row.rawSvg || row.bitmap)
        .slice(0, 3);
      if (previewRows.length > 0) {
        const libId = activeLibraryId;
        Promise.all(previewRows.map((row: RowData) => rasterizeToThumbnail(row, 300)))
          .then(thumbs => {
            libraryService.saveLibraryPreviews(libId, thumbs.filter(Boolean));
            // Update modifiedAt after thumbnails are written so LibraryCard
            // re-reads getLibraryPreviews on its next dep-triggered useEffect.
            libraryService.updateLibraryMeta(libId, { modifiedAt: new Date().toISOString() });
            setLibraryIndex(libraryService.getLibraryIndex());
          })
          .catch(() => { /* thumbnails are cosmetic */ });
      }
    }

    // 2. Bitmaps → IDB (fire-and-forget, non-blocking)
    if (activeLibraryId) {
      const bitmapEntries = rows
        .filter((row: RowData) => row.bitmap)
        .map((row: RowData) => ({ id: row.id, bitmap: row.bitmap!, libraryId: activeLibraryId }));
      if (bitmapEntries.length > 0) {
        IndexedDBService.saveBitmapsBatch(bitmapEntries)
          .catch(err => console.error('[save] IDB bitmap write failed:', err));
      }

      // 3. SVGs → IDB (fire-and-forget, non-blocking)
      const currentSvgIds = new Set<string>();
      rows.forEach((row: RowData) => {
        if (row.rawSvg || row.structuredSvg) {
          currentSvgIds.add(row.id);
          IndexedDBService.saveSvgs(row.id, {
            rawSvg: row.rawSvg,
            structuredSvg: row.structuredSvg,
          }, activeLibraryId).catch(err => console.error('[save] SVG write failed:', err));
        }
      });
      svgRowIdsRef.current.forEach(id => {
        if (!currentSvgIds.has(id)) {
          IndexedDBService.deleteSvgs(id).catch(err => console.error('[save] SVG delete failed:', err));
        }
      });
      svgRowIdsRef.current = currentSvgIds;
    }
  }, [rows, isInitialized, config, activeLibraryId]);

  const openLibrary = useCallback((id: string, { skipRowLoad = false }: { skipRowLoad?: boolean } = {}) => {
    localStorage.setItem(libraryService.ACTIVE_LIBRARY_KEY, id);

    if (!skipRowLoad) {
      // Load rows + config synchronously, in the same call as setActiveLibraryId.
      // React 18 auto-batches all setState calls in the same synchronous function,
      // so the save effect fires exactly once — with the correct rows already in
      // state — preventing it from overwriting the library with empty rows.
      const savedRows = libraryService.getLibraryRows(id);
      const savedConfig = libraryService.getLibraryConfig(id);
      setRows(savedRows);
      if (savedConfig) setConfig(prev => ({ ...prev, ...savedConfig }));

      // Merge IDB binaries (SVGs / bitmaps) asynchronously after the sync load.
      Promise.all([
        IndexedDBService.getAllBitmapsForLibrary(id),
        IndexedDBService.getAllSvgsForLibrary(id),
      ]).then(([bitmapsMap, svgsMap]) => {
        if (bitmapsMap.size > 0 || svgsMap.size > 0) {
          setRows(prev => prev.map((row: RowData) => ({
            ...row,
            bitmap: bitmapsMap.get(row.id) ?? row.bitmap,
            rawSvg: svgsMap.get(row.id)?.rawSvg ?? row.rawSvg,
            structuredSvg: svgsMap.get(row.id)?.structuredSvg ?? row.structuredSvg,
          })));
        }
        const seeded = new Set<string>();
        svgsMap.forEach((_v, rowId) => { seeded.add(rowId); });
        svgRowIdsRef.current = seeded;
      }).catch(err => console.error('[openLibrary] IDB load failed:', err));
    }

    setActiveLibraryId(id);
    setLibraryContentMode('pictogramas');
    setViewingLibraryHome(false);
  }, []);

  const closeLibrary = useCallback(() => {
    localStorage.removeItem(libraryService.ACTIVE_LIBRARY_KEY);
    // Clear the SVG-row tracker so the save effect for the next library
    // does not attempt to delete SVGs belonging to this (now closed) library.
    svgRowIdsRef.current = new Set();
    setActiveLibraryId(null);
    setRows([]);
    setSequences([]);
    setActiveSequenceId(null);
    setViewingLibraryHome(true);
  }, []);

  // ── Library home + content mode ───────────────────────────────────────────
  const [libraryContentMode, setLibraryContentMode] = useState<'pictogramas' | 'secuencias'>('pictogramas');
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [activeSequenceId, setActiveSequenceId] = useState<string | null>(null);
  const [sequenceViewMode, setSequenceViewMode] = useState<'list' | 'grid'>('list');
  const pendingStepRowsRef = useRef<Map<string, { sequenceId: string; stepId: string }>>(new Map());
  const [librarySort, setLibrarySort] = useState<'recientes' | 'alfabetico'>('recientes');

  // Load sequences when active library changes
  useEffect(() => {
    if (!activeLibraryId) { setSequences([]); setActiveSequenceId(null); return; }
    setSequences(libraryService.getLibrarySequences(activeLibraryId));
    setActiveSequenceId(null);
  }, [activeLibraryId]);

  // Save sequences whenever they change
  useEffect(() => {
    if (!activeLibraryId || !isInitialized) return;
    libraryService.saveLibrarySequences(activeLibraryId, sequences);
    libraryService.updateLibraryMeta(activeLibraryId, {
      sequenceCount: sequences.length,
      modifiedAt: new Date().toISOString(),
    });
  }, [sequences, activeLibraryId, isInitialized]);

  // Watch for rows generated from sequence steps completing
  useEffect(() => {
    if (pendingStepRowsRef.current.size === 0) return;
    rows.forEach(row => {
      const pending = pendingStepRowsRef.current.get(row.id);
      if (!pending || !(row.rawSvg || row.bitmap)) return;
      const { sequenceId, stepId } = pending;
      setSequences(prev => prev.map(seq => {
        if (seq.id !== sequenceId) return seq;
        return {
          ...seq,
          modifiedAt: new Date().toISOString(),
          steps: seq.steps.map(s =>
            s.id === stepId ? { ...s, rowId: row.id, state: 'complete' as const } : s
          ),
        };
      }));
      pendingStepRowsRef.current.delete(row.id);
    });
  }, [rows]);
  const [storageInfo, setStorageInfo] = useState<{ usage: number; quota: number } | null>(null);
  const libImportRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    IndexedDBService.getStorageEstimate().then(est => {
      if (est) setStorageInfo(est);
    });
  }, []);

  const handleCreateLibrary = useCallback(() => {
    const name = window.prompt(t('home.newLibraryNamePrompt') || 'Nombre de la nueva librería');
    if (!name?.trim()) return;
    const lib = libraryService.createLibrary(name.trim());
    setLibraryIndex(libraryService.getLibraryIndex());
    openLibrary(lib.id);
  }, [openLibrary, t]);

  const handleImportLibrary = useCallback((file: File) => {
    file.text().then(text => {
      try {
        const lib = libraryService.importLibraryJson(text);
        setLibraryIndex(libraryService.getLibraryIndex());
        openLibrary(lib.id);
      } catch (err) {
        addLog('error', `Error al importar librería: ${err instanceof Error ? err.message : 'formato inválido'}`);
      }
    });
  }, [openLibrary]);

  const handleBackupLibraries = useCallback(async () => {
    const blob = await libraryService.backupAllLibraries();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = libraryService.backupFilename();
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleRenameLibrary = useCallback((id: string, newName: string) => {
    libraryService.updateLibraryMeta(id, { name: newName, modifiedAt: new Date().toISOString() });
    // Keep the space name (config.name) in sync with the library card name,
    // so renaming from the home card and editing the space name agree.
    const cfg = libraryService.getLibraryConfig(id);
    if (cfg) libraryService.saveLibraryConfig(id, { ...cfg, name: newName });
    if (id === activeLibraryId) setConfig(prev => ({ ...prev, name: newName }));
    setLibraryIndex(libraryService.getLibraryIndex());
  }, [activeLibraryId]);

  const handleDuplicateLibrary = useCallback((id: string) => {
    libraryService.duplicateLibrary(id);
    setLibraryIndex(libraryService.getLibraryIndex());
  }, []);

  const handleDownloadLibrary = useCallback((id: string) => {
    const json = libraryService.exportLibraryJson(id);
    const meta = libraryService.getLibraryIndex().find(l => l.id === id);
    const safeName = (meta?.name ?? 'libreria').replace(/[^a-z0-9_\-]/gi, '_').toLowerCase();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${safeName}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, []);

  const handleDeleteLibrary = useCallback(async (id: string) => {
    const meta = libraryService.getLibraryIndex().find(l => l.id === id);
    const confirmMsg = (t('actions.deleteLibraryConfirm') || '¿Eliminar esta librería?').replace('{name}', meta?.name ?? id);
    if (!window.confirm(confirmMsg)) return;
    libraryService.deleteLibrary(id);
    await Promise.all([
      IndexedDBService.deleteBitmapsForLibrary(id),
      IndexedDBService.deleteSvgsForLibrary(id),
    ]);
    if (id === activeLibraryId) closeLibrary();
    setLibraryIndex(libraryService.getLibraryIndex());
  }, [t, activeLibraryId, closeLibrary]);

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

  useEffect(() => {
    if (!openRowId || scrollToRowRef.current !== openRowId) return;
    scrollToRowRef.current = null;

    // Scroll the new row into view, offset below the sticky toolbar.
    // Double rAF + setTimeout fallback: React may need >1 frame to render
    // the expanded row content after state change.
    const doScroll = () => {
      const el = document.getElementById(`picto-row-${openRowId}`);
      if (!el) return;
      const headerHeight = document.getElementById('toolbar')?.offsetHeight ?? 80;
      const top = el.getBoundingClientRect().top + window.scrollY - headerHeight - 16;
      window.scrollTo({ top, behavior: 'smooth' });
    };

    requestAnimationFrame(() => requestAnimationFrame(doScroll));
    // Safety net: if rAF fires before layout settles, retry after paint
    const timer = setTimeout(doScroll, 150);
    return () => clearTimeout(timer);
  }, [openRowId]);

  // Auto-cascade: when a new row with real text is added, start the pipeline
  useEffect(() => {
    const targetId = autoCascadeRef.current;
    if (!targetId) return;
    if (!rows.some(r => r.id === targetId)) return;
    autoCascadeRef.current = null;
    processCascade(targetId);
  }, [rows]);

  const addLog = (type: 'info' | 'error' | 'success', message: string) => {
    setLogs(prev => [...prev, { id: Math.random().toString(36).substr(2, 9), timestamp: new Date().toLocaleTimeString(), type, message }]);
    if (type === 'success' || type === 'error') announce(message);
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
      addLog('success', t('messages.importSuccess', { count: newRows.length }));
    } catch (e) {
      addLog('error', t('messages.processingError'));
    }
  };

  /**
   * Build a portable JSON document for a single row leaving the
   * library context (Copy Row → clipboard). Includes the lang /
   * uiLang / geoContext header so the row remains self-describing
   * when pasted into a different library or read standalone.
   * See specs/intervention-recording.allium § CopyRowToClipboard.
   */
  const buildRowClipboardJson = (row: RowData): string => {
    const rowSvgs = svgs.filter(s => s.sourceRowId === row.id || s.id === row.id);
    const portable = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      type: 'row-clipboard' as const,
      timestamp: new Date().toISOString(),
      context: Recording.buildClipboardContext(config),
      row,
      svgs: rowSvgs,
    };
    return JSON.stringify(portable, null, 2);
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

      const hasAnyData = hasNLU || hasVisual || hasBitmap;

      return {
        ...row,
        status: hasAnyData ? 'completed' as const : 'idle' as const
      };
    });

    const dataToExport = {
      schemaVersion: EXPORT_SCHEMA_VERSION,
      appVersion: APP_VERSION,
      type: 'pictonet_graph_dump',
      timestamp: new Date().toISOString(),
      config,
      rows: sanitizedRows,
      // svgs is now a real array, not a JSON-stringified string.
      // The previous double-encoding was an accident — JSON.stringify
      // of dataToExport will serialize the nested array natively.
      svgs,
    };
    const blob = new Blob([JSON.stringify(dataToExport, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const safeFilename = config.name.replace(/[^a-z0-9]/gi, '_').toLowerCase() || 'pictonet';
    a.download = `${safeFilename}_graph_${new Date().toISOString().split('T')[0]}.json`;
    a.click();
    URL.revokeObjectURL(url);
    addLog('success', t('messages.exportSuccess'));
  };

  /**
   * Migrate a parsed library JSON forward to the current export schema.
   * Idempotent: passing a v2 document through it is a no-op.
   *
   * v1 → v2 changes:
   *   - svgs: a JSON-stringified string → a real array
   *   - InterventionEvent.context: drop (the library config carries it)
   *   - InterventionEvent.id: generate if missing
   *
   * Tolerant: if any step fails, the original sub-tree is preserved.
   */
  const migrateLibraryJson = (raw: any): any => {
    if (!raw || typeof raw !== 'object') return raw;
    const v = raw.schemaVersion ?? 1;
    if (v >= EXPORT_SCHEMA_VERSION) return raw; // already current

    // v1 had a doubly-encoded svgs string. Parse it into the proper array.
    if (typeof raw.svgs === 'string') {
      try {
        const parsed = JSON.parse(raw.svgs);
        if (Array.isArray(parsed)) raw.svgs = parsed;
      } catch {
        raw.svgs = [];
      }
    }

    // v1 events carried a context object and lacked stable ids.
    // Strip the redundant context (library config carries it) and assign
    // a fresh short id to any event missing one.
    const newId = (): string => {
      const bytes = new Uint8Array(4);
      if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
        crypto.getRandomValues(bytes);
      } else {
        for (let i = 0; i < 4; i++) bytes[i] = Math.floor(Math.random() * 256);
      }
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
    };
    if (Array.isArray(raw.rows)) {
      for (const row of raw.rows) {
        const log = row?.interventionLog;
        if (!log || !Array.isArray(log.sessions)) continue;
        for (const session of log.sessions) {
          if (!Array.isArray(session?.events)) continue;
          for (const event of session.events) {
            // Lift modelId out of the legacy context (if it ever lived there).
            const legacyContext = event?.context;
            if (legacyContext && typeof legacyContext === 'object') {
              if (legacyContext.modelId && !event.modelId) {
                event.modelId = legacyContext.modelId;
              }
              delete event.context;
            }
            if (!event.id) event.id = newId();
          }
        }
      }
    }

    raw.schemaVersion = EXPORT_SCHEMA_VERSION;
    return raw;
  };

  const handleImportProject = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Warn user about replacement
    if (!window.confirm(t('messages.libraryImportWarning'))) {
      e.target.value = ''; // Reset input
      return;
    }

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const content = event.target?.result as string;
        // Migrate forward as the very first step so the rest of the
        // import flow only ever sees the current schema.
        const parsed = migrateLibraryJson(JSON.parse(content));
        if (Array.isArray(parsed)) {
          const sanitized = parsed.map(sanitizeRow);
          setRows(sanitized);
          addLog('success', t('messages.importLegacy', { count: sanitized.length }));
        }
        else if (parsed.rows && Array.isArray(parsed.rows)) {
          const sanitized = parsed.rows.map(sanitizeRow);
          setRows(sanitized);
          if (parsed.config) {
            const newConfig = { ...parsed.config };
            // Retrocompatibilidad: author → name
            if (!newConfig.name && newConfig.author) {
              newConfig.name = newConfig.author;
              delete newConfig.author;
            }
            if (!newConfig.generationModel) {
              newConfig.generationModel = newConfig.imageModel
                ? migrateImageModel(newConfig.imageModel)
                : DEFAULT_GENERATION_MODEL;
            }
            delete newConfig.imageModel;
            delete newConfig.aspectRatio;
            if (!newConfig.credits) newConfig.credits = '';
            if (!newConfig.license) newConfig.license = 'cc-by';
            setConfig(newConfig);
            addLog('info', t('messages.configRestored'));
          }
          if (parsed.svgs && Array.isArray(parsed.svgs)) {
            const count = importSVGs(parsed.svgs);
            if (count > 0) addLog('success', t('messages.svgLibraryRestored', { count }));
          }
          addLog('success', t('messages.graphRestored', { count: sanitized.length }));
        } else {
          throw new Error(t('messages.fileFormatError'));
        }
      } catch (err) {
        addLog('error', t('messages.importError'));
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  const addNewRow = (textValue: string = "") => {
    const newId = `R_MANUAL_${Date.now()}`;
    const realText = textValue.trim();
    const newEntry: RowData = {
      id: newId,
      UTTERANCE: realText || 'Nueva Unidad Semántica',
      status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle'
    };
    scrollToRowRef.current = newId;
    if (realText) autoCascadeRef.current = newId;
    setRows(prev => [newEntry, ...prev]);
    handleOpenRowChange(newId);
    setShowConfig(false);
    setSearchValue('');
    setIsSearching(false);
  };

  const handleLibraryMenuToggle = () => {
    if (!showLibraryMenu && libraryBtnRef.current) {
      const rect = libraryBtnRef.current.getBoundingClientRect();
      const DROPDOWN_WIDTH = 224;
      setLibraryMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - DROPDOWN_WIDTH),
      });
    }
    setShowLibraryMenu(!showLibraryMenu);
  };

  const handleLangMenuToggle = () => {
    if (!showLangMenu && langBtnRef.current) {
      const rect = langBtnRef.current.getBoundingClientRect();
      const DROPDOWN_WIDTH = 140;
      setLangMenuPos({
        top: rect.bottom + 4,
        left: Math.max(8, rect.right - DROPDOWN_WIDTH),
      });
    }
    setShowLangMenu(!showLangMenu);
  };

  const handleLangSelect = (newLang: Locale) => {
    setLang(newLang);
    setConfig(prev => {
      const isDefault = Object.values(DEFAULT_STYLE_PROMPTS).includes(prev.visualStylePrompt);
      return {
        ...prev,
        lang: newLang,
        uiLang: newLang,
        ...(isDefault ? { visualStylePrompt: getDefaultStylePrompt(newLang) } : {}),
      };
    });
    setShowLangMenu(false);
  };

  const clearAll = () => {
    setConfirmDialog({
      isOpen: true,
      title: t('actions.deleteAll'),
      message: t('actions.deleteAllConfirm'),
      onConfirm: async () => {
        setRows([]);
        setLogs([]);
        clearLibrary();
        localStorage.removeItem(STORAGE_KEY);

        // Clear all IndexedDB data (rows, bitmaps, svgs)
        try {
          await IndexedDBService.clearAllData();
        } catch (err) {
          console.error('Failed to clear IndexedDB:', err);
        }

        closeLibrary();
        setShowLibraryMenu(false);
        addLog('info', t('messages.allCleared'));
        setConfirmDialog(prev => ({ ...prev, isOpen: false }));
      }
    });
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
        const typedRows = data.rows as RowData[];
        addLog('success', `Biblioteca cargada: ${typedRows?.length || 0} pictogramas`);

        const newLib = libraryService.createLibrary(displayName);

        // Save row metadata (no binary) to localStorage
        libraryService.saveLibraryRows(newLib.id, typedRows.map((r: RowData) => {
          const { bitmap, rawSvg, structuredSvg, ...meta } = r;
          return meta;
        }));

        // Compute pending config change now but apply it AFTER the await below,
        // so all setState calls land in the same batch as setActiveLibraryId
        // (from openLibrary). If setConfig fired before the await, the save
        // effect would write the template config to the previously active library.
        let pendingConfig: GlobalConfig | null = null;
        if (data.config) {
          pendingConfig = { ...config, ...data.config } as GlobalConfig;
          if (!pendingConfig.name && (data.config as any).author) {
            pendingConfig.name = (data.config as any).author;
          }
          libraryService.saveLibraryConfig(newLib.id, pendingConfig);
        }

        // Restore sequences from the template JSON (re-keyed to the new library id)
        if (Array.isArray(data.sequences) && data.sequences.length > 0) {
          const reKeyed = (data.sequences as Sequence[]).map(seq => ({ ...seq, libraryId: newLib.id }));
          libraryService.saveLibrarySequences(newLib.id, reKeyed);
          libraryService.updateLibraryMeta(newLib.id, { sequenceCount: reKeyed.length });
          addLog('info', `${reKeyed.length} secuencia(s) restaurada(s)`);
        }

        // Write binary data to IDB now (awaited) so bitmaps survive a page
        // reload even for large libraries whose IDB writes might not finish
        // before the browser is closed if left fire-and-forget.
        const bitmapEntries = typedRows
          .filter(r => r.bitmap)
          .map(r => ({ id: r.id, bitmap: r.bitmap!, libraryId: newLib.id }));
        const svgEntries = typedRows.filter(r => r.rawSvg || r.structuredSvg);
        await Promise.all([
          bitmapEntries.length > 0 ? IndexedDBService.saveBitmapsBatch(bitmapEntries) : Promise.resolve(),
          ...svgEntries.map(r =>
            IndexedDBService.saveSvgs(r.id, { rawSvg: r.rawSvg, structuredSvg: r.structuredSvg }, newLib.id)
          ),
        ]);

        // Apply all state changes in one batch so the save effect sees the
        // correct activeLibraryId alongside the new rows and config.
        if (pendingConfig) setConfig(prev => ({ ...prev, ...pendingConfig! }));
        setRows(typedRows);
        if (Array.isArray(data.sequences) && data.sequences.length > 0) {
          setSequences((data.sequences as Sequence[]).map(seq => ({ ...seq, libraryId: newLib.id })));
        }
        setLibraryIndex(libraryService.getLibraryIndex());
        openLibrary(newLib.id, { skipRowLoad: true });
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
        message: t('home.loadLibraryWarning', { count: rows.length }),
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

  // ID-based update: immune to array index shifts and stale closures.
  // Use this for callbacks passed to components with async operations.
  const updateRowById = (id: string, updates: Partial<RowData>) => {
    setRows(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  };

  const handleStopProcess = (rowId: string) => {
    stopFlags.current[rowId] = true;
    setRows(prev => {
      const row = prev.find(r => r.id === rowId);
      if (!row) return prev;
      addLog('info', t('messages.stopRequested', { utterance: row.UTTERANCE }));
      return prev.map(r => r.id === rowId ? {
        ...r,
        status: 'idle',
        nluStatus: r.nluStatus === 'processing' ? 'idle' : r.nluStatus,
        visualStatus: r.visualStatus === 'processing' ? 'idle' : r.visualStatus,
        bitmapStatus: r.bitmapStatus === 'processing' ? 'idle' : r.bitmapStatus,
        structuredSvgStatus: r.structuredSvgStatus === 'processing' ? 'idle' : r.structuredSvgStatus,
      } : r);
    });
  };

  // === Intervention recording (see specs/intervention-recording.allium) ===

  // Snapshot of phase artifacts at session start / last commit, used to detect
  // edits at settle moments (row close, regenerate). Element edits commit
  // eagerly with explicit op, so they bypass this comparison.
  type PhaseSnapshot = { utterance?: string; nlu?: unknown; elements?: unknown; prompt?: string };
  const phaseSnapshotsRef = useRef<Record<string, PhaseSnapshot>>({});

  const takeSnapshot = (row: RowData): PhaseSnapshot => ({
    utterance: row.UTTERANCE,
    nlu: row.NLU,
    elements: row.elements,
    prompt: row.prompt,
  });

  const startRecordingSession = useCallback((rowId: string) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next = Recording.startSession(r, config);
      phaseSnapshotsRef.current[rowId] = takeSnapshot(next);
      return next;
    }));
  }, [config]);

  // Pure settle: takes (row, snap) and returns { row, snap } with edits emitted.
  // Mutating the ref inside a setRows updater is unsafe under StrictMode, which
  // runs updaters twice — the second run would see the mutation from the first
  // and skip emission. Callers capture snap before setRows and update after.
  const settleEditsPure = useCallback((row: RowData, snap: PhaseSnapshot | undefined): { row: RowData; snap: PhaseSnapshot | undefined } => {
    if (!snap) {
      const hasActive = row.interventionLog?.sessions.some(s => !s.endedAt) ?? false;
      if (!hasActive) return { row, snap: undefined };
      return { row, snap: takeSnapshot(row) };
    }
    let next = row;
    if (row.UTTERANCE !== snap.utterance) {
      next = Recording.recordEdit(next, config, { phase: 'utterance', before: snap.utterance ?? '', after: row.UTTERANCE });
    }
    if (JSON.stringify(row.NLU) !== JSON.stringify(snap.nlu)) {
      next = Recording.recordEdit(next, config, { phase: 'nlu', before: snap.nlu, after: row.NLU });
    }
    if ((row.prompt ?? '') !== (snap.prompt ?? '')) {
      next = Recording.recordEdit(next, config, { phase: 'prompt', before: snap.prompt ?? '', after: row.prompt ?? '' });
    }
    return { row: next, snap: takeSnapshot(next) };
  }, [config]);

  const endRecordingSession = useCallback((rowId: string) => {
    const oldSnap = phaseSnapshotsRef.current[rowId];
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const { row: settled } = settleEditsPure(r, oldSnap);
      return Recording.endSession(settled);
    }));
    delete phaseSnapshotsRef.current[rowId];
  }, [settleEditsPure]);

  // A row is "engaged" while ANY of its surfaces is active: the row
  // expanded in list view, the focus modal open for it, the SVG editor
  // open for it, or the vectorizer modal open for it. A single session
  // covers one continuous engagement, so navigating list → focus modal
  // → SVG editor for the same row stays inside one session.
  // See specs/intervention-recording.allium § SessionContinuesAcrossSurfaces.
  const previousEngagedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const engaged = new Set<string>();
    if (openRowId) engaged.add(openRowId);
    if (focusMode?.rowId) engaged.add(focusMode.rowId);
    if (svgEditorState.isOpen && svgEditorState.rowId) engaged.add(svgEditorState.rowId);
    const prev = previousEngagedRef.current;
    // Rows that newly became engaged: start session
    for (const id of engaged) {
      if (!prev.has(id)) startRecordingSession(id);
    }
    // Rows that disengaged: end session
    for (const id of prev) {
      if (!engaged.has(id)) endRecordingSession(id);
    }
    previousEngagedRef.current = engaged;
  }, [openRowId, focusMode, svgEditorState, startRecordingSession, endRecordingSession]);

  const handleOpenRowChange = useCallback((nextOpenId: string | null) => {
    setOpenRowId(nextOpenId);
  }, []);

  // Element operations commit eagerly with explicit op kind.
  const recordElementOp = useCallback((rowId: string, op: ElementOpKind, before: unknown, after: unknown) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const next = Recording.recordEdit(r, config, { phase: 'elements', op, before, after });
      const snap = phaseSnapshotsRef.current[rowId];
      if (snap) phaseSnapshotsRef.current[rowId] = { ...snap, elements: after };
      return next;
    }));
  }, [config]);

  const updateRowInterventionLog = useCallback((rowId: string, log: RowInterventionLog | null) => {
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      if (log === null) {
        const cleared = Recording.clearLog(r);
        delete phaseSnapshotsRef.current[rowId];
        return cleared;
      }
      return Recording.replaceLog(r, log);
    }));
  }, []);

  // Settle pending edits before a regeneration, so the discard event is
  // ordered after any unrecorded manual edit on the same phase. The snapshot
  // is captured before setRows and updated after, keeping the updater pure
  // so StrictMode's double-invocation does not skip emission.
  const settleRowEdits = useCallback((rowId: string) => {
    const oldSnap = phaseSnapshotsRef.current[rowId];
    let nextSnap: PhaseSnapshot | undefined = oldSnap;
    setRows(prev => prev.map(r => {
      if (r.id !== rowId) return r;
      const result = settleEditsPure(r, oldSnap);
      nextSnap = result.snap;
      return result.row;
    }));
    if (nextSnap) phaseSnapshotsRef.current[rowId] = nextSnap;
  }, [settleEditsPure]);

  // Record a discard event for a phase whose previous value is being replaced
  // by a fresh generation. Updates the phase snapshot to the new value so that
  // a subsequent settle does not also emit an edit event for this phase.
  const recordPhaseRegen = useCallback((rowId: string, phase: 'utterance' | 'nlu' | 'elements' | 'prompt', before: unknown, after: unknown) => {
    const hadValue = before !== undefined && before !== null && before !== '' &&
      !(Array.isArray(before) && before.length === 0);
    if (hadValue) {
      setRows(prev => prev.map(r => {
        if (r.id !== rowId) return r;
        return Recording.recordDiscard(r, config, { phase, before });
      }));
    }
    const snap = phaseSnapshotsRef.current[rowId];
    if (snap) {
      if (phase === 'nlu') snap.nlu = after;
      else if (phase === 'elements') snap.elements = after;
      else if (phase === 'prompt') snap.prompt = after as string;
      else if (phase === 'utterance') snap.utterance = after as string;
    }
  }, [config]);

  const regeneratePrompt = async (rowId: string): Promise<boolean> => {
    const row = rows.find(r => r.id === rowId);
    if (!row || !row.NLU || !row.elements) {
      addLog('error', 'Se requiere NLU y elementos para regenerar el prompt');
      return false;
    }

    stopFlags.current[rowId] = false;
    settleRowEdits(rowId);
    const beforePrompt = row.prompt;
    updateRowById(rowId, { visualStatus: 'processing' });
    const startTime = Date.now();

    try {
      let nluObj;
      try {
        nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
      } catch (parseError) {
        throw new Error(`Failed to parse NLU data: ${parseError}`);
      }

      addLog('info', `[PROMPT] Regenerando prompt espacial a partir de elementos modificados...`);
      const newPrompt = await Claude.generateSpatialPrompt(nluObj as NLUData, ensureElementsArray(row.elements), config, addLog);

      if (stopFlags.current[rowId]) {
        addLog('info', t('messages.promptRegenerationStopped'));
        updateRowById(rowId, { visualStatus: 'completed' });
        return false;
      }

      const duration = (Date.now() - startTime) / 1000;
      updateRowById(rowId, {
        prompt: newPrompt,
        visualStatus: 'completed',
        visualDuration: duration,
        bitmapStatus: 'outdated'
      });
      recordPhaseRegen(rowId, 'prompt', beforePrompt, newPrompt);
      addLog('success', `Prompt regenerado en ${duration.toFixed(1)}s: "${newPrompt.substring(0, 50)}..."`);
      return true;
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error";
      addLog('error', `Error al regenerar prompt: ${msg}`);
      updateRowById(rowId, { visualStatus: 'error' });
      return false;
    }
  };

  // ── Model change warning & bulk regeneration ─────────────────────────────

  const handleGenerationModelChange = (newModel: GenerationModel) => {
    const affected = rows.filter(r => r.generationModel && r.generationModel !== newModel && r.bitmapStatus === 'completed');
    if (affected.length === 0) {
      // ModelChangeNoWarning rule: no affected rows → commit immediately
      setConfig(prev => ({ ...prev, generationModel: newModel }));
    } else {
      // ModelChangeWarning rule: show dialog before committing
      setModelChangeWarning({ pendingModel: newModel, affectedCount: affected.length });
    }
  };

  const bulkRegenerate = async (newModel: GenerationModel) => {
    setConfig(prev => ({ ...prev, generationModel: newModel }));
    const affected = rows.filter(r => r.generationModel && r.generationModel !== newModel && r.bitmapStatus === 'completed');
    // BulkRegeneration rule: dispatch Phase 3 for all affected rows, but with
    // bounded concurrency (pool of 3). An unbounded Promise.all over N rows
    // fires N simultaneous provider calls and reliably trips 429
    // RESOURCE_EXHAUSTED on Vertex image models (dynamic shared quota).
    const configWithNewModel = { ...config, generationModel: newModel };
    const POOL_SIZE = 3;
    const pending = [...affected];
    await Promise.all(
      Array.from({ length: Math.min(POOL_SIZE, pending.length) }, async () => {
        for (let row = pending.shift(); row; row = pending.shift()) {
          await regenerateRow(row);
        }
      })
    );

    async function regenerateRow(row: RowData) {
        updateRowById(row.id, {
          bitmapStatus: 'processing',
          rawSvg: undefined,
          bitmap: undefined,
          structuredSvg: undefined,
          structuredSvgStatus: 'idle',
        });
        try {
          const p3Result: Phase3Result = (newModel === 'recraftv4_1_vector' || newModel === 'recraftv4_1')
            ? await Recraft.generateImage(ensureElementsArray(row.elements), row.prompt || "", row, configWithNewModel, addLog)
            : await Gemini.generateImage(ensureElementsArray(row.elements), row.prompt || "", row, configWithNewModel, addLog);
          const isVector = !!p3Result.svg;
          updateRowById(row.id, {
            rawSvg: isVector ? p3Result.svg : undefined,
            bitmap: isVector ? undefined : p3Result.bitmap,
            generationModel: p3Result.generationModel,
            rawSvgDiscarded: isVector ? false : undefined,
            structuredSvg: undefined,
            structuredSvgStatus: isVector ? 'outdated' : 'idle',
            bitmapStatus: 'completed',
            status: 'completed',
          });
        } catch (err: any) {
          if (err instanceof QuotaExceededError) {
            setQuotaModal({ units_used: err.units_used, limit: err.limit });
            updateRowById(row.id, { bitmapStatus: 'idle' });
          } else {
            updateRowById(row.id, { bitmapStatus: 'error' });
            addLog('error', `[REGENERAR] Error en "${row.UTTERANCE}": ${err.message}`);
          }
        }
    }
  };

  const processStep = async (rowId: string, step: 'nlu' | 'visual' | 'produce' | 'structure'): Promise<boolean> => {
    // Pre-flight: garantizar sesión antes de tocar estado de UI.
    try {
      await ensureAuth();
    } catch {
      return false;
    }

    const row = rows.find(r => r.id === rowId);
    if (!row) return false;

    stopFlags.current[rowId] = false;
    const statusKey = (step === 'structure' ? 'structuredSvgStatus' : step === 'produce' ? 'bitmapStatus' : `${step}Status`) as keyof RowData;
    const durationKey = (step === 'produce' ? 'bitmapDuration' : `${step}Duration`) as keyof RowData;

    // Settle pending manual edits as edit events before recording any discards.
    if (step !== 'produce') settleRowEdits(rowId);
    const beforeNLU = row.NLU;
    const beforeElements = row.elements;
    const beforePrompt = row.prompt;

    updateRowById(rowId, { [statusKey]: 'processing' });
    const startTime = Date.now();

    try {
      let result: any;
      if (step === 'nlu') {
        result = await Claude.generateNLU(row.UTTERANCE, addLog, config);
      } else if (step === 'visual') {
        if (!row.NLU) throw new Error('No NLU data — run COMPRENDER first');
        let nluObj;
        try {
          nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
        } catch (parseError) {
          throw new Error(`Failed to parse NLU data: ${parseError}`);
        }
        result = await Claude.generateVisualBlueprint(nluObj as NLUData, config, addLog);
      } else if (step === 'produce') {
        // Phase 3: PRODUCIR — dispatch to correct service based on generationModel
        const model = config.generationModel ?? DEFAULT_GENERATION_MODEL;
        if (model === 'recraftv4_1_vector' || model === 'recraftv4_1') {
          result = await Recraft.generateImage(ensureElementsArray(row.elements), row.prompt || "", row, config, addLog);
        } else {
          result = await Gemini.generateImage(ensureElementsArray(row.elements), row.prompt || "", row, config, addLog);
        }
      } else if (step === 'structure') {
        // Phase 5: ESTRUCTURAR — Claude Sonnet vision → structuredSvg
        if (!row.rawSvg) throw new Error('Se requiere SVG de Recraft (ejecutar PRODUCIR primero)');
        if (!row.NLU) throw new Error('Se requiere NLU (ejecutar COMPRENDER primero)');
        const nluObj = typeof row.NLU === 'string' ? JSON.parse(row.NLU) : row.NLU;
        result = await structureSVG({
          rawSvg: row.rawSvg,
          nlu: nluObj as NLUData,
          elements: ensureElementsArray(row.elements),
          utterance: row.UTTERANCE,
          config,
          onProgress: (msg) => addLog('info', msg),
          onStatus: (s) => addLog('info', `[ESTRUCTURAR] ${s}`),
        });
        if (!result.success) throw new Error(result.error || 'ESTRUCTURAR falló');
        result = result.svg; // structuredSvg string
      }

      if (stopFlags.current[rowId]) {
        addLog('info', `Proceso detenido por usuario en paso ${step.toUpperCase()}`);
        updateRowById(rowId, { [statusKey]: 'idle' });
        return false;
      }

      const duration = (Date.now() - startTime) / 1000;
      updateRowById(rowId, {
        [statusKey]: 'completed',
        [durationKey]: duration,
        ...(step === 'nlu' ? { NLU: result, visualStatus: 'outdated', bitmapStatus: 'outdated', structuredSvgStatus: 'outdated' } : {}),
        ...(step === 'visual' ? { elements: result.elements, prompt: result.prompt, bitmapStatus: 'outdated', structuredSvgStatus: 'outdated' } : {}),
        ...(step === 'produce' ? (() => {
          const p3 = result as Phase3Result;
          const isVector = !!p3.svg;
          return {
            rawSvg: isVector ? p3.svg : undefined,
            bitmap: isVector ? undefined : p3.bitmap,
            generationModel: p3.generationModel,
            rawSvgDiscarded: isVector ? false : row.rawSvgDiscarded,
            structuredSvg: undefined,
            structuredSvgDiscarded: false,
            structuredSvgStatus: isVector ? 'outdated' : 'idle',
            status: 'completed',
          };
        })() : {}),
        ...(step === 'structure' ? { structuredSvg: result, structuredSvgDiscarded: false, status: 'completed' } : {}),
      });
      if (step === 'nlu') {
        recordPhaseRegen(rowId, 'nlu', beforeNLU, result);
      } else if (step === 'visual') {
        recordPhaseRegen(rowId, 'elements', beforeElements, result.elements);
        recordPhaseRegen(rowId, 'prompt', beforePrompt, result.prompt);
      }
      addLog('success', `${step.toUpperCase()} completo: ${duration.toFixed(1)}s para "${row.UTTERANCE}"`);

      if (step === 'produce') {
        requestAnimationFrame(() => {
          const rowEl = document.getElementById(`picto-row-${rowId}`);
          const bitmapEl = rowEl?.querySelector('#svg-preview');
          if (bitmapEl) bitmapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      return true;
    } catch (err: any) {
      if (stopFlags.current[rowId]) return false;
      if (err instanceof QuotaExceededError) {
        setQuotaModal({ units_used: err.units_used, limit: err.limit });
        updateRowById(rowId, { [statusKey]: 'idle' });
        return false;
      }
      updateRowById(rowId, { [statusKey]: 'error' });
      addLog('error', `${step.toUpperCase()} Error para "${row.UTTERANCE}": ${err.message}`);
      return false;
    }
  };

  const processCascade = async (rowId: string) => {
    // Pre-flight: garantizar sesión antes de tocar estado de UI.
    // Si el usuario cancela el login, salir silenciosamente.
    try {
      await ensureAuth();
    } catch {
      return;
    }

    const row = rows.find(r => r.id === rowId);
    if (!row || !row.UTTERANCE.trim()) return;

    stopFlags.current[row.id] = false;
    addLog('info', t('messages.cascadeStarted', { utterance: row.UTTERANCE }));

    // Settle pending manual edits before the cascade discards downstream artifacts.
    settleRowEdits(rowId);
    const beforeNLU = row.NLU;
    const beforeElements = row.elements;
    const beforePrompt = row.prompt;

    const stepNames = { nlu: t('pipeline.understand'), visual: t('pipeline.compose'), produce: t('pipeline.produce') };
    let finalUpdates: Partial<RowData> = { status: 'processing' };

    try {
      // --- NLU Step (Phase 1: COMPRENDER — Claude Haiku) ---
      addLog('info', t('messages.cascadeStep', { current: 1, total: 3, step: stepNames.nlu }));
      updateRowById(rowId, { nluStatus: 'processing', visualStatus: 'idle', bitmapStatus: 'idle', structuredSvgStatus: 'idle' });
      const nluStartTime = Date.now();
      const nluResult = await Claude.generateNLU(row.UTTERANCE, addLog, config);
      if (stopFlags.current[row.id]) {
        addLog('info', t('messages.cascadeStoppedAtStep', { step: stepNames.nlu }));
        updateRowById(rowId, { nluStatus: 'idle', status: 'idle' });
        return;
      }
      finalUpdates.NLU = nluResult;
      finalUpdates.nluStatus = 'completed';
      finalUpdates.nluDuration = (Date.now() - nluStartTime) / 1000;
      addLog('success', t('messages.cascadeStepComplete', { current: 1, total: 3, duration: finalUpdates.nluDuration.toFixed(1) }));

      // --- Visual Step (Phase 2: COMPONER — Claude Haiku) ---
      addLog('info', t('messages.cascadeStep', { current: 2, total: 3, step: stepNames.visual }));
      updateRowById(rowId, { nluStatus: 'completed', nluDuration: finalUpdates.nluDuration, NLU: nluResult, visualStatus: 'processing' });
      const visualStartTime = Date.now();
      const visualResult = await Claude.generateVisualBlueprint(nluResult, config, addLog);
      if (stopFlags.current[row.id]) {
        addLog('info', t('messages.cascadeStoppedAtStep', { step: stepNames.visual }));
        updateRowById(rowId, { visualStatus: 'idle', status: 'idle' });
        return;
      }
      finalUpdates.elements = visualResult.elements;
      finalUpdates.prompt = visualResult.prompt;
      finalUpdates.visualStatus = 'completed';
      finalUpdates.visualDuration = (Date.now() - visualStartTime) / 1000;
      addLog('success', t('messages.cascadeStepComplete', { current: 2, total: 3, duration: finalUpdates.visualDuration.toFixed(1) }));

      // --- Produce Step (Phase 3: PRODUCIR — dispatch by generationModel) ---
      addLog('info', t('messages.cascadeStep', { current: 3, total: 3, step: stepNames.produce }));
      updateRowById(rowId, { visualStatus: 'completed', visualDuration: finalUpdates.visualDuration, elements: visualResult.elements, prompt: visualResult.prompt, bitmapStatus: 'processing' });
      const bitmapStartTime = Date.now();
      const p3Model = config.generationModel ?? DEFAULT_GENERATION_MODEL;
      const p3Result: Phase3Result = (p3Model === 'recraftv4_1_vector' || p3Model === 'recraftv4_1')
        ? await Recraft.generateImage(ensureElementsArray(visualResult.elements), visualResult.prompt || "", row, config, addLog)
        : await Gemini.generateImage(ensureElementsArray(visualResult.elements), visualResult.prompt || "", row, config, addLog);
      if (stopFlags.current[row.id]) {
        addLog('info', t('messages.cascadeStoppedAtStep', { step: stepNames.produce }));
        updateRowById(rowId, { bitmapStatus: 'idle', status: 'idle' });
        return;
      }
      const p3IsVector = !!p3Result.svg;
      finalUpdates.rawSvg = p3IsVector ? p3Result.svg : undefined;
      finalUpdates.bitmap = p3IsVector ? undefined : p3Result.bitmap;
      finalUpdates.generationModel = p3Result.generationModel;
      finalUpdates.rawSvgDiscarded = p3IsVector ? false : undefined;
      finalUpdates.structuredSvg = undefined;
      finalUpdates.structuredSvgStatus = p3IsVector ? 'outdated' : 'idle';
      finalUpdates.bitmapStatus = 'completed';
      finalUpdates.bitmapDuration = (Date.now() - bitmapStartTime) / 1000;
      addLog('success', t('messages.cascadeStepComplete', { current: 3, total: 3, duration: finalUpdates.bitmapDuration.toFixed(1) }));

      finalUpdates.status = 'completed';
      updateRowById(rowId, finalUpdates);

      recordPhaseRegen(rowId, 'nlu', beforeNLU, nluResult);
      recordPhaseRegen(rowId, 'elements', beforeElements, visualResult.elements);
      recordPhaseRegen(rowId, 'prompt', beforePrompt, visualResult.prompt);

      const totalTime = (finalUpdates.nluDuration || 0) + (finalUpdates.visualDuration || 0) + (finalUpdates.bitmapDuration || 0);
      addLog('success', t('messages.cascadeComplete', { duration: totalTime.toFixed(1), utterance: row.UTTERANCE }));

      requestAnimationFrame(() => {
        const rowEl = document.getElementById(`picto-row-${row.id}`);
        const bitmapEl = rowEl?.querySelector('#svg-preview');
        if (bitmapEl) bitmapEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      });

    } catch (err: any) {
      if (stopFlags.current[rowId]) return;
      if (err instanceof QuotaExceededError) {
        setQuotaModal({ units_used: err.units_used, limit: err.limit });
        updateRowById(rowId, { status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle' });
        return;
      }
      let stepFailed: 'nlu' | 'visual' | 'produce' = 'nlu';
      if (finalUpdates.nluStatus === 'completed' && finalUpdates.visualStatus !== 'completed') stepFailed = 'visual';
      else if (finalUpdates.visualStatus === 'completed') stepFailed = 'produce';

      const failedStatusKey = stepFailed === 'produce' ? 'bitmapStatus' : `${stepFailed}Status`;
      updateRowById(rowId, { [failedStatusKey]: 'error', status: 'error' });
      addLog('error', t('messages.cascadeFailed', { step: stepNames[stepFailed], error: err.message }));
    }
  };

  // Helper functions for sorting
  const getRowCompleteness = (row: RowData): number => {
    let count = 0;
    if (row.NLU && row.nluStatus === 'completed') count++;
    if (row.elements && row.prompt && row.visualStatus === 'completed') count++;
    if (validRawSvg(row) && row.bitmapStatus === 'completed') count++;
    if (validStructuredSvg(row) && row.structuredSvgStatus === 'completed') count++;
    return count;
  };

  // Captured at openSVGEditor time, read at handleSVGEditorSave time, so a
  // svg_raw / svg_structured edit event can carry pre/post SvgMetrics
  // without storing a copy of the SVG content itself.
  // See specs/intervention-recording.allium § SvgEditorSessionEdit.
  const svgEditorBeforeMetricsRef = useRef<{ rowId: string; phase: 'svg_raw' | 'svg_structured'; metrics: SvgMetrics } | null>(null);

  const openSVGEditor = (rowId: string, preferSource?: 'raw' | 'structured') => {
    const row = rows.find(r => r.id === rowId);
    if (!row) return;

    let svgToEdit: string | undefined;
    let source: 'raw' | 'structured';

    // Use valid (non-discarded) SVGs only. If the caller explicitly asks
    // for a phase that is currently discarded, fall through to the
    // downstream-priority pick — opening the editor on a discarded
    // artifact would be confusing (the user can no longer see it in the
    // grid / row view).
    const validRaw = validRawSvg(row);
    const validStructured = validStructuredSvg(row);
    if (preferSource === 'raw' && validRaw) {
      svgToEdit = validRaw;
      source = 'raw';
    } else if (preferSource === 'structured' && validStructured) {
      svgToEdit = validStructured;
      source = 'structured';
    } else {
      svgToEdit = validStructured || validRaw;
      source = validStructured ? 'structured' : 'raw';
    }

    if (!svgToEdit) {
      addLog('error', t('messages.noSvgToEdit'));
      return;
    }

    // Snapshot metrics at open for the recording layer.
    const beforeMetrics = Recording.computeSvgMetrics(svgToEdit);
    if (beforeMetrics) {
      svgEditorBeforeMetricsRef.current = {
        rowId,
        phase: source === 'structured' ? 'svg_structured' : 'svg_raw',
        metrics: beforeMetrics,
      };
    } else {
      svgEditorBeforeMetricsRef.current = null;
    }

    setSvgEditorState({
      isOpen: true,
      rowId: rowId,
      svg: svgToEdit,
      svgSource: source,
    });
    addLog('info', t('messages.openingSvgEditor', { utterance: row.UTTERANCE }));
  };

  // VectorizerApplyDiscardsRaw: applying a fresh trace overwrites rawSvg and
  // invalidates structuredSvg (which was derived from the previous trace).
  const handleVectorizerApply = (result: VectorizerResult) => {
    if (!vectorizerState.rowId) return;
    updateRowById(vectorizerState.rowId, {
      rawSvg: result.svg,
      rawSvgDiscarded: false,
      structuredSvg: undefined,
      structuredSvgDiscarded: false,
      structuredSvgStatus: 'outdated',
    });
    setVectorizerState({ isOpen: false, rowId: null });
  };

  const handleSVGEditorSave = (updatedSvg: string) => {
    if (!svgEditorState.rowId) return;
    const source = svgEditorState.svgSource;

    // Write only to the origin field — do not promote rawSvg to structuredSvg.
    // Editing in the SVG editor also re-validates the artifact (clears the
    // discard flag for the matching phase).
    const update: Partial<RowData> = source === 'structured'
      ? { structuredSvg: updatedSvg, structuredSvgDiscarded: false }
      : { rawSvg: updatedSvg, rawSvgDiscarded: false };

    updateRowById(svgEditorState.rowId, update);

    // Only update the SVG Library for structured SVGs (the "official" pictogram)
    if (source === 'structured') {
      const savedRow = rows.find(r => r.id === svgEditorState.rowId);
      if (savedRow) {
        addSVG({
          id: savedRow.id,
          utterance: savedRow.UTTERANCE,
          svg: updatedSvg,
          createdAt: new Date().toISOString(),
          sourceRowId: savedRow.id,
          lang: (typeof savedRow.NLU === 'object' && savedRow.NLU !== null)
            ? (savedRow.NLU as any).lang
            : undefined
        });
      }
    }

    const savedRow = rows.find(r => r.id === svgEditorState.rowId);
    addLog('success', t('messages.svgUpdatedSuccess', { utterance: savedRow?.UTTERANCE }));

    // Emit a svg_raw / svg_structured edit event with metrics before/after.
    // The before was captured at openSVGEditor time; the after is the saved SVG.
    const before = svgEditorBeforeMetricsRef.current;
    const rowIdAtSave = svgEditorState.rowId;
    if (before && rowIdAtSave === before.rowId) {
      const afterMetrics = Recording.computeSvgMetrics(updatedSvg);
      if (afterMetrics) {
        setRows(prev => prev.map(r =>
          r.id === rowIdAtSave
            ? Recording.recordSvgEdit(r, config, { phase: before.phase, before: before.metrics, after: afterMetrics })
            : r
        ));
      }
    }
    svgEditorBeforeMetricsRef.current = null;

    setSvgEditorState({ isOpen: false, rowId: null, svg: null, svgSource: null });
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
      }
      return 0;
    });

    return sorted;
  }, [rows, searchValue, sortBy]);

  const focusedRowData = useMemo(() => {
    if (!focusMode) return null;
    return rows.find(r => r.id === focusMode.rowId);
  }, [focusMode, rows]);

  const pdfCount = rows.filter(hasAnyValidArtifact).length;
  const pdfExportInFlight = pdfExportProgress !== null;

  const handleExportPdf = useCallback(async () => {
    if (pdfExportInFlight) return;
    if (pdfCount === 0) return;
    const controller = new AbortController();
    pdfExportAbortRef.current = controller;
    setPdfExportProgress({
      phase: 'preparing',
      totalCells: pdfCount,
      renderedCells: 0,
      totalPages: 0,
      currentPage: 0,
      currentUtterance: '',
    });
    try {
      const result = await exportLibraryToPdf({
        rows,
        config,
        t,
        signal: controller.signal,
        onProgress: setPdfExportProgress,
      });
      downloadPdf(result.blob, pdfExportFilename(config));
      addLog('success', t('messages.pdfExported', { count: result.totalCells, pages: result.totalPages }));
    } catch (e) {
      if (e instanceof PdfExportCancelledError) {
        addLog('info', t('messages.pdfExportCancelled'));
      } else {
        const msg = e instanceof Error ? e.message : String(e);
        addLog('error', t('messages.pdfExportFailed', { error: msg }));
      }
    } finally {
      pdfExportAbortRef.current = null;
      setPdfExportProgress(null);
    }
  }, [rows, config, t, pdfCount, pdfExportInFlight, addLog]);

  const handleCancelPdfExport = useCallback(() => {
    pdfExportAbortRef.current?.abort();
  }, []);

  const handleGenerateFromStep = useCallback((utterance: string, stepId: string, sequenceId: string) => {
    const newId = `R_MANUAL_${Date.now()}`;
    const newEntry: RowData = {
      id: newId,
      UTTERANCE: utterance,
      status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle',
    };
    pendingStepRowsRef.current.set(newId, { sequenceId, stepId });
    autoCascadeRef.current = newId;
    setRows(prev => [newEntry, ...prev]);
    // Stay in sequences view — the step updates in-place when the cascade completes
  }, []);

  /** Creates a blank RowData and returns a Step already linked to it.
   *  Called by SequenceEditor when the user clicks "Añadir paso". */
  const handleAddSequenceStep = useCallback((): Step => {
    const rowId = `R_SEQ_${Date.now()}`;
    const newRow: RowData = {
      id: rowId,
      UTTERANCE: '',
      status: 'idle', nluStatus: 'idle', visualStatus: 'idle', bitmapStatus: 'idle',
    };
    setRows(prev => [...prev, newRow]);
    return {
      id: crypto.randomUUID(),
      position: 0,   // SequenceEditor will set the final 1-based position
      utterance: null,
      rowId,
      state: 'complete',
    };
  }, []);

  const pictoDownloadCount = rows.filter(r => r.bitmap || r.rawSvg || r.structuredSvg).length;

  const handleDownloadPictogramasZip = useCallback(async () => {
    const zip = new JSZip();
    rows.forEach(row => {
      const safe = sanitizeFilename(row.UTTERANCE) || row.id;
      if (row.bitmap) {
        zip.file(`${safe}.png`, row.bitmap.split(',')[1], { base64: true });
      }
      const svg = row.structuredSvg || row.rawSvg;
      if (svg) zip.file(`${safe}.svg`, svg);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(config.name) || 'pictonet'}-pictogramas.zip`;
    a.click();
    URL.revokeObjectURL(url);
    setShowLibraryMenu(false);
  }, [rows, config.name]);

  const handleSequencePrint = useCallback(async (seq: Sequence) => {
    try {
      const blob = await exportSequenceToPdf(seq, rows, config, t);
      downloadPdf(blob, sequencePdfFilename(seq));
    } catch (err) {
      console.error('[sequence pdf]', err);
    }
  }, [rows, config, t]);

  const handleSequenceDownloadZip = useCallback(async (seq: Sequence) => {
    const JSZip = (await import('jszip')).default;
    const zip = new JSZip();
    const completeSteps = seq.steps
      .filter(s => s.state === 'complete' && s.rowId)
      .sort((a, b) => a.position - b.position);
    completeSteps.forEach((step, i) => {
      const row = rows.find(r => r.id === step.rowId);
      if (!row) return;
      const prefix = `${String(i + 1).padStart(2, '0')}-${sanitizeFilename(step.utterance ?? '') || step.id}`;
      if (row.bitmap) zip.file(`${prefix}.png`, row.bitmap.split(',')[1], { base64: true });
      const svg = row.structuredSvg || row.rawSvg;
      if (svg) zip.file(`${prefix}.svg`, svg);
    });
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitizeFilename(seq.name) || 'secuencia'}-pictogramas.zip`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows]);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col">
      <a href="#mainContent" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:bg-violet-950 focus:text-white focus:px-4 focus:py-2 focus:text-sm focus:font-bold focus:rounded">
        Saltar al contenido principal
      </a>
      <header id="toolbar" className="h-20 bg-white border-b border-slate-200 sticky top-0 z-50 flex items-center px-8 justify-between shadow-sm" aria-label="Barra de herramientas">
        <div id="brand-area" className="flex items-center gap-4 cursor-pointer" onClick={() => { setViewingLibraryHome(true); setShowConfig(false); }}>
          <div className="p-1.5"><LogoIcon size={44} /></div>
          <div>
            <h1 className="font-bold uppercase tracking-tight text-xl text-slate-900 leading-none">
              {activeLibraryId ? (libraryIndex.find(l => l.id === activeLibraryId)?.name ?? 'PICTOS.NET') : 'PICTOS.NET'}
            </h1>
            <span id="tagline" className="text-xs text-slate-500 font-mono tracking-widest uppercase">PICTOS.net v{APP_VERSION}</span>
          </div>
        </div>

        <div id="search-area" className="flex-1 max-w-xl mx-8">
          <SearchComponent
            rows={rows}
            searchValue={searchValue}
            onSearchChange={setSearchValue}
            onAddNewRow={addNewRow}
            isFocused={isSearching}
            setIsFocused={setIsSearching}
          />
        </div>

        <nav id="header-actions" aria-label="Acciones principales" className="flex gap-2 items-center">
          <input type="file" ref={importInputRef} className="hidden" accept=".json" onChange={handleImportProject} />
          <input type="file" ref={appendPhrasesInputRef} className="hidden" accept=".txt" onChange={e => e.target.files?.[0]?.text().then(processPhrases)} />
          <input
            type="file"
            ref={homeImportRef}
            className="hidden"
            accept=".txt"
            onChange={async e => {
              const file = e.target.files?.[0];
              if (!file) return;
              const text = await file.text();
              e.target.value = '';
              if (!activeLibraryId) {
                let targetId: string;
                if (libraryIndex.length > 0) {
                  const sorted = [...libraryIndex].sort((a, b) =>
                    new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime()
                  );
                  targetId = sorted[0].id;
                } else {
                  const lib = libraryService.createLibrary('Mi librería');
                  setLibraryIndex(libraryService.getLibraryIndex());
                  targetId = lib.id;
                }
                await openLibrary(targetId);
              }
              processPhrases(text);
            }}
          />
          <input
            ref={libImportRef}
            type="file"
            accept=".json"
            className="hidden"
            onChange={e => { const f = e.target.files?.[0]; if (f) handleImportLibrary(f); e.target.value = ''; }}
          />

          {/* Language Switcher */}
          <div id="lang-btn-group" ref={langBtnRef} className="relative flex items-center bg-white border border-slate-200 shadow-sm rounded-md transition-all hover:border-violet-200 group">
            <button
              onClick={handleLangMenuToggle}
              className="p-2.5 hover:bg-slate-50 text-slate-600 border-r border-slate-100 flex items-center gap-2"
              title="UI Language"
            >
              <Globe size={18} />
              <span className="text-xs font-medium text-slate-500 hidden md:inline">
                {lang === 'es-419' ? 'Español' : 'English'}
              </span>
            </button>
            <button
              onClick={handleLangMenuToggle}
              className={`p-1.5 hover:bg-slate-50 text-slate-500 border-l border-transparent hover:text-violet-950 transition-colors ${showLangMenu ? 'bg-slate-50 text-violet-950' : ''}`}
              aria-label="Cambiar idioma"
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>

          <div id="library-btn-group" ref={libraryBtnRef} className="relative flex items-center bg-white border border-slate-200 shadow-sm rounded-md transition-all hover:border-violet-200 group">
            <button
              onClick={() => {
                if (activeLibraryId && !viewingLibraryHome) {
                  setViewingLibraryHome(true);
                } else if (activeLibraryId) {
                  setViewingLibraryHome(false);
                  setActiveSequenceId(null);
                  setLibraryContentMode('pictogramas');
                } else if (libraryIndex.length > 0) {
                  openLibrary(libraryIndex[0].id);
                } else {
                  handleCreateLibrary();
                }
                setShowConfig(false);
              }}
              className="p-2.5 hover:bg-slate-50 text-slate-600 border-r border-slate-100 flex items-center gap-2"
              title={t('header.libraryTooltip')}
            >
              <Library size={18} />
              <span className="text-xs font-medium text-slate-500 hidden md:inline">{t('header.library')}</span>
            </button>
            <button
              onClick={handleLibraryMenuToggle}
              className={`p-1.5 hover:bg-slate-50 text-slate-500 border-l border-transparent hover:text-violet-950 transition-colors ${showLibraryMenu ? 'bg-slate-50 text-violet-950' : ''}`}
              aria-label={t('header.libraryTooltip')}
            >
              <ChevronDown size={14} aria-hidden="true" />
            </button>
          </div>

          <div className="w-px h-8 bg-slate-200 mx-2"></div>

          <button id="console-btn" onClick={() => setShowConsole(!showConsole)} className="p-2.5 hover:bg-slate-50 text-slate-500 border border-transparent hover:border-slate-200 rounded-md transition-all" title={t('header.consoleTooltip')} aria-label={t('header.consoleTooltip')}><Terminal size={18} aria-hidden="true" /></button>

          {!(import.meta as any).env?.DEV && (
            <>
              <div className="w-px h-8 bg-slate-200 mx-1"></div>
              {authUser ? (
                <button
                  onClick={() => logout()}
                  className="p-2.5 hover:bg-slate-50 text-slate-400 hover:text-rose-500 border border-transparent hover:border-slate-200 rounded-md transition-all"
                  title={`${t('header.logout')} (${authUser.email})`}
                  aria-label={t('header.logout')}
                >
                  <LogOut size={16} aria-hidden="true" />
                </button>
              ) : (
                <button
                  onClick={() => requestLogin()}
                  className="p-2.5 hover:bg-slate-50 text-slate-400 hover:text-emerald-600 border border-transparent hover:border-slate-200 rounded-md transition-all"
                  title={t('header.login')}
                  aria-label={t('header.login')}
                >
                  <LogIn size={16} aria-hidden="true" />
                </button>
              )}
            </>
          )}
        </nav>
      </header>

      {showConfig && (
        <>
        <div className="fixed inset-0 z-[39]" onClick={() => setShowConfig(false)} />
        <div id="globalSettings" className="fixed top-20 left-0 right-0 z-40 bg-white/95 backdrop-blur-md border-b shadow-2xl animate-in slide-in-from-top duration-200 max-h-[calc(100vh-5rem)] overflow-y-auto">
          <div className="max-w-7xl mx-auto p-6">

          {/* ── Sección básica (collapsible) ── */}
          <button
            type="button"
            onClick={() => setBasicConfigOpen(o => !o)}
            className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-violet-700 transition-colors w-full text-left mb-4"
            aria-expanded={basicConfigOpen}
          >
            <ChevronRight
              size={14}
              className={`transition-transform ${basicConfigOpen ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            {t('config.configureLibrary')}
          </button>

          {basicConfigOpen && (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-4">

            {/* ── Col 1: Identidad ── */}
            <div className="flex flex-col gap-4">

              {/* field-author */}
              <div id="field-author">
                <FieldLabel label={t('config.spaceName')} tooltip={t('config.spaceNameTooltip')} />
                <input
                  type="text"
                  value={config.name}
                  onChange={e => setConfig({ ...config, name: e.target.value })}
                  className="w-full text-xs border p-2.5 bg-slate-50 focus:bg-white transition-colors"
                  placeholder="My Pictogram Library"
                />
              </div>

              {/* field-credits */}
              <div id="field-credits">
                <FieldLabel
                  label={t('config.credits')}
                  tooltip={t('config.creditsTooltip')}
                />
                <textarea
                  value={config.credits || ''}
                  onChange={e => setConfig({ ...config, credits: e.target.value })}
                  placeholder={t('config.creditsPlaceholder')}
                  className="w-full text-xs border p-2.5 bg-slate-50 focus:bg-white transition-colors h-16 resize-none"
                />
              </div>

              {/* field-license */}
              <div id="field-license">
                <FieldLabel
                  label={t('config.license')}
                  tooltip={t('config.licenseTooltip')}
                />
                <select
                  value={config.license}
                  onChange={e => setConfig({ ...config, license: e.target.value })}
                  className="w-full text-xs border p-2.5 bg-slate-50 focus:bg-white transition-colors"
                >
                  <option value="copyright">{t('config.licenses.copyright')}</option>
                  <option value="cc0">{t('config.licenses.cc0')}</option>
                  <option value="cc-by">{t('config.licenses.ccBy')}</option>
                  <option value="cc-by-sa">{t('config.licenses.ccBySa')}</option>
                  <option value="cc-by-nc">{t('config.licenses.ccByNc')}</option>
                  <option value="cc-by-nc-sa">{t('config.licenses.ccByNcSa')}</option>
                </select>
              </div>

              {/* field-geo */}
              <div id="field-geo">
                <FieldLabel
                  label={t('config.geoContext')}
                  tooltip={t('config.geoContextTooltip')}
                />
                <div className="flex flex-col gap-2">
                  <div className="border p-2.5 bg-slate-50 focus-within:bg-white focus-within:ring-1 focus-within:ring-violet-200 transition-colors">
                    <div className="flex items-center gap-2">
                      <Globe size={14} className="text-slate-500" />
                      <select
                        value={config.lang}
                        onChange={(e) => {
                          const newLang = e.target.value as Locale;
                          const isDefault = Object.values(DEFAULT_STYLE_PROMPTS).includes(config.visualStylePrompt);
                          setConfig({
                            ...config,
                            lang: newLang,
                            uiLang: newLang,
                            ...(isDefault ? { visualStylePrompt: getDefaultStylePrompt(newLang) } : {}),
                          });
                          setLang(newLang);
                        }}
                        className="w-full text-xs bg-transparent border-none outline-none font-medium cursor-pointer"
                      >
                        <option value="es-419">Español</option>
                        <option value="en-GB">English</option>
                      </select>
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
            </div>

            {/* ── Col 2: Estilo visual ── */}
            <div className="flex flex-col gap-4">

              {/* field-visual-style */}
              <div id="field-visual-style" className="flex-1 flex flex-col">
                <FieldLabel
                  label={t('config.visualStylePrompt')}
                  tooltip={t('config.visualStylePromptTooltip')}
                />
                <textarea
                  value={config.visualStylePrompt}
                  onChange={e => setConfig({ ...config, visualStylePrompt: e.target.value })}
                  className="w-full text-xs border p-2.5 bg-slate-50 focus:bg-white transition-colors flex-1 min-h-[10rem] resize-none"
                />
              </div>
            </div>

            {/* ── Col 3: Generación y preferencias ── */}
            <div className="flex flex-col gap-4">

              {/* field-reduce-motion */}
              <div id="field-reduce-motion">
                <FieldLabel
                  label={t('config.animations')}
                  tooltip={t('config.animationsTooltip')}
                />
                <label className="flex items-center gap-3 cursor-pointer p-2.5 border bg-slate-50 hover:bg-white transition-colors">
                  <input
                    type="checkbox"
                    checked={!reduceMotion}
                    onChange={e => setReduceMotion(!e.target.checked)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-xs font-medium text-slate-700">
                    {reduceMotion ? t('config.animationsDisabled') : t('config.animationsEnabled')}
                  </span>
                </label>
              </div>

              {/* field-high-contrast */}
              <div id="field-high-contrast">
                <FieldLabel
                  label={t('config.highContrast')}
                  tooltip={t('config.highContrastTooltip')}
                />
                <label className="flex items-center gap-3 cursor-pointer p-2.5 border bg-slate-50 hover:bg-white transition-colors">
                  <input
                    type="checkbox"
                    checked={highContrast}
                    onChange={e => setHighContrast(e.target.checked)}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-xs font-medium text-slate-700">
                    {highContrast ? t('config.highContrastEnabled') : t('config.highContrastDisabled')}
                  </span>
                </label>
              </div>

              {/* field-recording */}
              <div id="field-recording">
                <FieldLabel
                  label={t('config.recordingModifications')}
                  tooltip={t('config.recordingModificationsTooltip')}
                />
                <label className="flex items-center gap-3 cursor-pointer p-2.5 border bg-slate-50 hover:bg-white transition-colors">
                  <input
                    type="checkbox"
                    checked={config.recording?.enabled === true}
                    onChange={e => setConfig(prev => ({ ...prev, recording: { enabled: e.target.checked } }))}
                    className="w-4 h-4 accent-violet-600"
                  />
                  <span className="text-xs font-medium text-slate-700">
                    {config.recording?.enabled === true ? t('config.recordingEnabled') : t('config.recordingDisabled')}
                  </span>
                </label>
              </div>

              {/* field-tutorial */}
              <div id="field-tutorial" className="mt-auto pt-2">
                <button
                  onClick={() => { setShowOnboarding(true); setShowConfig(false); }}
                  className="w-full text-xs font-medium text-slate-500 bg-slate-100 hover:bg-slate-200 border border-slate-200 p-2.5 rounded transition-colors flex items-center justify-center gap-2"
                  title={t('config.tutorialTooltip')}
                >
                  <HelpCircle size={14} aria-hidden="true" /> {t('config.tutorial')}
                </button>
              </div>
            </div>

          </div>
          )} {/* end basicConfigOpen */}

          {/* ── Configuración avanzada (collapsible) ── */}
          <div className="border-t pt-4">
            <button
              type="button"
              onClick={() => setConfig(prev => ({ ...prev, advancedConfigOpen: !prev.advancedConfigOpen }))}
              className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500 hover:text-violet-700 transition-colors w-full text-left"
              aria-expanded={config.advancedConfigOpen ?? false}
            >
              <ChevronRight
                size={14}
                className={`transition-transform ${config.advancedConfigOpen ? 'rotate-90' : ''}`}
                aria-hidden="true"
              />
              {t('config.advancedConfig')}
            </button>

            {config.advancedConfigOpen && (
              <div className="mt-4 space-y-4">

                {/* ── Modelos por fase — 3-col card grid ── */}
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 mb-2">
                    {t('config.pipelineModels')}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">

                    {/* Phase 1+2: COMPRENDER + COMPONER */}
                    {(() => {
                      const chk = connectionChecks['nlu'];
                      const currentNluModel = config.nluModel ?? DEFAULT_NLU_MODEL;
                      return (
                        <div className="border border-slate-200 rounded p-3 flex flex-col gap-2">
                          <FieldLabel label={t('config.nluModel')} tooltip={t('config.nluModelTooltip')} />
                          <select
                            value={currentNluModel}
                            onChange={e => setNluModel(e.target.value)}
                            className="w-full text-xs border p-2 bg-slate-50 focus:bg-white transition-colors"
                          >
                            {NLU_MODELS.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.label}{m.id === DEFAULT_NLU_MODEL ? ` (${t('config.generationModels.default') || 'predeterminado'})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => checkConnection('nlu', 'claude', currentNluModel)}
                            disabled={chk?.status === 'checking'}
                            className="flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 border border-slate-200 text-slate-500 hover:text-violet-700 hover:border-violet-300 rounded transition-colors disabled:opacity-50 w-full"
                            title={chk?.status === 'error' ? chk.error : undefined}
                          >
                            {chk?.status === 'checking' ? <RefreshCw size={10} className="animate-spin" />
                              : chk?.status === 'ok' ? <CheckCircle2 size={10} className="text-emerald-500" />
                              : chk?.status === 'error' ? <XCircle size={10} className="text-rose-500" />
                              : <Wifi size={10} />}
                            {chk?.status === 'checking' ? t('config.connectionChecking')
                              : chk?.status === 'ok' ? `${t('config.connectionOk')} ${chk.latency}ms`
                              : chk?.status === 'error' ? t('config.connectionError')
                              : t('config.checkConnection')}
                          </button>
                        </div>
                      );
                    })()}

                    {/* Phase 3: PRODUCIR */}
                    {(() => {
                      const chk = connectionChecks['generation'];
                      const currentGenModel = config.generationModel ?? DEFAULT_GENERATION_MODEL;
                      const genService = currentGenModel.startsWith('recraft') ? 'recraft' : 'gemini';
                      return (
                        <div className="border border-slate-200 rounded p-3 flex flex-col gap-2">
                          <FieldLabel label={t('config.generationModel')} tooltip={t('config.generationModelTooltip')} />
                          <select
                            value={currentGenModel}
                            onChange={e => handleGenerationModelChange(e.target.value as GenerationModel)}
                            className="w-full text-xs border p-2 bg-slate-50 focus:bg-white transition-colors"
                          >
                            {(Object.keys(GENERATION_MODEL_LABELS) as GenerationModel[]).map(m => {
                              const inoperativeReason = INOPERATIVE_GENERATION_MODELS[m];
                              return (
                                <option key={m} value={m} disabled={!!inoperativeReason}>
                                  {GENERATION_MODEL_LABELS[m]}
                                  {m === DEFAULT_GENERATION_MODEL ? ` (${t('config.generationModels.default') || 'predeterminado'})` : ''}
                                  {inoperativeReason ? ` — no disponible (${inoperativeReason})` : ''}
                                </option>
                              );
                            })}
                          </select>
                          <button
                            type="button"
                            onClick={() => checkConnection('generation', genService)}
                            disabled={chk?.status === 'checking'}
                            className="flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 border border-slate-200 text-slate-500 hover:text-violet-700 hover:border-violet-300 rounded transition-colors disabled:opacity-50 w-full"
                            title={chk?.status === 'error' ? chk.error : undefined}
                          >
                            {chk?.status === 'checking' ? <RefreshCw size={10} className="animate-spin" />
                              : chk?.status === 'ok' ? <CheckCircle2 size={10} className="text-emerald-500" />
                              : chk?.status === 'error' ? <XCircle size={10} className="text-rose-500" />
                              : <Wifi size={10} />}
                            {chk?.status === 'checking' ? t('config.connectionChecking')
                              : chk?.status === 'ok' ? `${t('config.connectionOk')} ${chk.latency}ms`
                              : chk?.status === 'error' ? t('config.connectionError')
                              : t('config.checkConnection')}
                          </button>
                        </div>
                      );
                    })()}

                    {/* Phase 4: ESTRUCTURAR */}
                    {(() => {
                      const chk = connectionChecks['structuring'];
                      const currentP5Model = config.phase5Model ?? DEFAULT_PHASE5_MODEL;
                      const structService = currentP5Model.startsWith('claude') ? 'claude' : 'gemini';
                      return (
                        <div className="border border-slate-200 rounded p-3 flex flex-col gap-2">
                          <FieldLabel label={t('config.phase5Model')} tooltip={t('config.phase5ModelTooltip')} />
                          <select
                            value={currentP5Model}
                            onChange={e => setPhase5Model(e.target.value)}
                            className="w-full text-xs border p-2 bg-slate-50 focus:bg-white transition-colors"
                          >
                            {PHASE5_MODELS.map(m => (
                              <option key={m.id} value={m.id}>
                                {m.label}{m.id === DEFAULT_PHASE5_MODEL ? ` (${t('config.generationModels.default') || 'predeterminado'})` : ''}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => checkConnection('structuring', structService, structService === 'claude' ? currentP5Model : undefined)}
                            disabled={chk?.status === 'checking'}
                            className="flex items-center justify-center gap-1.5 text-[11px] px-2 py-1.5 border border-slate-200 text-slate-500 hover:text-violet-700 hover:border-violet-300 rounded transition-colors disabled:opacity-50 w-full"
                            title={chk?.status === 'error' ? chk.error : undefined}
                          >
                            {chk?.status === 'checking' ? <RefreshCw size={10} className="animate-spin" />
                              : chk?.status === 'ok' ? <CheckCircle2 size={10} className="text-emerald-500" />
                              : chk?.status === 'error' ? <XCircle size={10} className="text-rose-500" />
                              : <Wifi size={10} />}
                            {chk?.status === 'checking' ? t('config.connectionChecking')
                              : chk?.status === 'ok' ? `${t('config.connectionOk')} ${chk.latency}ms`
                              : chk?.status === 'error' ? t('config.connectionError')
                              : t('config.checkConnection')}
                          </button>
                        </div>
                      );
                    })()}

                  </div>
                </div>

                {/* ── Resto de la configuración avanzada ── */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

                  {/* field-annotated-context */}
                  <div id="field-annotated-context">
                    <FieldLabel
                      label={t('config.annotatedContext')}
                      tooltip={t('config.annotatedContextTooltip')}
                    />
                    <textarea
                      value={config.annotatedContext || ''}
                      onChange={e => setConfig(prev => ({ ...prev, annotatedContext: e.target.value }))}
                      placeholder={t('config.annotatedContextPlaceholder')}
                      className="w-full text-xs border p-2.5 bg-slate-50 focus:bg-white transition-colors h-16 resize-none"
                    />
                  </div>

                  {/* field-palette */}
                  <div id="field-palette">
                    <FieldLabel
                      label={t('config.paletteColors')}
                      tooltip={t('config.paletteColorsTooltip')}
                    />
                    <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                      {(config.paletteColors ?? DEFAULT_PALETTE).map((color, i) => (
                        <div key={i} className="flex items-center gap-1">
                          <input
                            type="color"
                            value={color}
                            onChange={e => {
                              const next = [...(config.paletteColors ?? DEFAULT_PALETTE)];
                              next[i] = e.target.value;
                              setConfig(prev => ({ ...prev, paletteColors: next }));
                            }}
                            className="w-7 h-7 rounded border border-slate-200 cursor-pointer p-0.5 bg-white shrink-0"
                          />
                          <span className="text-[10px] font-mono text-slate-400 flex-1 select-all truncate">{color}</span>
                          <button
                            type="button"
                            onClick={() => {
                              const next = (config.paletteColors ?? DEFAULT_PALETTE).filter((_, idx) => idx !== i);
                              setConfig(prev => ({ ...prev, paletteColors: next }));
                            }}
                            className="p-1 text-slate-300 hover:text-rose-500 rounded transition-colors"
                            aria-label="Eliminar color"
                          >
                            <X size={11} />
                          </button>
                        </div>
                      ))}
                      {(config.paletteColors ?? DEFAULT_PALETTE).length < 10 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = [...(config.paletteColors ?? DEFAULT_PALETTE), '#888888'];
                            setConfig(prev => ({ ...prev, paletteColors: next }));
                          }}
                          className="col-span-2 flex items-center justify-center gap-1.5 text-xs text-slate-400 hover:text-violet-600 py-1.5 px-1 border border-dashed border-slate-200 hover:border-violet-300 rounded transition-colors mt-0.5"
                        >
                          <Plus size={11} aria-hidden="true" /> {t('config.addColor')}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* field-style-editor — svgStyleDefs + svgKeyframes */}
                  <div id="field-style-editor">
                    <button
                      onClick={() => setShowStyleEditor(true)}
                      className="w-full text-xs font-bold uppercase text-violet-700 bg-violet-50 hover:bg-violet-100 border border-violet-200 p-2.5 rounded transition-colors flex items-center justify-center gap-2"
                    >
                      <Palette size={14} aria-hidden="true" /> {t('config.openEditor')}
                    </button>
                  </div>

                </div>

              </div>
            )}
          </div>

          </div> {/* end max-w-7xl */}
        </div> {/* end globalSettings */}
        </>
      )}

      {/* ── Model change warning dialog ── */}
      {modelChangeWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-lg shadow-2xl p-6 max-w-md w-full mx-4">
            <h2 className="text-sm font-bold text-slate-800 mb-3">
              {t('modelChangeWarning.title')}
            </h2>
            <p className="text-xs text-slate-600 mb-5">
              {t('modelChangeWarning.body', {
                n: String(modelChangeWarning.affectedCount),
                currentModel: GENERATION_MODEL_LABELS[config.generationModel ?? DEFAULT_GENERATION_MODEL],
                newModel: GENERATION_MODEL_LABELS[modelChangeWarning.pendingModel],
              })}
            </p>
            <div className="flex flex-col gap-2">
              <button
                onClick={async () => {
                  const m = modelChangeWarning.pendingModel;
                  setModelChangeWarning(null);
                  await bulkRegenerate(m);
                }}
                className="w-full text-xs font-bold py-2.5 px-4 bg-violet-700 hover:bg-violet-800 text-white rounded transition-colors"
              >
                {t('modelChangeWarning.confirmChangeAndRegen', { n: String(modelChangeWarning.affectedCount) })}
              </button>
              <button
                onClick={() => {
                  setConfig(prev => ({ ...prev, generationModel: modelChangeWarning.pendingModel }));
                  setModelChangeWarning(null);
                }}
                className="w-full text-xs font-medium py-2.5 px-4 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded transition-colors"
              >
                {t('modelChangeWarning.confirmChange')}
              </button>
              <button
                onClick={() => setModelChangeWarning(null)}
                className="w-full text-xs text-slate-400 hover:text-slate-600 py-1.5 transition-colors"
              >
                {t('modelChangeWarning.cancel')}
              </button>
            </div>
          </div>
        </div>
      )}

      <main id="mainContent" className="flex-1 p-8 max-w-7xl mx-auto w-full">
        {/* Library toolbar — discrete text tabs, single row */}
        {activeLibraryId !== null && !viewingLibraryHome && (
          <div id="library-toolbar" className="mb-6 flex items-center gap-4">
            {/* Pictogramas tab + inline view toggle when active */}
            <div className="flex items-center gap-2">
              <button
                onClick={() => setLibraryContentMode('pictogramas')}
                aria-pressed={libraryContentMode === 'pictogramas'}
                className={`text-xs font-semibold uppercase tracking-wider transition-colors ${libraryContentMode === 'pictogramas' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
              >
                {t('library.contentTogglePictogramas')}
              </button>
              {libraryContentMode === 'pictogramas' && rows.length > 0 && (
                <div id="view-switcher" className="flex items-center gap-1">
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, libraryViewMode: 'list' }))}
                    title={t('library.viewList')}
                    aria-label={t('library.viewList')}
                    aria-pressed={(config.libraryViewMode ?? 'list') === 'list'}
                    className={`transition-colors ${(config.libraryViewMode ?? 'list') === 'list' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                  >
                    <List size={14} aria-hidden="true" />
                  </button>
                  <button
                    onClick={() => setConfig(prev => ({ ...prev, libraryViewMode: 'grid' }))}
                    title={t('library.viewGrid')}
                    aria-label={t('library.viewGrid')}
                    aria-pressed={config.libraryViewMode === 'grid'}
                    className={`transition-colors ${config.libraryViewMode === 'grid' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                  >
                    <LayoutGrid size={14} aria-hidden="true" />
                  </button>
                </div>
              )}
            </div>

            {/* Secuencias tab — always navigates to sequence list */}
            <button
              onClick={() => { setLibraryContentMode('secuencias'); setActiveSequenceId(null); }}
              aria-pressed={libraryContentMode === 'secuencias'}
              className={`text-xs font-semibold uppercase tracking-wider transition-colors ${libraryContentMode === 'secuencias' ? 'text-slate-900' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t('library.contentToggleSecuencias')}
            </button>

            {/* View toggle — pushed right; for pictogramas: sort+list/grid; for sequences: list/grid only when inside one */}
            {libraryContentMode === 'secuencias' && activeSequenceId !== null && (
              <div className="ml-auto flex items-center gap-1">
                <button
                  onClick={() => setSequenceViewMode('list')}
                  title={t('library.viewList')}
                  aria-pressed={sequenceViewMode === 'list'}
                  className={`transition-colors ${sequenceViewMode === 'list' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  <List size={14} aria-hidden="true" />
                </button>
                <button
                  onClick={() => setSequenceViewMode('grid')}
                  title={t('library.viewGrid')}
                  aria-pressed={sequenceViewMode === 'grid'}
                  className={`transition-colors ${sequenceViewMode === 'grid' ? 'text-violet-700' : 'text-slate-300 hover:text-slate-500'}`}
                >
                  <LayoutGrid size={14} aria-hidden="true" />
                </button>
              </div>
            )}
            {libraryContentMode === 'pictogramas' && rows.length > 0 && (
              <div className="ml-auto flex items-center gap-3">
                <button
                  onClick={() => setSortBy('alphabetical')}
                  className={`text-xs uppercase tracking-wider transition-colors ${sortBy === 'alphabetical' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {t('library.alphabetical')}
                </button>
                <button
                  onClick={() => setSortBy('completeness')}
                  className={`text-xs uppercase tracking-wider transition-colors ${sortBy === 'completeness' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
                >
                  {t('library.completeness')}
                </button>
              </div>
            )}
          </div>
        )}
        {(activeLibraryId === null || viewingLibraryHome) ? (
          <LibraryHome
            libraries={libraryIndex}
            templates={availableLibraries}
            sort={librarySort}
            onSortChange={setLibrarySort}
            storageUsed={storageInfo?.usage ?? 0}
            storageQuota={storageInfo?.quota ?? 0}
            activeLibraryId={activeLibraryId ?? undefined}
            onOpen={openLibrary}
            onCreate={handleCreateLibrary}
            onDuplicate={handleDuplicateLibrary}
            onDownload={handleDownloadLibrary}
            onRename={handleRenameLibrary}
            onDelete={handleDeleteLibrary}
            onImport={() => libImportRef.current?.click()}
            onImportPhrases={() => homeImportRef.current?.click()}
            onBackup={handleBackupLibraries}
            onOpenTemplate={loadLibrary}
          />
        ) : libraryContentMode === 'secuencias' ? (
          activeSequenceId ? (
            <SequenceEditor
              sequence={sequences.find(s => s.id === activeSequenceId) ?? sequences[0]}
              onSave={seq => setSequences(prev => prev.map(s => s.id === seq.id ? seq : s))}
              onBack={() => setActiveSequenceId(null)}
              onAddStep={handleAddSequenceStep}
              onPrint={handleSequencePrint}
              onDownloadZip={handleSequenceDownloadZip}
              rows={rows}
              viewMode={sequenceViewMode}
              onViewModeChange={setSequenceViewMode}
              renderLinkedRow={(step, dragHandle, position, deleteStep) => {
                const row = rows.find(r => r.id === step.rowId);
                if (!row) return null;
                return (
                  <RowComponent
                    row={row}
                    stepNumber={position}
                    dragHandle={dragHandle}
                    isOpen={openRowId === row.id}
                    setIsOpen={v => { handleOpenRowChange(v ? row.id : null); if (v) setShowConfig(false); }}
                    onUpdate={u => updateRowById(row.id, u)}
                    onProcess={s => processStep(row.id, s)}
                    onRegeneratePrompt={() => regeneratePrompt(row.id)}
                    onStop={() => handleStopProcess(row.id)}
                    onCascade={() => processCascade(row.id)}
                    onDelete={() => {
                      deleteStep();
                      // Also remove the row if it has no content (blank sequence step)
                      if (!row.UTTERANCE && !row.rawSvg && !row.structuredSvg && !row.bitmap && !row.NLU) {
                        setRows(prev => prev.filter(r => r.id !== row.id));
                      }
                    }}
                    onFocus={s => setFocusMode({ step: s, rowId: row.id })}
                    onLog={addLog}
                    config={config}
                    onConfigChange={partial => setConfig(prev => ({ ...prev, ...partial }))}
                    onOpenEditor={source => openSVGEditor(row.id, source)}
                    onOpenVectorizer={() => setVectorizerState({ isOpen: true, rowId: row.id })}
                    onSettleField={() => settleRowEdits(row.id)}
                    onRecordElementOp={(op, before, after) => recordElementOp(row.id, op, before, after)}
                    onUpdateInterventionLog={log => updateRowInterventionLog(row.id, log)}
                    onDiscardSvg={(phase, previousSvg) => {
                      const flagKey: keyof RowData = phase === 'svg_raw' ? 'rawSvgDiscarded' : 'structuredSvgDiscarded';
                      setRows(prev => prev.map(r => r.id !== row.id ? r : { ...r, [flagKey]: true }));
                    }}
                    phase5Model={config.phase5Model ?? DEFAULT_PHASE5_MODEL}
                    onPhase5ModelChange={setPhase5Model}
                  />
                );
              }}
            />
          ) : (
            <SequenceList
              sequences={sequences}
              libraryRows={rows}
              onOpen={id => setActiveSequenceId(id)}
              onCreate={() => {
                const newSeq: Sequence = {
                  id: crypto.randomUUID(),
                  libraryId: activeLibraryId!,
                  name: t('sequence.untitled'),
                  steps: [],
                  createdAt: new Date().toISOString(),
                  modifiedAt: new Date().toISOString(),
                };
                setSequences(prev => [...prev, newSeq]);
                setActiveSequenceId(newSeq.id);
              }}
              onDelete={id => setSequences(prev => prev.filter(s => s.id !== id))}
              onRename={(id, name) => setSequences(prev => prev.map(s =>
                s.id === id ? { ...s, name, modifiedAt: new Date().toISOString() } : s
              ))}
            />
          )
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-32 animate-in fade-in duration-700">
            <div className="animate-bounce">
              <ArrowUp size={32} className="text-violet-400" />
            </div>
            <h2 className="mt-8 text-3xl font-bold text-slate-300 tracking-tight">{t('home.emptyLibrary')}</h2>
            <p className="mt-4 text-sm text-slate-500 font-medium">{t('home.emptyLibraryHint')}</p>
            <p className="mt-6 text-xs text-slate-400">
              <button
                onClick={() => appendPhrasesInputRef.current?.click()}
                className="underline hover:text-violet-600 transition-colors cursor-pointer"
              >
                {t('home.emptyLibraryImport')}
              </button>
              <span className="relative inline-block ml-1 group">
                <HelpCircle size={12} className="inline text-slate-400 cursor-help" />
                <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 text-xs bg-slate-800 text-white rounded whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                  {t('home.emptyLibraryImportTooltip')}
                </span>
              </span>
            </p>
          </div>
        ) : config.libraryViewMode === 'grid' ? (
          /* Pictogram grid view — see specs/library-views.allium */
          <div id="grid-view" className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-4 pb-64 animate-in fade-in slide-in-from-bottom-8 duration-500">
            {filteredRows.map((row) => (
              <PictogramGridCell
                key={row.id}
                row={row}
                onUpdate={u => updateRowById(row.id, u)}
                onCascade={() => processCascade(row.id)}
                onStop={() => handleStopProcess(row.id)}
                onFocus={step => setFocusMode({ step, rowId: row.id })}
                onOpenEditor={source => openSVGEditor(row.id, source)}
                onOpenVectorizer={() => setVectorizerState({ isOpen: true, rowId: row.id })}
                onSettleField={() => settleRowEdits(row.id)}
              />
            ))}
          </div>
        ) : (
          <div id="list-view" className="space-y-4 pb-64 animate-in fade-in slide-in-from-bottom-8 duration-500">
            {filteredRows.map((row) => {
              return (
                <RowComponent
                  key={row.id} row={row} isOpen={openRowId === row.id} setIsOpen={v => { handleOpenRowChange(v ? row.id : null); if (v) setShowConfig(false); }}
                  onUpdate={u => updateRowById(row.id, u)} onProcess={s => processStep(row.id, s)}
                  onRegeneratePrompt={() => regeneratePrompt(row.id)}
                  onStop={() => handleStopProcess(row.id)}
                  onCascade={() => processCascade(row.id)}
                  onDelete={() => {
                    // Delete bitmap and SVG from IndexedDB
                    IndexedDBService.deleteBitmap(row.id).catch(err => {
                      console.error('Failed to delete bitmap from IndexedDB:', err);
                    });
                    IndexedDBService.deleteSvgs(row.id).catch(err => {
                      console.error('Failed to delete SVG from IndexedDB:', err);
                    });
                    // Remove row from state
                    setRows(prev => prev.filter(r => r.id !== row.id));
                    // Clean up recording state if this row was open
                    delete phaseSnapshotsRef.current[row.id];
                    if (openRowId === row.id) setOpenRowId(null);
                    // If the deleted row was in focus mode, clear focus mode
                    if (focusMode?.rowId === row.id) {
                      setFocusMode(null);
                    }
                  }}
                  onFocus={step => setFocusMode({ step, rowId: row.id })}
                  onLog={addLog}
                  config={config}
                  onConfigChange={partial => setConfig(prev => ({ ...prev, ...partial }))}
                  onOpenEditor={(source) => openSVGEditor(row.id, source)}
                  onOpenVectorizer={() => setVectorizerState({ isOpen: true, rowId: row.id })}
                  onSettleField={() => settleRowEdits(row.id)}
                  onRecordElementOp={(op, before, after) => recordElementOp(row.id, op, before, after)}
                  onUpdateInterventionLog={(log) => updateRowInterventionLog(row.id, log)}
                  onDiscardSvg={(phase, previousSvg) => {
                    // Set the discard flag on the row so the artifact is no
                    // longer considered valid (PDF picker etc.). The binary
                    // data itself is preserved on the row — telemetry,
                    // research analysis, and potential undo all depend on
                    // it staying around. Regenerating the same phase
                    // clears the flag (see the bitmap/raw/structured write
                    // points below).
                    const metrics = Recording.computeSvgMetrics(previousSvg);
                    const flagKey: keyof RowData =
                      phase === 'svg_raw' ? 'rawSvgDiscarded' : 'structuredSvgDiscarded';
                    setRows(prev => prev.map(r => {
                      if (r.id !== row.id) return r;
                      const flagged = { ...r, [flagKey]: true } as RowData;
                      return metrics
                        ? Recording.recordSvgDiscard(flagged, config, { phase, before: metrics })
                        : flagged;
                    }));
                  }}
                  onBuildRowClipboard={buildRowClipboardJson}
                  phase5Model={config.phase5Model ?? DEFAULT_PHASE5_MODEL}
                  onPhase5ModelChange={setPhase5Model}
                />
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-slate-50 px-8 py-10 text-xs text-slate-500">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8">
          <div>
            <h4 className="text-slate-900 font-semibold text-sm mb-2">{t('footer.research')}</h4>
            <p className="leading-relaxed">{t('footer.researchDesc')}</p>
          </div>
          <div>
            <h4 className="text-slate-900 font-semibold text-sm mb-2">{t('footer.collaborate')}</h4>
            <p className="leading-relaxed mb-3">{t('footer.collaborateDesc')}</p>
            <button
              onClick={() => setShowParticipateModal(true)}
              className="inline-flex items-center gap-1.5 text-violet-600 hover:text-violet-700 font-medium transition-colors"
            >
              <ExternalLink size={12} /> {t('footer.collaborate')}
            </button>
          </div>
          <div>
            <h4 className="text-slate-900 font-semibold text-sm mb-2">
              <a href="https://herbertspencer.net" target="_blank" rel="noopener noreferrer" className="hover:text-violet-600 transition-colors">
                {t('footer.author')}
              </a>
            </h4>
            <p className="leading-relaxed">{t('footer.affiliation2')}</p>
            <div className="flex items-center gap-4 mt-3">
              <a
                href="https://github.com/hspencer/pictos-net"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-violet-600 hover:text-violet-700 font-medium transition-colors"
              >
                <Code size={12} /> {t('footer.openSource')}
              </a>
              <span className="text-slate-300">|</span>
              <span>PICTOS v{APP_VERSION} — {t('footer.license')}</span>
            </div>
          </div>
        </div>
      </footer>

      {showParticipateModal && (
        <ParticipateModal t={t} onClose={() => setShowParticipateModal(false)} />
      )}

      {showConsole && (
        <div id="console" className="fixed bottom-0 inset-x-0 h-64 bg-slate-950 text-slate-500 mono text-xs p-6 z-50 border-t border-slate-800 overflow-auto shadow-2xl animate-in slide-in-from-bottom duration-300">
          <div className="flex justify-between items-center mb-4 pb-2 border-b border-slate-900 font-medium tracking-widest uppercase">
            <span className="flex items-center gap-3"><Terminal size={14} /> PICTOS Console</span>
            <div className="flex items-center gap-4">
              <button
                onClick={() => setLogs([])}
                className="hover:text-white transition-colors"
                aria-label="Flush console"
              >Flush</button>
              <button
                onClick={() => setShowConsole(false)}
                className="hover:text-white transition-colors"
                aria-label="Close console"
              >Cerrar</button>
            </div>
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
          onUpdate={updates => updateRowById(focusMode.rowId, updates)}
          onRegeneratePrompt={() => regeneratePrompt(focusMode.rowId)}
          config={config}
          onConfigChange={partial => setConfig(prev => ({ ...prev, ...partial }))}
          onLog={addLog}
          onOpenEditor={(source) => openSVGEditor(focusMode!.rowId, source)}
          onModeChange={(step) => setFocusMode({ step, rowId: focusMode.rowId })}
          onRecordElementOp={(op, before, after) => recordElementOp(focusMode!.rowId, op, before, after)}
          onSettleField={() => settleRowEdits(focusMode!.rowId)}
          onProcess={(step) => processStep(focusMode!.rowId, step)}
          onStop={() => handleStopProcess(focusMode!.rowId)}
          onOpenVectorizer={() => setVectorizerState({ isOpen: true, rowId: focusMode!.rowId })}
          onDiscardSvg={(phase, previousSvg) => {
            // See the matching handler on RowComponent above for rationale.
            const metrics = Recording.computeSvgMetrics(previousSvg);
            const flagKey: keyof RowData =
              phase === 'svg_raw' ? 'rawSvgDiscarded' : 'structuredSvgDiscarded';
            setRows(prev => prev.map(r => {
              if (r.id !== focusMode!.rowId) return r;
              const flagged = { ...r, [flagKey]: true } as RowData;
              return metrics
                ? Recording.recordSvgDiscard(flagged, config, { phase, before: metrics })
                : flagged;
            }));
          }}
          phase5Model={config.phase5Model ?? DEFAULT_PHASE5_MODEL}
          onPhase5ModelChange={setPhase5Model}
        />
      )}

      {/* Vectorizer Modal — bitmap → rawSvg via VTracer WASM */}
      {vectorizerState.isOpen && vectorizerState.rowId && (() => {
        const vRow = rows.find(r => r.id === vectorizerState.rowId);
        const bmp = vRow ? validBitmap(vRow) : undefined;
        return bmp ? (
          <VectorizerModal
            isOpen={vectorizerState.isOpen}
            bitmap={bmp}
            utterance={vRow!.UTTERANCE}
            onClose={() => setVectorizerState({ isOpen: false, rowId: null })}
            onApply={handleVectorizerApply}
          />
        ) : null;
      })()}

      {/* PDF export progress modal */}
      {pdfExportInFlight && (
        <PDFExportModal
          progress={pdfExportProgress}
          t={t}
          onCancel={handleCancelPdfExport}
        />
      )}

      {/* Onboarding Modal */}
      {showOnboarding && (
        <OnboardingModal
          t={t}
          lang={lang as 'es-419' | 'en-GB'}
          onClose={() => {
            setShowOnboarding(false);
            localStorage.setItem('pictonet_onboarding_done', '1');
          }}
          onSelectPreset={(stylePrompt) => {
            setConfig(prev => ({ ...prev, visualStylePrompt: stylePrompt }));
          }}
          onImportPhrases={() => appendPhrasesInputRef.current?.click()}
          onGoHome={() => closeLibrary()}
          onFocusSearch={() => {
            setIsSearching(true);
          }}
        />
      )}

      {showStyleEditor && (
        <StyleEditor
          config={config}
          onUpdateConfig={setConfig}
          onClose={() => setShowStyleEditor(false)}
        />
      )}

      {/* SVG Editor Modal */}
      {svgEditorState.isOpen && svgEditorState.svg && svgEditorState.rowId !== null && (
        <SVGEditorModal
          isOpen={svgEditorState.isOpen}
          onClose={() => {
            // Cancelled without saving: drop the captured before-metrics so they
            // don't leak into a future edit. No event is emitted.
            svgEditorBeforeMetricsRef.current = null;
            setSvgEditorState({ isOpen: false, rowId: null, svg: null, svgSource: null });
          }}
          initialSvg={svgEditorState.svg}
          utterance={rows.find(r => r.id === svgEditorState.rowId)?.UTTERANCE || ''}
          onSave={handleSVGEditorSave}
          styleDefs={config.svgStyleDefs ?? []}
          svgSource={svgEditorState.svgSource}
          config={config}
          onUpdateConfig={setConfig}
        />
      )}

      {/* Quota Exceeded Modal */}
      {quotaModal && (
        <div
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-[60] animate-in fade-in duration-200"
          onClick={() => setQuotaModal(null)}
        >
          <div
            className="bg-white rounded-xl shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200"
            onClick={e => e.stopPropagation()}
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="quota-modal-title"
          >
            <div className="p-6 border-b border-slate-100 flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0">
                <Clock size={20} className="text-orange-500" />
              </div>
              <h3 id="quota-modal-title" className="text-base font-semibold text-slate-900">
                {t('quota.title')}
              </h3>
            </div>
            <div className="p-6 space-y-3">
              <p className="text-slate-700 text-sm leading-relaxed">
                {t('quota.message', { count: quotaModal.units_used })}
              </p>
              <p className="text-slate-500 text-sm leading-relaxed">
                {t('quota.contact')}{' '}
                <a
                  href={`mailto:${t('quota.contactLink')}`}
                  className="text-violet-600 hover:underline font-medium"
                >
                  {t('quota.contactLink')}
                </a>
              </p>
            </div>
            <div className="px-6 pb-6 flex justify-end">
              <button
                onClick={() => setQuotaModal(null)}
                className="px-5 py-2.5 text-sm font-medium text-white bg-violet-950 hover:bg-black transition-all rounded-md"
              >
                {t('quota.close')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirmation Dialog Modal */}
      {confirmDialog.isOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] animate-in fade-in duration-200" onClick={closeConfirmDialog}>
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} {...confirmDialogProps}>
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">{confirmDialog.title}</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 leading-relaxed">{confirmDialog.message}</p>
            </div>
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={closeConfirmDialog}
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

      {/* Language Dropdown Portal */}
      {showLangMenu && ReactDOM.createPortal(
        <>
          <div className="fixed inset-0 z-[55]" onClick={() => setShowLangMenu(false)} />
          <div
            id="lang-dropdown"
            className="fixed w-36 bg-white border border-slate-200 shadow-xl z-[56] rounded-sm animate-in fade-in slide-in-from-top-2"
            style={{ top: langMenuPos.top, left: langMenuPos.left }}
          >
            {([['es-419', 'Español'], ['en-GB', 'English']] as [Locale, string][]).map(([code, label]) => (
              <button
                key={code}
                onClick={() => handleLangSelect(code)}
                className={`w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors ${lang === code ? 'font-bold text-violet-950 bg-violet-50' : ''}`}
              >
                {label}
              </button>
            ))}
          </div>
        </>,
        document.body
      )}

      {/* Library Dropdown Portal */}
      {showLibraryMenu && ReactDOM.createPortal(
        <>
          <div
            className="fixed inset-0 z-[55]"
            onClick={() => setShowLibraryMenu(false)}
          />
          <div
            id="library-dropdown"
            className="fixed w-56 bg-white border border-slate-200 shadow-xl z-[56] rounded-sm animate-in fade-in slide-in-from-top-2"
            style={{ top: libraryMenuPos.top, left: libraryMenuPos.left }}
          >
            <button
              onClick={() => { setShowConfig(!showConfig); setShowLibraryMenu(false); }}
              className={`w-full text-left px-4 py-3 text-xs font-bold text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors border-b border-slate-100 ${showConfig ? 'text-violet-950 bg-slate-50' : ''}`}
            >
              <Settings size={14} className="text-slate-500" /> {t('header.configureLibrary')}
            </button>
            <button
              onClick={() => { setLibraryContentMode('secuencias'); setShowLibraryMenu(false); }}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors border-b border-slate-100"
            >
              <List size={14} className="text-violet-600" /> {t('actions.mySequences')}
            </button>
            <div className="px-4 py-2 border-b border-slate-100 text-xs font-bold text-slate-500 tracking-wider tabular-nums">
              {rows.length} {rows.length === 1 ? t('actions.element') : t('actions.elements')}
            </div>
            <button
              onClick={() => { appendPhrasesInputRef.current?.click(); setShowLibraryMenu(false); }}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
            >
              <Upload size={14} className="text-violet-950" /> {t('actions.importPhrases')}
            </button>
            <button
              onClick={() => { importInputRef.current?.click(); setShowLibraryMenu(false); }}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors"
            >
              <Upload size={14} className="text-emerald-600" /> {t('actions.importLibrary')}
            </button>
            <div className="border-t border-slate-100 my-1"></div>
            <button
              onClick={() => { exportProject(); setShowLibraryMenu(false); }}
              disabled={rows.length === 0}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} className="text-slate-500" /> {t('actions.exportLibrary')}
            </button>
            <button
              onClick={() => { handleExportPdf(); setShowLibraryMenu(false); }}
              disabled={pdfCount === 0 || pdfExportInFlight}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <FileText size={14} className="text-violet-700" /> {t('actions.downloadPrintables')}
            </button>
            <button
              onClick={handleDownloadPictogramasZip}
              disabled={pictoDownloadCount === 0}
              className="w-full text-left px-4 py-3 text-xs text-slate-700 hover:bg-slate-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Download size={14} className="text-emerald-600" /> {t('actions.downloadPictogramas', { count: pictoDownloadCount })}
            </button>
            <div className="border-t border-slate-100 my-1"></div>
            <button
              onClick={clearAll}
              disabled={rows.length === 0}
              className="w-full text-left px-4 py-3 text-xs text-rose-600 hover:bg-rose-50 flex items-center gap-3 transition-colors disabled:opacity-40 disabled:cursor-not-allowed disabled:text-slate-500"
            >
              <Trash2 size={14} className="text-rose-600" /> {t('actions.deleteAll')}
            </button>
          </div>
        </>,
        document.body
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

      {/* Live region for screen reader announcements (WCAG 4.1.3) */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {statusAnnouncement}
      </div>
    </div>
  );
};

const RowComponent: React.FC<{
  row: RowData; isOpen: boolean; setIsOpen: (v: boolean) => void;
  onUpdate: (u: any) => void; onProcess: (s: any) => Promise<boolean>;
  onRegeneratePrompt: () => void;
  onStop: () => void; onCascade: () => void; onDelete: () => void;
  onFocus: (step: 'nlu' | 'visual' | 'produce' | 'format') => void;
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
  config: GlobalConfig;
  onConfigChange: (partial: Partial<GlobalConfig>) => void;
  onOpenEditor: (source?: 'raw' | 'structured') => void;
  onOpenVectorizer: () => void;
  onSettleField?: () => void;
  onRecordElementOp?: (op: ElementOpKind, before: unknown, after: unknown) => void;
  onUpdateInterventionLog?: (log: RowInterventionLog | null) => void;
  onDiscardSvg?: (phase: 'svg_raw' | 'svg_structured', previousSvg: string) => void;
  onBuildRowClipboard?: (row: RowData) => string;
  phase5Model?: string;
  onPhase5ModelChange?: (model: string) => void;
  /** Sequence context: step number shown in left strip. */
  stepNumber?: number;
  /** Sequence context: drag handle element rendered in left strip. */
  dragHandle?: React.ReactNode;
}> = ({ row, isOpen, setIsOpen, onUpdate, onProcess, onRegeneratePrompt, onStop, onCascade, onDelete, onFocus, onLog, config, onConfigChange, onOpenEditor, onOpenVectorizer, onSettleField, onRecordElementOp, onUpdateInterventionLog, onDiscardSvg, onBuildRowClipboard, phase5Model, onPhase5ModelChange, stepNumber, dragHandle }) => {
  const { t } = useTranslation();
  const [elementsManuallyEdited, setElementsManuallyEdited] = React.useState(false);
  const [promptManuallyEdited, setPromptManuallyEdited] = React.useState(false);
  const [isPromptEditing, setIsPromptEditing] = React.useState(false);
  const [isRegeneratingPrompt, setIsRegeneratingPrompt] = React.useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = React.useState(false);
  const [showAuditPanel, setShowAuditPanel] = React.useState(false);

  return (
    <div id={`picto-row-${row.id}`} className={`border transition-all duration-300 scroll-mt-24 ${isOpen ? 'ring-8 ring-slate-100 border-violet-950 bg-white' : 'hover:border-slate-300 bg-white shadow-sm'}`}>
      <div id={`row-header-${row.id}`} className="flex items-stretch pr-0 group min-h-[5rem]">
        {stepNumber !== undefined && (
          <div className="flex flex-col items-center justify-center gap-1 px-2 border-r border-slate-100 bg-slate-50 shrink-0 select-none">
            {dragHandle}
            <span className="text-[10px] font-bold text-slate-400 tabular-nums leading-none">{stepNumber}</span>
          </div>
        )}
        <div className="pl-6 py-6 pr-6 flex-1 flex items-center gap-6">
          <textarea
            value={row.UTTERANCE}
            onChange={e => onUpdate({ UTTERANCE: e.target.value, nluStatus: 'outdated', visualStatus: 'outdated', bitmapStatus: 'outdated' })}
            onBlur={() => onSettleField?.()}
            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLTextAreaElement).blur(); } }}
            rows={1}
            ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
            onInput={e => { const el = e.target as HTMLTextAreaElement; el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; }}
            className="flex-1 w-full bg-transparent border-none outline-none focus:ring-0 utterance-title text-slate-900 uppercase font-light resize-none overflow-hidden hover:bg-amber-50 hover:cursor-text focus:bg-amber-50 transition-colors rounded self-center line-clamp-2"
            style={{ lineHeight: '1.5rem' }}
          />
          <div id={`cascade-ctrl-${row.id}`} className="flex gap-2 transition-all">
            {row.status === 'processing' ? (
              <button onClick={e => { e.stopPropagation(); onStop(); }} className="p-2 bg-orange-600 text-white hover:bg-orange-700 transition-all rounded-full shadow-sm animate-pulse" title={t('actions.stopProcess')} aria-label={t('actions.stopProcess')}>
                <Square size={18} aria-hidden="true" />
              </button>
            ) : (
              <button onClick={e => { e.stopPropagation(); onCascade(); }} disabled={!row.UTTERANCE.trim()} className="p-2 border-2 border-orange-400 hover:border-orange-600 text-orange-500 hover:text-orange-700 transition-all rounded-full bg-white shadow-sm disabled:opacity-30 disabled:cursor-not-allowed" title={t('actions.runFullPipeline')} aria-label={t('actions.runFullPipeline')}>
                <Play size={18} aria-hidden="true" />
              </button>
            )}
          </div>
          <div id={`pipeline-badges-${row.id}`} className="flex gap-1.5 cursor-pointer" aria-label="Estado del pipeline" onClick={() => setIsOpen(!isOpen)}>
            <Badge step={1} label={t('pipeline.understand')} status={row.nluStatus} />
            <Badge step={2} label={t('pipeline.compose')} status={row.visualStatus} />
            <Badge step={3} label={t('pipeline.produce')} status={row.bitmapStatus} />
          </div>
        </div>
        <div
          id={`picto-thumbnail-${row.id}`}
          className="w-20 aspect-square bg-slate-50 shrink-0 flex items-center justify-center group-hover:scale-110 group-hover:rounded group-hover:shadow-[0_2px_12px_rgba(0,0,0,0.1)] transition-all cursor-pointer overflow-hidden"
          onClick={() => setIsOpen(!isOpen)}
        >
          {(() => {
            const svg = validStructuredSvg(row) || validRawSvg(row);
            const bmp = validBitmap(row);
            if (!svg && !bmp) return <div className="text-slate-200"><ImageIcon size={20} /></div>;
            if (svg) return (
              <div
                dangerouslySetInnerHTML={{ __html: injectSvgA11y(svg, row.UTTERANCE, row.prompt) }}
                className="w-full h-full [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full"
              />
            );
            return <img src={bmp!} alt={row.UTTERANCE} className="w-full h-full object-contain" />;
          })()}
        </div>
        {isOpen
          ? <ChevronDown onClick={() => setIsOpen(!isOpen)} size={20} className="text-slate-500 cursor-pointer self-center mx-6" />
          : <ChevronRight onClick={() => setIsOpen(!isOpen)} size={20} className="text-slate-500 cursor-pointer self-center mx-6" />
        }
      </div>

      {isOpen && (
        <>
          <div id={`row-detail-${row.id}`} className="p-8 border-t bg-slate-50/30 grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in slide-in-from-top-2 max-h-[calc(100vh-7.5rem)] overflow-y-auto lg:overflow-y-hidden snap-y snap-mandatory lg:snap-none">
            <StepBox id="block-nlu" label={t('pipeline.understand')} status={row.nluStatus} onRegen={() => onProcess('nlu')} onStop={onStop} onFocus={() => onFocus('nlu')} duration={row.nluDuration}>
              <SmartNLUEditor
                data={row.NLU}
                onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated' })}
                config={config}
                onConfigChange={onConfigChange}
                onSettleField={onSettleField}
              />
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
                    <label className="text-xs font-medium uppercase text-slate-500 block mb-2 tracking-widest">{t('editor.hierarchicalElements')}</label>
                    <ElementsEditor elements={row.elements || []} onUpdate={val => {
                      onUpdate({ elements: val, bitmapStatus: 'outdated' });
                      setElementsManuallyEdited(true);
                    }} onRecordOp={(op, before, after) => onRecordElementOp?.(op, before, after)} />
                    {elementsManuallyEdited && row.NLU && row.elements && row.elements.length > 0 && (
                      <button
                        onMouseDown={async (e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setIsRegeneratingPrompt(true);
                          await onRegeneratePrompt();
                          setIsRegeneratingPrompt(false);
                          setElementsManuallyEdited(false);
                          setPromptManuallyEdited(false);
                        }}
                        disabled={isRegeneratingPrompt}
                        className="mt-3 w-full py-2 px-3 bg-violet-950 hover:bg-black text-white transition-all flex items-center justify-end gap-2 text-xs font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 disabled:cursor-not-allowed animate-in fade-in slide-in-from-top-2 duration-300"
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
                  <div id="spatial-prompt" className={`flex-1 mt-6 border-t pt-6 border-slate-200 flex flex-col gap-3 transition-colors ${elementsManuallyEdited ? 'bg-amber-50 rounded-lg px-3' : ''}`}>
                    <label className="text-xs font-medium uppercase text-slate-500 block tracking-widest">{t('editor.spatialLogic')}</label>
                    {isPromptEditing ? (
                      <textarea
                        value={row.prompt || ""}
                        onChange={e => {
                          onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated' });
                          setPromptManuallyEdited(true);
                        }}
                        onBlur={() => { setIsPromptEditing(false); onSettleField?.(); }}
                        autoFocus
                        ref={el => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }}
                        onInput={e => { const t = e.target as HTMLTextAreaElement; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }}
                        className="w-full min-h-[100px] text-xs text-slate-600 leading-loose p-3 bg-slate-50 rounded border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300 resize-none overflow-hidden"
                      />
                    ) : (
                      <div
                        onClick={() => setIsPromptEditing(true)}
                        className="w-full min-h-[100px] cursor-text text-xs text-slate-600 leading-loose p-3 bg-slate-50 rounded border border-slate-200"
                      >
                        {row.prompt && row.elements && row.elements.length > 0 ? (
                          <PromptRenderer prompt={row.prompt} elements={row.elements} bare />
                        ) : (
                          <div className="text-slate-500">{row.prompt || ""}</div>
                        )}
                      </div>
                    )}
                    {promptManuallyEdited && row.prompt && row.elements && row.elements.length > 0 && (
                      <button
                        onMouseDown={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          onProcess('produce');
                          setPromptManuallyEdited(false);
                        }}
                        className="mt-3 w-full py-2 px-3 bg-white border border-slate-200 hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all flex items-center justify-center gap-2 text-xs font-medium uppercase tracking-widest shadow-sm animate-in fade-in slide-in-from-top-2 duration-300"
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
            <StepBox id="block-produce" label={t('pipeline.produce')} status={row.bitmapStatus} onRegen={() => onProcess('produce')} onStop={onStop} onFocus={() => onFocus('produce')} duration={row.bitmapDuration}
            >
              <div className="flex flex-col gap-4">

                {/* Bitmap slot — shown whenever bitmap exists; download only */}
                {validBitmap(row) && (
                  <div className="border border-slate-200 bg-white flex items-center justify-center relative overflow-hidden group/bitmap-row w-full aspect-square">
                    <img
                      src={validBitmap(row)!}
                      alt={row.UTTERANCE}
                      className="w-full h-full object-contain p-3"
                    />
                    <div className="absolute bottom-1.5 right-1.5 flex gap-1.5 z-10 opacity-0 group-hover/bitmap-row:opacity-100 transition-opacity">
                      <button
                        onClick={() => {
                          const a = document.createElement('a');
                          a.href = validBitmap(row)!;
                          a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}.png`;
                          a.click();
                        }}
                        className="p-1.5 bg-black/60 hover:bg-black/80 text-white rounded-full shadow-lg"
                        title={t('svg.download')}
                      >
                        <Download size={12} />
                      </button>
                    </div>
                  </div>
                )}

                {/* SVG artifacts: trazado (rawSvg) and/or estructurado (structuredSvg).
                   ESTRUCTURAR (relabel) needs the trace, so a bitmap alone offers TRAZAR. */}
                {hasAnyValidSvg(row) ? (
                  <div id="svg-preview">
                    <SVGGenerator
                      row={row}
                      config={config}
                      onLog={onLog}
                      onUpdate={onUpdate}
                      onOpenEditor={onOpenEditor}
                      onOpenVectorizer={onOpenVectorizer}
                      onDiscardSvg={onDiscardSvg}
                      phase5Model={phase5Model}
                      onPhase5ModelChange={onPhase5ModelChange}
                    />
                  </div>
                ) : validBitmap(row) ? (
                  <button
                    type="button"
                    onClick={onOpenVectorizer}
                    className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-violet-600 hover:bg-violet-700 text-white text-xs font-bold uppercase tracking-widest rounded transition-colors shadow-md hover:shadow-lg"
                    aria-label={t('svg.traceSvg')}
                  >
                    <Scan size={15} aria-hidden="true" /> {t('svg.traceSvg')}
                  </button>
                ) : (
                  /* No artifacts at all */
                  <div id="svg-preview" className="border border-slate-200 flex items-center justify-center min-h-[250px]">
                    <div className="text-xs text-slate-500 uppercase font-medium">{t('editor.noSvgRender')}</div>
                  </div>
                )}

              </div>
            </StepBox>
          </div>

          {/* Row Actions: Copy, Audit, Delete */}
          <div className="px-8 pb-6 bg-slate-50/30 flex justify-end gap-2">
            <button
              onClick={(e) => {
                e.stopPropagation();
                // Use the host-provided builder so the clipboard payload
                // includes the schemaVersion header and the portability
                // context. Falls back to a bare row dump only if no
                // builder is wired (defensive — should not happen in App.tsx).
                const payload = onBuildRowClipboard
                  ? onBuildRowClipboard(row)
                  : JSON.stringify(row, null, 2);
                navigator.clipboard.writeText(payload)
                  .then(() => {
                    onLog('success', t('actions.copyRowSuccess', { utterance: row.UTTERANCE }));
                  })
                  .catch((err) => {
                    onLog('error', t('actions.copyRowError', { error: err.message }));
                  });
              }}
              className="p-2 border border-slate-200 hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all bg-white shadow-sm"
              title={t('actions.copyRow')}
            >
              <Copy size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowAuditPanel(true);
              }}
              className="p-2 border border-slate-200 hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all bg-white shadow-sm"
              title={t('audit.openTooltip')}
              aria-label={t('audit.openLabel')}
            >
              <History size={14} />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setShowDeleteConfirm(true);
              }}
              className="p-2 border border-slate-200 hover:border-rose-600 text-slate-500 hover:text-rose-600 transition-all bg-white shadow-sm"
              title={t('actions.deleteRow')}
            >
              <Trash2 size={14} />
            </button>
          </div>

          <RowAuditPanel
            isOpen={showAuditPanel}
            log={row.interventionLog}
            utterance={row.UTTERANCE}
            onClose={() => setShowAuditPanel(false)}
            onReplace={(log) => onUpdateInterventionLog?.(log)}
            onClear={() => onUpdateInterventionLog?.(null)}
            onLog={onLog}
          />
        </>
      )}

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && ReactDOM.createPortal(
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] animate-in fade-in duration-200" onClick={() => setShowDeleteConfirm(false)}>
          <div className="bg-white rounded-lg shadow-2xl max-w-md w-full mx-4 animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()}>
            <div className="p-6 border-b border-slate-200">
              <h3 className="text-lg font-bold text-slate-900">{t('actions.deleteRow')}</h3>
            </div>
            <div className="p-6">
              <p className="text-slate-600 leading-relaxed">{t('actions.deleteRowConfirm', { utterance: row.UTTERANCE })}</p>
            </div>
            <div className="p-6 border-t border-slate-200 flex justify-end gap-3">
              <button
                onClick={() => setShowDeleteConfirm(false)}
                className="px-6 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 transition-all rounded-md"
              >
                {t('actions.cancel')}
              </button>
              <button
                onClick={() => {
                  onDelete();
                  setShowDeleteConfirm(false);
                }}
                className="px-6 py-2.5 text-sm font-medium text-white bg-rose-600 hover:bg-rose-700 transition-all rounded-md shadow-lg"
              >
                {t('actions.delete')}
              </button>
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

const StepBox: React.FC<{ id?: string; label: string; status: StepStatus; onRegen: () => void; onStop: () => void; onFocus: () => void; duration?: number; children: React.ReactNode; actionNode?: React.ReactNode; }> = ({ id, label, status, onRegen, onStop, onFocus, duration, children, actionNode }) => {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);
  useEffect(() => {
    let raf: number;
    if (status === 'processing') {
      startRef.current = Date.now();
      const tick = () => {
        setElapsed((Date.now() - startRef.current) / 1000);
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
    } else {
      setElapsed(0);
    }
    return () => cancelAnimationFrame(raf);
  }, [status]);

  const bg = status === 'processing' ? 'bg-orange-50/50' : status === 'completed' ? 'bg-white' : status === 'outdated' ? 'bg-amber-50/50' : 'bg-slate-50/50';

  return (
    <div id={id} role="region" aria-label={label} className={`flex flex-col gap-4 min-h-[300px] max-h-[calc(100vh-11.5rem)] snap-start border p-6 transition-all shadow-sm ${bg}`}>
      <div className="flex items-center justify-between border-b pb-4 border-slate-100">
        <h3 className="text-xs font-medium uppercase tracking-wider text-slate-900">{label}</h3>
        <div className="flex items-center gap-3">
          {status === 'processing' ? (
            <div className="flex items-center gap-3">
              <span className="text-xs font-mono font-medium text-orange-600">{elapsed.toFixed(1)}s</span>
              <button onClick={onStop} className="p-2 bg-orange-600 text-white animate-spectral rounded-full"><Square size={14} /></button>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              {duration && <span className="text-xs text-slate-500 font-mono font-medium">{duration.toFixed(1)}s</span>}
              {actionNode}
              <button onClick={onFocus} className="p-2 border hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all rounded-full" aria-label="Focus view"><Maximize size={14} aria-hidden="true" /></button>
              <button onClick={onRegen} className="p-2 border hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all rounded-full" aria-label="Regenerate"><Play size={14} aria-hidden="true" /></button>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto pb-4">{children}</div>
    </div>
  );
};

const SmartNLUEditor: React.FC<{
  data: any;
  onUpdate: (v: any) => void;
  config: GlobalConfig;
  onConfigChange: (c: Partial<GlobalConfig>) => void;
  expanded?: boolean;
  onSettleField?: () => void;
}> = ({ data, onUpdate, config, onConfigChange, expanded = false, onSettleField }) => {
  const { t, lang: uiLang, setLang } = useTranslation();
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

  const formatKey = (key: string) => key.replace(/_/g, ' ');

  const renderEditableDict = (dict: Record<string, string> | undefined, path: string, narrow?: boolean) => {
    return (
      <div className="space-y-2 text-xs bg-slate-50 p-2 border">
        {Object.entries(dict || {}).map(([key, value]) => (
          <div key={key} className="flex gap-2 items-start">
            <span className={`font-mono text-slate-500 pt-1 shrink-0 break-words ${narrow ? 'w-16' : 'w-28'}`}>{formatKey(key)}</span>
            <textarea
              rows={1}
              value={value}
              onChange={e => {
                updateField([path, key], e.target.value);
                e.target.style.height = 'auto';
                e.target.style.height = e.target.scrollHeight + 'px';
              }}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement;
                t.style.height = 'auto';
                t.style.height = t.scrollHeight + 'px';
              }}
              ref={el => {
                if (el) {
                  el.style.height = 'auto';
                  el.style.height = el.scrollHeight + 'px';
                }
              }}
              className="flex-1 min-w-0 bg-white border-b outline-none focus:border-violet-400 resize-none overflow-hidden"
            />
          </div>
        ))}
      </div>
    );
  };

  const domainLabels: Record<string, Record<string, string>> = {
    'es-419': {
      transporte: 'Transporte', salud: 'Salud', alimentación: 'Alimentación',
      educación: 'Educación', vida_cotidiana: 'Vida Cotidiana', trabajo: 'Trabajo',
      emociones: 'Emociones', tiempo_libre: 'Tiempo Libre', dinero: 'Dinero',
      seguridad: 'Seguridad', comunicación: 'Comunicación', lugar: 'Lugar',
      trámites: 'Trámites',
    },
    'en-GB': {
      transporte: 'Transport', salud: 'Health', alimentación: 'Food',
      educación: 'Education', vida_cotidiana: 'Daily Life', trabajo: 'Work',
      emociones: 'Emotions', tiempo_libre: 'Leisure', dinero: 'Money',
      seguridad: 'Safety', comunicación: 'Communication', lugar: 'Place',
      trámites: 'Paperwork',
    },
  };

  const getDomainLabel = (key: string) => {
    return domainLabels[uiLang]?.[key] || domainLabels['es-419']?.[key] || key;
  };

  return (
    <div className="space-y-4" onBlur={() => onSettleField?.()}>
      {/* Top row: multi-column only in expanded (focus modal) view */}
      <div className={`grid gap-4 items-start ${expanded ? 'grid-cols-1 md:grid-cols-2 lg:grid-cols-3' : 'grid-cols-1'}`}>
        {/* CONTEXTO */}
        <div id="nlu-context" className="border bg-white p-3 shadow-sm text-xs space-y-2">
          <span className="nlu-key uppercase">{t('editor.context')}</span>
          <div className="mt-2 space-y-2 pt-2 border-t">
            <div className="flex gap-2 items-center">
              <label className="font-mono text-slate-500 shrink-0 w-16">{t('editor.language')}</label>
              <select
                value={config.lang}
                onChange={e => {
                  const newLang = e.target.value;
                  const isDefault = Object.values(DEFAULT_STYLE_PROMPTS).includes(config.visualStylePrompt);
                  onConfigChange({
                    lang: newLang,
                    uiLang: newLang as 'es-419' | 'en-GB',
                    ...(isDefault ? { visualStylePrompt: getDefaultStylePrompt(newLang) } : {}),
                  });
                  setLang(newLang as Locale);
                }}
                className="flex-1 min-w-0 bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
              >
                <option value="es-419">Español</option>
                <option value="en-GB">English</option>
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label className="font-mono text-slate-500 shrink-0 w-16">{t('editor.domain')}</label>
              <select
                value={nlu.domain || ''}
                onChange={e => {
                  updateField(['domain'], e.target.value);
                  onUpdate({ ...nlu, domain: e.target.value });
                }}
                className="flex-1 min-w-0 bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
              >
                <option value="" disabled>{t('placeholders.selectOption')}</option>
                {VOCAB.domain.map(d => <option key={d} value={d}>{getDomainLabel(d)}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label className="font-mono text-slate-500 shrink-0 w-16">{t('editor.region')}</label>
              <div className="flex-1 flex items-center gap-1 text-xs">
                <span className={config.geoContext?.region ? 'text-slate-700' : 'text-slate-500 italic'}>
                  {config.geoContext?.region || t('editor.regionNotConfigured')}
                </span>
                <span className="text-slate-500 cursor-help" title={t('editor.regionTooltip')}>
                  <HelpCircle size={12} />
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* METADATA CLASSIFICATION */}
        <div className="border bg-white p-3 shadow-sm text-xs space-y-2">
          <span className="nlu-key uppercase">{t('editor.metadataClassification')}</span>
          <div className="mt-2 space-y-2 pt-2 border-t">
            <div className="flex gap-2 items-center">
              <label className="font-mono text-slate-500 shrink-0 w-20 break-words">{formatKey('speech_act')}</label>
              <select
                value={nlu.metadata?.speech_act || ''}
                onChange={e => updateField(['metadata', 'speech_act'], e.target.value)}
                className="flex-1 min-w-0 bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
              >
                <option value="" disabled>Select...</option>
                {VOCAB.speech_act.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
            <div className="flex gap-2 items-center">
              <label className="font-mono text-slate-500 shrink-0 w-20 break-words">{formatKey('intent')}</label>
              <select
                value={nlu.metadata?.intent || ''}
                onChange={e => updateField(['metadata', 'intent'], e.target.value)}
                className="flex-1 min-w-0 bg-white border-b outline-none focus:border-violet-400 text-xs p-1"
              >
                <option value="" disabled>Select...</option>
                {VOCAB.intent.map(opt => <option key={opt} value={opt}>{opt}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* FRAMES */}
        {nlu.frames?.map((frame, fIdx) => (
          <div key={fIdx} className="border bg-white p-3 shadow-sm text-xs space-y-2">
            <div className="nlu-key uppercase">
              {frame.frame_label || frame.frame_name}
              {' '}<span className="font-mono lowercase text-violet-500" title={frame.frame_name}>({frame.lexical_unit})</span>
            </div>
            <div className="mt-2 space-y-2 pt-2 border-t">
              {frame.frame_label && frame.frame_name !== frame.frame_label && (
                <div className="text-xs text-slate-500 font-mono mb-1">FrameNet: {frame.frame_name}</div>
              )}
              {Object.entries(frame.roles || {}).map(([role, rawData]) => {
                const data = rawData as NLUFrameRole;
                return (
                  <div key={role} className="flex gap-2">
                    <span className="font-medium w-24 text-slate-500 shrink-0 break-words">{formatKey(role)}:</span>
                    <span className="text-slate-900">{data.surface} <span className="text-xs text-violet-400">[{data.type}]</span></span>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Second row: Logical Form + Pragmatics */}
      <div className={`grid gap-4 ${expanded ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
        <div className="border bg-white p-3 shadow-sm text-xs space-y-2">
          <span className="nlu-key uppercase">{t('editor.logicalForm')}</span>
          <div className="mt-2 pt-2 border-t">
            {renderEditableDict(nlu.logical_form as unknown as Record<string, string>, 'logical_form')}
          </div>
        </div>
        <div className="border bg-white p-3 shadow-sm text-xs space-y-2">
          <span className="nlu-key uppercase">{t('editor.pragmatics')}</span>
          <div className="mt-2 pt-2 border-t">
            {renderEditableDict(nlu.pragmatics as unknown as Record<string, string>, 'pragmatics')}
          </div>
        </div>
      </div>

      {/* Bottom: Full-width NSM Explications */}
      <div className="border bg-white p-3 shadow-sm text-xs space-y-2">
        <span className="nlu-key uppercase">{t('editor.nsmExplications')}</span>
        <div className="mt-2 pt-2 border-t">
          {renderEditableDict(nlu.nsm_explications, 'nsm_explications', true)}
        </div>
      </div>
    </div>
  );
};

const PromptRenderer: React.FC<{ prompt: string; elements: VisualElement[]; bare?: boolean }> = ({ prompt, elements, bare = false }) => {
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
        const isRoot = elements.length > 0 && quotedText === elements[0].id;
        parts.push(
          <span key={match.index} className={isRoot ? 'element-pill prompt-pill element-pill--root' : 'element-pill prompt-pill'}>
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

  if (bare) {
    return <>{renderPromptWithPills()}</>;
  }
  return (
    <div className="prompt-text text-xs text-slate-600 leading-loose p-3 bg-slate-50 rounded border border-slate-200">
      {renderPromptWithPills()}
    </div>
  );
};

const ElementsEditor: React.FC<{
  elements: VisualElement[];
  onUpdate: (v: VisualElement[]) => void;
  onRecordOp?: (op: ElementOpKind, before: VisualElement[], after: VisualElement[]) => void;
}> = ({ elements, onUpdate, onRecordOp }) => {
  const { t } = useTranslation();
  const safeElements = Array.isArray(elements) ? elements : [];
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingValue, setEditingValue] = useState<string>('');
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; zone: 'before' | 'inside' | 'after' } | null>(null);

  // --- Tree utilities ---

  const findElement = (id: string, items: VisualElement[]): VisualElement | null => {
    for (const item of items) {
      if (item.id === id) return item;
      if (item.children) {
        const found = findElement(id, item.children);
        if (found) return found;
      }
    }
    return null;
  };

  const getSubtreeDepth = (el: VisualElement): number => {
    if (!el.children || el.children.length === 0) return 1;
    return 1 + Math.max(...el.children.map(getSubtreeDepth));
  };

  const getNodeDepth = (id: string, items: VisualElement[], depth = 1): number => {
    for (const item of items) {
      if (item.id === id) return depth;
      if (item.children) {
        const found = getNodeDepth(id, item.children, depth + 1);
        if (found > 0) return found;
      }
    }
    return 0;
  };

  const isDescendantOf = (ancestorId: string, nodeId: string, items: VisualElement[]): boolean => {
    const ancestor = findElement(ancestorId, items);
    if (!ancestor || !ancestor.children) return false;
    for (const child of ancestor.children) {
      if (child.id === nodeId) return true;
      if (isDescendantOf(child.id, nodeId, items)) return true;
    }
    return false;
  };

  const removeFromTree = (items: VisualElement[], id: string): VisualElement[] => {
    return items
      .filter(item => item.id !== id)
      .map(item => item.children ? { ...item, children: removeFromTree(item.children, id) } : item);
  };

  const insertInTree = (items: VisualElement[], targetId: string, node: VisualElement, zone: 'before' | 'inside' | 'after'): VisualElement[] => {
    if (zone === 'inside') {
      return items.map(item => {
        if (item.id === targetId) {
          return { ...item, children: [...(item.children || []), node] };
        }
        return item.children ? { ...item, children: insertInTree(item.children, targetId, node, zone) } : item;
      });
    }
    // before / after: insert as sibling
    const result: VisualElement[] = [];
    for (const item of items) {
      if (item.id === targetId && zone === 'before') result.push(node);
      result.push(item.children ? { ...item, children: insertInTree(item.children, targetId, node, zone) } : item);
      if (item.id === targetId && zone === 'after') result.push(node);
    }
    return result;
  };

  const insertInTreeFirst = (items: VisualElement[], targetId: string, node: VisualElement): VisualElement[] => {
    return items.map(item => {
      if (item.id === targetId) {
        return { ...item, children: [node, ...(item.children || [])] };
      }
      return item.children ? { ...item, children: insertInTreeFirst(item.children, targetId, node) } : item;
    });
  };

  // --- CRUD operations ---

  const commitTree = (op: ElementOpKind, after: VisualElement[]) => {
    onRecordOp?.(op, safeElements, after);
    onUpdate(after);
  };

  const addElement = (parentId: string | null = null) => {
    const newId = `elemento`;
    const newElement: VisualElement = { id: newId };

    if (parentId === null) {
      commitTree('add', [...safeElements, newElement]);
    } else {
      // Check depth before adding
      const parentDepth = getNodeDepth(parentId, safeElements);
      if (parentDepth >= 5) return;
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
      commitTree('add', update(safeElements));
    }
    setTimeout(() => {
      setEditingId(newId);
      setEditingValue(newId);
    }, 50);
  };

  const removeElement = (idToRemove: string) => {
    if (idToRemove === safeElements[0]?.id && getNodeDepth(idToRemove, safeElements) === 1) return; // protect root
    commitTree('remove', removeFromTree(safeElements, idToRemove));
  };

  const updateElementId = (oldId: string, newId: string) => {
    if (!newId.trim() || newId === oldId) {
      setEditingId(null);
      return;
    }
    const update = (items: VisualElement[]): VisualElement[] => {
      return items.map(item => {
        if (item.id === oldId) return { ...item, id: newId.trim() };
        return item.children ? { ...item, children: update(item.children) } : item;
      });
    };
    commitTree('rename', update(safeElements));
    setEditingId(null);
  };

  // --- Drag handlers ---

  const handleDragStart = (e: React.DragEvent, element: VisualElement) => {
    e.stopPropagation();
    setDraggedId(element.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', element.id);
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDropTarget(null);
  };

  const handleDragOver = (e: React.DragEvent, element: VisualElement, level: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === element.id) return;
    if (isDescendantOf(draggedId, element.id, safeElements)) return;

    const rect = e.currentTarget.getBoundingClientRect();
    const y = e.clientY - rect.top;
    const isRoot = level === 0;

    let zone: 'before' | 'inside' | 'after';
    if (isRoot) {
      // Root only accepts 'inside'; upper half = first, lower half = last (handled at drop)
      zone = 'inside';
    } else {
      const third = rect.height / 3;
      if (y < third) zone = 'before';
      else if (y < third * 2) zone = 'inside';
      else zone = 'after';
    }

    // Depth validation for 'inside'
    if (zone === 'inside') {
      const draggedEl = findElement(draggedId, safeElements);
      const targetDepth = getNodeDepth(element.id, safeElements);
      if (draggedEl && targetDepth + getSubtreeDepth(draggedEl) > 5) return;
    }

    e.dataTransfer.dropEffect = 'move';
    setDropTarget({ id: element.id, zone });
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.stopPropagation();
    // Only clear if leaving the element entirely (not entering a child)
    const related = e.relatedTarget as HTMLElement | null;
    if (!e.currentTarget.contains(related)) {
      setDropTarget(null);
    }
  };

  const handleDrop = (e: React.DragEvent, element: VisualElement, level: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!draggedId || draggedId === element.id) return;

    const draggedEl = findElement(draggedId, safeElements);
    if (!draggedEl) return;

    let zone = dropTarget?.zone || 'inside';
    const isRoot = level === 0;

    // For root: determine first/last child from cursor position
    if (isRoot && zone === 'inside') {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const removed = removeFromTree(safeElements, draggedId);
      const result = y < rect.height / 2
        ? insertInTreeFirst(removed, element.id, draggedEl)
        : insertInTree(removed, element.id, draggedEl, 'inside');
      commitTree('reorder', result);
    } else {
      const removed = removeFromTree(safeElements, draggedId);
      commitTree('reorder', insertInTree(removed, element.id, draggedEl, zone));
    }

    setDraggedId(null);
    setDropTarget(null);
  };

  // --- Render ---

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
    const isDragSource = draggedId === element.id;
    const isDropTarget = dropTarget?.id === element.id;
    const dropZoneClass = isDropTarget ? `drop-${dropTarget!.zone}` : '';
    const canDrag = !isRoot;
    const children = element.children || [];
    const hasChildren = children.length > 0;

    return (
      <div
        key={element.id}
        className={`element-node ${isRoot ? 'element-root' : ''} ${isDragSource ? 'dragging' : ''} ${dropZoneClass}`}
        onDragOver={e => handleDragOver(e, element, level)}
        onDragLeave={handleDragLeave}
        onDrop={e => handleDrop(e, element, level)}
      >
        {/* Node row */}
        <div className="element-node-row">
          {canDrag && (
            <span
              className="drag-handle"
              draggable
              onDragStart={e => handleDragStart(e, element)}
              onDragEnd={handleDragEnd}
            >
              <GripVertical size={12} />
            </span>
          )}

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
            <div
              className={`element-pill${isRoot ? ' element-pill--root' : ''}`}
              onClick={() => handlePillClick(element)}
              draggable={canDrag}
              onDragStart={e => handleDragStart(e, element)}
              onDragEnd={handleDragEnd}
            >
              {element.id}
            </div>
          )}

          <div className="element-actions">
            <button
              onClick={() => addElement(element.id)}
              className="element-action-btn"
              title={t('actions.addChild')}
            >
              <CornerDownRight size={12} />
            </button>
            {!isRoot && (
              <button
                onClick={() => removeElement(element.id)}
                className="element-action-btn delete"
                title={t('actions.delete')}
              >
                <X size={12} />
              </button>
            )}
          </div>
        </div>

        {/* Children with drawn connectors */}
        {hasChildren && (
          <div className="element-children">
            {children.map((child, idx) => {
              const childIsLast = idx === children.length - 1;
              return (
                <div key={child.id} className={`element-branch ${childIsLast ? 'branch-last' : ''}`}>
                  {/* Vertical spine + horizontal arm drawn via CSS */}
                  <div className="branch-connector" aria-hidden="true">
                    <div className="branch-vertical" />
                    <div className="branch-horizontal" />
                  </div>
                  {renderElement(child, level + 1, childIsLast)}
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const hasRoot = safeElements.length > 0;

  return (
    <div className="border p-4 min-h-[120px] bg-white shadow-inner">
      <div className="element-tree">
        {safeElements.map((el, idx) => renderElement(el, 0, idx === safeElements.length - 1))}
      </div>
      {!hasRoot && (
        <button
          onClick={() => addElement(null)}
          className="mt-4 pt-3 border-t border-slate-200 text-left text-xs font-bold text-violet-600 hover:text-violet-900 transition-colors w-full flex items-center gap-2 uppercase tracking-wider"
        >
          <Plus size={14} /> {t('editor.addRootElement')}
        </button>
      )}
    </div>
  );
};

const Badge: React.FC<{ step: number; label: string; status: StepStatus }> = ({ step, label, status }) => {
  const styles: Record<StepStatus, string> = {
    idle: 'bg-slate-100 text-slate-500 border-slate-200',
    processing: 'bg-orange-600 text-white animate-pulse border-orange-500',
    completed: 'bg-emerald-50 text-emerald-700 border-emerald-300',
    outdated: 'bg-amber-50 text-amber-800 border-amber-300',
    error: 'bg-rose-50 text-rose-700 border-rose-300',
    review: 'bg-violet-50 text-violet-700 border-violet-300 animate-pulse',
  };
  const tooltipId = `badge-tip-${step}`;
  return (
    <div className="group/badge relative">
      <div
        className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold border transition-all cursor-default ${styles[status]}`}
        aria-describedby={tooltipId}
        tabIndex={0}
      >
        {step}
      </div>
      <div
        id={tooltipId}
        role="tooltip"
        className="invisible group-hover/badge:visible group-focus-within/badge:visible absolute left-1/2 -translate-x-1/2 bottom-full mb-2 whitespace-nowrap bg-slate-900 text-white text-xs font-medium px-2.5 py-1 rounded shadow-lg z-50 pointer-events-none"
      >
        {label}
      </div>
    </div>
  );
};

const FOCUS_STEPS = ['nlu', 'visual', 'produce', 'format'] as const;

const FocusViewModal: React.FC<{
  mode: 'nlu' | 'visual' | 'produce' | 'format';
  row: RowData;
  onClose: () => void;
  onUpdate: (updates: Partial<RowData>) => void;
  onRegeneratePrompt: () => void;
  config: GlobalConfig;
  onConfigChange: (partial: Partial<GlobalConfig>) => void;
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
  onOpenEditor?: (source?: 'raw' | 'structured') => void;
  onModeChange: (mode: 'nlu' | 'visual' | 'produce' | 'format') => void;
  onRecordElementOp?: (op: ElementOpKind, before: VisualElement[], after: VisualElement[]) => void;
  onSettleField?: () => void;
  onProcess?: (step: 'nlu' | 'visual' | 'produce') => Promise<boolean>;
  onStop?: () => void;
  onDiscardSvg?: (phase: 'svg_raw' | 'svg_structured', previousSvg: string) => void;
  onOpenVectorizer?: () => void;
  phase5Model?: string;
  onPhase5ModelChange?: (model: string) => void;
}> = ({ mode, row, onClose, onUpdate, onRegeneratePrompt, config, onConfigChange, onLog, onOpenEditor, onModeChange, onRecordElementOp, onSettleField, onProcess, onStop, onDiscardSvg, onOpenVectorizer, phase5Model, onPhase5ModelChange }) => {
  const { t } = useTranslation();
  const { dialogProps: focusDialogProps } = useDialogA11y({ isOpen: true, onClose, label: `${row.UTTERANCE} — ${mode}` });
  const [copyStatus, setCopyStatus] = useState(t('actions.copy'));
  const [isPromptEditing, setIsPromptEditing] = useState(false);
  const [elementsManuallyEdited, setElementsManuallyEdited] = useState(false);
  const [isRegeneratingPrompt, setIsRegeneratingPrompt] = useState(false);

  const isVectorRow = row.generationModel
    ? getModelFamily(row.generationModel) === 'vector'
    : false;

  const currentIndex = FOCUS_STEPS.indexOf(mode);
  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < FOCUS_STEPS.length - 1;
  const goToPrev = () => { if (hasPrev) onModeChange(FOCUS_STEPS[currentIndex - 1]); };
  const goToNext = () => { if (hasNext) onModeChange(FOCUS_STEPS[currentIndex + 1]); };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); goToPrev(); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); goToNext(); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentIndex]);

  const handleCopy = () => {
    let contentToCopy: string = '';
    if (mode === 'nlu') {
      contentToCopy = JSON.stringify(row.NLU, null, 2);
    } else if (mode === 'visual') {
      contentToCopy = JSON.stringify({ "elements": row.elements, "prompt": row.prompt }, null, 2);
    } else if (mode === 'produce') {
      contentToCopy = row.prompt || '';
    }

    if (contentToCopy) {
      navigator.clipboard.writeText(contentToCopy).then(() => {
        setCopyStatus(t('actions.copied'));
        setTimeout(() => setCopyStatus(t('actions.copy')), 2000);
      });
    }
  };

  const titleMap: Record<string, string> = {
    nlu: t('pipeline.understand'),
    visual: t('pipeline.compose'),
    produce: t('pipeline.produce'),
    format: t('pipeline.format')
  };

  const renderContent = () => {
    switch (mode) {
      case 'nlu': return <SmartNLUEditor data={row.NLU} onUpdate={val => onUpdate({ NLU: val, visualStatus: 'outdated', bitmapStatus: 'outdated' })} config={config} onConfigChange={onConfigChange} expanded onSettleField={onSettleField} />;
      case 'visual': return (
        <div className="grid grid-cols-1 lg:grid-cols-2 h-full gap-6">
          <div className="flex flex-col">
            <label className="text-xs font-medium uppercase text-slate-500 block mb-2 tracking-widest">{t('editor.hierarchicalElements')}</label>
            <ElementsEditor elements={row.elements || []} onUpdate={val => {
              onUpdate({ elements: val, bitmapStatus: 'outdated' });
              setElementsManuallyEdited(true);
            }} onRecordOp={(op, before, after) => onRecordElementOp?.(op, before, after)} />
            {elementsManuallyEdited && row.NLU && row.elements && row.elements.length > 0 && (
              <button
                onMouseDown={async (e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  setIsRegeneratingPrompt(true);
                  await onRegeneratePrompt();
                  setIsRegeneratingPrompt(false);
                  setElementsManuallyEdited(false);
                }}
                disabled={isRegeneratingPrompt}
                className="mt-3 w-full py-2 px-3 bg-violet-950 hover:bg-black text-white transition-all flex items-center justify-end gap-2 text-xs font-bold uppercase tracking-widest shadow-lg disabled:opacity-50 disabled:cursor-not-allowed animate-in fade-in slide-in-from-top-2 duration-300"
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
          <div className={`flex flex-col lg:border-l lg:pl-6 border-slate-200 transition-colors ${elementsManuallyEdited ? 'bg-amber-50 rounded-lg p-4 lg:border-l-amber-200' : ''}`}>
            <label className="text-xs font-medium uppercase text-slate-500 block mb-3 tracking-widest">{t('editor.spatialLogic')}</label>
            {isPromptEditing ? (
              <textarea
                value={row.prompt || ""}
                onChange={e => onUpdate({ prompt: e.target.value, bitmapStatus: 'outdated' })}
                onBlur={() => { setIsPromptEditing(false); onSettleField?.(); }}
                autoFocus
                className="w-full h-full text-xs text-slate-600 leading-loose p-3 bg-slate-50 rounded border border-slate-200 outline-none focus:ring-2 focus:ring-violet-300 resize-none"
              />
            ) : (
              <div
                onClick={() => setIsPromptEditing(true)}
                className="w-full h-full cursor-text text-xs text-slate-600 leading-loose p-3 bg-slate-50 rounded border border-slate-200"
              >
                {row.prompt && row.elements && row.elements.length > 0 ? (
                  <PromptRenderer prompt={row.prompt} elements={row.elements} bare />
                ) : (
                  <div className="text-slate-500">{row.prompt || ""}</div>
                )}
              </div>
            )}
          </div>
        </div>
      );
      case 'produce': {
        // Phase 3 output: native SVG for vector models, bitmap for everything else.
        // Phase 4 trazado (VTracer rawSvg) must NOT appear here — it belongs in step 4 (format).
        const phase3Svg = isVectorRow ? validRawSvg(row) : null;
        const phase3Bitmap = !isVectorRow ? validBitmap(row) : null;
        return (
          <div className="flex items-center justify-center h-full bg-neutral-200 p-8 border-2 border-slate-300 shadow-inner">
            {phase3Svg ? (
              <div className="flex flex-col items-center gap-4 w-full h-full max-w-full max-h-full">
                <div
                  dangerouslySetInnerHTML={{ __html: injectSvgA11y(phase3Svg, row.UTTERANCE) }}
                  className="flex-1 w-full min-h-0 [&>svg]:w-full [&>svg]:h-full [&>svg]:max-w-full [&>svg]:max-h-full shadow-2xl bg-white"
                />
                {onOpenEditor && (
                  <button
                    onClick={() => onOpenEditor('raw')}
                    className="flex items-center gap-2 bg-slate-800 hover:bg-black text-white px-5 py-2.5 text-xs font-bold uppercase tracking-widest transition-all shadow-lg flex-shrink-0"
                  >
                    <Edit size={13} aria-hidden="true" /> {t('svg.editor')}
                  </button>
                )}
              </div>
            ) : phase3Bitmap ? (
              <div className="flex flex-col items-center gap-4 w-full h-full max-w-full max-h-full">
                <img
                  src={phase3Bitmap}
                  alt={row.UTTERANCE}
                  className="flex-1 min-h-0 w-full object-contain shadow-2xl bg-white"
                />
                {onOpenVectorizer && (
                  <button
                    type="button"
                    onClick={onOpenVectorizer}
                    className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-8 py-3 font-bold uppercase text-xs tracking-widest transition-all shadow-lg hover:shadow-xl"
                    aria-label={t('svg.traceSvg')}
                  >
                    <Scan size={15} aria-hidden="true" /> {t('svg.traceSvg')}
                  </button>
                )}
              </div>
            ) : (
              <p className="text-slate-500 font-mono">{t('editor.noSvgRender')}</p>
            )}
          </div>
        );
      }
      case 'format': {
        const hasRaw = !!validRawSvg(row);
        const hasStructured = !!validStructuredSvg(row);

        // Nothing yet: check for bitmap first (can vectorize), otherwise prompt to produce.
        if (!hasRaw && !hasStructured) {
          const bmp = validBitmap(row);
          return (
            <div className="flex items-center justify-center h-full bg-slate-50 p-6">
              {bmp && onOpenVectorizer ? (
                <div className="flex flex-col items-center gap-6 max-w-xs w-full">
                  <img
                    src={bmp}
                    alt={row.UTTERANCE}
                    className="max-h-[240px] w-auto object-contain border border-slate-200 bg-white shadow"
                  />
                  <button
                    type="button"
                    onClick={onOpenVectorizer}
                    className="w-full flex items-center justify-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-8 py-4 font-bold uppercase text-xs tracking-widest transition-all shadow-lg hover:shadow-xl"
                    aria-label={t('svg.traceSvg')}
                  >
                    <Scan size={16} aria-hidden="true" /> {t('svg.traceSvg')}
                  </button>
                  <p className="text-xs text-slate-400 text-center">{t('svg.traceConverts')}</p>
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center gap-4 bg-white border border-slate-200 p-8 max-w-xs text-center">
                  <FileCode size={40} className="text-slate-300" aria-hidden="true" />
                  <p className="text-sm text-slate-500">{t('library.structureRequiresRaw')}</p>
                </div>
              )}
            </div>
          );
        }

        // Has SVG(s): two-column layout (raw left, structured right)
        // See specs/library-views.allium § FocusModalFormatStep
        return (
          <div className="flex flex-col h-full bg-slate-50 p-6">
            <div className="mb-3">
              <h3 className="text-xs font-bold uppercase text-slate-500 tracking-widest">SVG Output (SSoT)</h3>
            </div>
            <div className="flex-1 overflow-hidden">
              <SVGGenerator row={row} config={config} onLog={onLog} onUpdate={onUpdate} onOpenEditor={onOpenEditor} onOpenVectorizer={onOpenVectorizer} layout="columns" onDiscardSvg={onDiscardSvg} phase5Model={phase5Model} onPhase5ModelChange={onPhase5ModelChange} />
            </div>
          </div>
        );
      }
      default: return null;
    }
  }

  return (
    <div className="focus-modal-backdrop animate-in fade-in duration-300" onClick={onClose}>
      <div className="focus-modal-content animate-in zoom-in-95 duration-200" onClick={e => e.stopPropagation()} {...focusDialogProps}>
        <header className="p-4 border-b bg-white flex items-center gap-3">
          <button onClick={goToPrev} className={`p-2 hover:bg-slate-100 transition-opacity ${hasPrev ? '' : 'opacity-20 pointer-events-none'}`} aria-label="Previous step">
            <ChevronLeft size={18} />
          </button>
          <div className="flex-1 text-center min-w-0">
            <h2 className="text-base font-semibold text-slate-800 truncate">{row.UTTERANCE}</h2>
            <div className="flex items-center justify-center gap-3 mt-1">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-500">{titleMap[mode]}</span>
              <div className="flex items-center gap-1.5">
                {FOCUS_STEPS.map((step, i) => (
                  <button
                    key={step}
                    onClick={() => onModeChange(step)}
                    className={`w-2 h-2 rounded-full transition-all ${i === currentIndex ? 'bg-violet-600 scale-125' : 'bg-slate-300 hover:bg-slate-400'}`}
                    aria-label={titleMap[step]}
                  />
                ))}
              </div>
            </div>
          </div>
          <button onClick={goToNext} className={`p-2 hover:bg-slate-100 transition-opacity ${hasNext ? '' : 'opacity-20 pointer-events-none'}`} aria-label="Next step">
            <ChevronRight size={18} />
          </button>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 ml-1" aria-label={t('actions.close')}><X size={18} aria-hidden="true" /></button>
        </header>
        <main className="flex-1 p-6 overflow-auto bg-slate-50">{renderContent()}</main>
        <footer className="px-6 py-4 border-t bg-white flex justify-between gap-3">
          {/* Left actions */}
          <div className="flex gap-3">
            {/* Regenerate this step (mirrors the per-step Play button in the row's StepBox).
                For format step there is no single regenerate — vectorize and structure
                live in the column-specific actions. */}
            {(mode === 'nlu' || mode === 'visual' || mode === 'produce') && onProcess && (() => {
              const status = mode === 'nlu' ? row.nluStatus : mode === 'visual' ? row.visualStatus : row.bitmapStatus;
              const isProc = status === 'processing';
              return isProc && onStop ? (
                <button onClick={onStop} className="flex items-center gap-2 bg-orange-600 text-white px-6 py-3 font-bold uppercase text-xs tracking-widest hover:bg-orange-700 transition-all shadow-lg animate-pulse" title={t('actions.stopProcess')}>
                  <Square size={14} /> {t('actions.stopProcess')}
                </button>
              ) : (
                <button onClick={() => onProcess(mode)} className="flex items-center gap-2 bg-orange-500 text-white px-6 py-3 font-bold uppercase text-xs tracking-widest hover:bg-orange-600 transition-all shadow-lg" title={t('actions.regenerate')}>
                  <Play size={14} /> {t('actions.regenerate')}
                </button>
              );
            })()}
            {(() => {
              const rawSvgContent = isVectorRow ? validRawSvg(row) : null;
              return mode === 'produce' && rawSvgContent && (
                <button onClick={() => { const blob = new Blob([rawSvgContent], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}_raw.svg`; a.click(); URL.revokeObjectURL(url); }} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-6 py-3 font-bold uppercase text-xs tracking-widest hover:bg-slate-200 transition-all">
                  <Download size={14} /> SVG
                </button>
              );
            })()}
          </div>
          {/* Right actions */}
          <div className="flex gap-3">
            {/* Per-column edit buttons for format step live inside SVGGenerator (columns layout) */}
            {(() => {
              const svg = validDownstreamSvg(row);
              return mode === 'format' && svg && (
                <button onClick={() => { const blob = new Blob([svg], { type: 'image/svg+xml' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `${row.UTTERANCE.replace(/\s+/g, '_').toLowerCase()}.svg`; a.click(); URL.revokeObjectURL(url); }} className="flex items-center gap-2 bg-slate-100 text-slate-600 px-6 py-3 font-bold uppercase text-xs tracking-widest hover:bg-slate-200 transition-all">
                  <Download size={14} /> SVG
                </button>
              );
            })()}
            <button onClick={handleCopy} className="flex items-center gap-2 bg-violet-950 text-white px-6 py-3 font-bold uppercase text-xs tracking-widest hover:bg-black transition-all shadow-lg">
              <Copy size={14} /> {copyStatus}
            </button>
          </div>
        </footer>
      </div>
    </div>
  )
};

const AppWithAuth: React.FC = () => {
  const [authUser, setAuthUser] = useState<{ email: string; user_metadata?: { full_name?: string } } | null>(null);
  return (
    <AuthProvider onUserChange={setAuthUser}>
      <App authUser={authUser} />
    </AuthProvider>
  );
};

export default AppWithAuth;
