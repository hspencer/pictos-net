import React, { useState, useEffect } from 'react';
import { INITIAL_STYLES } from './constants';
import { INITIAL_KEYFRAMES } from './keyframeConstants';
import { StyleDefinition, KeyframeDefinition, ViewMode, ShapeType } from './types';
import { updateDynamicStyles, generateCssString } from './utils/cssGenerator';
import StylePreviewCard from './components/StylePreviewCard';
import EditModal from './components/EditModal';
import KeyframeEditor from './components/KeyframeEditor';
import { Plus, Code, Grid, Download, Square, Circle, Triangle, Slash, Activity, Film, Heart } from 'lucide-react';

export interface StyleEditorProps {
  /** Initial styles to load. Defaults to INITIAL_STYLES */
  initialStyles?: StyleDefinition[];
  /** Initial keyframes to load. Defaults to INITIAL_KEYFRAMES */
  initialKeyframes?: KeyframeDefinition[];
  /** Callback when styles change */
  onStylesChange?: (styles: StyleDefinition[]) => void;
  /** Callback when keyframes change */
  onKeyframesChange?: (keyframes: KeyframeDefinition[]) => void;
  /** Hide the header/navbar */
  hideHeader?: boolean;
  /** Hide the export button */
  hideExport?: boolean;
  /** Hide the new style button */
  hideNewButton?: boolean;
  /** Default view mode */
  defaultView?: ViewMode;
  /** Custom shapes to display */
  availableShapes?: ShapeType[];
  /** Callback when a style is saved */
  onSave?: (style: StyleDefinition) => void;
  /** Callback when a style is deleted */
  onDelete?: (id: string) => void;
  /** Callback when CSS is exported */
  onExport?: (css: string) => void;
  /** Custom className for the container */
  className?: string;
  /** Shape controlled externally (used when hideHeader=true) */
  externalShape?: ShapeType;
  /** Callback when the internal shape selector changes */
  onShapeChange?: (shape: ShapeType) => void;
  /** Why a style may not be deleted (e.g. it is in use), or null when it may. */
  deleteBlockedReason?: (style: StyleDefinition) => string | null;
}

export const StyleEditor: React.FC<StyleEditorProps> = ({
  initialStyles = INITIAL_STYLES,
  initialKeyframes = INITIAL_KEYFRAMES,
  onStylesChange,
  onKeyframesChange,
  hideHeader = false,
  hideExport = false,
  hideNewButton = false,
  defaultView = ViewMode.GRID,
  availableShapes = ['square', 'circle', 'triangle', 'line', 'path', 'heart'],
  onSave,
  onDelete,
  onExport,
  className = '',
  externalShape,
  onShapeChange,
  deleteBlockedReason,
}) => {
  const [styles, setStyles] = useState<StyleDefinition[]>(initialStyles);
  const [keyframes, setKeyframes] = useState<KeyframeDefinition[]>(initialKeyframes);
  const [viewMode, setViewMode] = useState<ViewMode>(defaultView);
  const [currentShape, setCurrentShape] = useState<ShapeType>(availableShapes[0] || 'square');

  const effectiveShape: ShapeType = externalShape ?? currentShape;

  const handleShapeChange = (shape: ShapeType) => {
    setCurrentShape(shape);
    onShapeChange?.(shape);
  };

  // Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [currentEditingStyle, setCurrentEditingStyle] = useState<StyleDefinition | null>(null);

  // Initialize CSS in DOM
  useEffect(() => {
    updateDynamicStyles(styles, keyframes);
  }, [styles, keyframes]);

  // Notify parent when styles change
  // NOTE: onStylesChange intentionally omitted from deps — it's an event handler
  // whose reference changes every parent render. Including it causes an infinite
  // render loop: new ref → effect fires → onUpdateConfig({...config}) → re-render.
  useEffect(() => {
    onStylesChange?.(styles);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [styles]);

  // Notify parent when keyframes change
  useEffect(() => {
    onKeyframesChange?.(keyframes);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyframes]);

  const handleEditClick = (style: StyleDefinition) => {
    setCurrentEditingStyle(style);
    setIsModalOpen(true);
  };

  const handleCreateNew = () => {
    setCurrentEditingStyle(null);
    setIsModalOpen(true);
  };

  const classifyStyle = (style: StyleDefinition): 'color' | 'stroke' | 'animation' => {
    if (style.rules.some(r => r.property === 'animation')) return 'animation';
    if (
      style.selectors.some(s => s.startsWith('.st-')) ||
      ['.dashed', '.dotted', '.flat', '.glow', '.glow-warm', '.glow-red'].some(s => style.selectors.includes(s)) ||
      style.rules.some(r => ['stroke-dasharray', 'stroke-linecap'].includes(r.property))
    ) return 'stroke';
    return 'color';
  };

  const handleSaveStyle = (updatedStyle: StyleDefinition) => {
    setStyles(prev => {
      const exists = prev.find(s => s.id === updatedStyle.id);
      if (exists) {
        return prev.map(s => s.id === updatedStyle.id ? updatedStyle : s);
      }
      const type = classifyStyle(updatedStyle);
      let insertIdx: number;
      if (type === 'animation') {
        insertIdx = prev.findIndex(s => classifyStyle(s) === 'animation');
        if (insertIdx === -1) insertIdx = prev.length;
      } else if (type === 'stroke') {
        insertIdx = prev.findIndex(s => classifyStyle(s) === 'stroke');
        if (insertIdx === -1) {
          insertIdx = prev.findIndex(s => classifyStyle(s) === 'animation');
          if (insertIdx === -1) insertIdx = prev.length;
        }
      } else {
        insertIdx = 0;
      }
      const next = [...prev];
      next.splice(insertIdx, 0, updatedStyle);
      return next;
    });
    onSave?.(updatedStyle);
  };

  const handleDeleteStyle = (id: string) => {
    if (confirm('Are you sure you want to delete this style?')) {
      setStyles(prev => prev.filter(s => s.id !== id));
      onDelete?.(id);
    }
  };

  const handleDownloadCss = () => {
    const css = generateCssString(styles, keyframes);

    if (onExport) {
      onExport(css);
    } else {
      const blob = new Blob([css], { type: 'text/css' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'svg-styles.css';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }
  };

  const shapeIcons: Record<ShapeType, React.ComponentType<{ size?: number }>> = {
    square: Square,
    circle: Circle,
    triangle: Triangle,
    line: Slash,
    path: Activity,
    heart: Heart,
  };

  return (
    <div id="style-editor-root" className={`flex flex-col h-full bg-gray-50 text-gray-900 ${className}`}>

      {/* Navbar */}
      {!hideHeader && (
        <header id="style-editor-toolbar" className="flex-none bg-white border-b border-gray-200 px-6 py-4 flex flex-col md:flex-row md:items-center justify-between gap-4 sticky top-0 z-20">
          <div className="flex items-center gap-3">
            <div className="flex">
              <h1 className="text-xl font-bold tracking-tight text-gray-900 leading-tight">Style Editor</h1>
              {/* <span className="text-xs text-gray-500 font-medium tracking-wide">PICTOS.net by mediafranca</span> */}
            </div>
          </div>

          <div className="flex items-center gap-4 flex-wrap">

            {/* Shape Selector - Only visible in GRID mode */}
            {viewMode === ViewMode.GRID && (
              <>
                <div className="flex bg-gray-100 p-1 rounded-lg items-center">
                  {availableShapes.map((shapeType: ShapeType) => {
                    const Icon = shapeIcons[shapeType];
                    return (
                      <button
                        key={shapeType}
                        onClick={() => handleShapeChange(shapeType)}
                        className={`p-2 rounded-md transition-all ${effectiveShape === shapeType ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                        title={`View as ${shapeType}`}
                      >
                        <Icon size={18} />
                      </button>
                    );
                  })}
                </div>

                <div className="w-px h-6 bg-gray-200 hidden md:block" />
              </>
            )}

            {/* View Mode */}
            <div className="flex bg-gray-100 p-1 rounded-lg">
              <button
                onClick={() => setViewMode(ViewMode.GRID)}
                className={`p-2 rounded-md transition-all ${viewMode === ViewMode.GRID ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="Grid View"
              >
                <Grid size={18} />
              </button>
              <button
                onClick={() => setViewMode(ViewMode.CODE)}
                className={`p-2 rounded-md transition-all ${viewMode === ViewMode.CODE ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="Code View"
              >
                <Code size={18} />
              </button>
              <button
                onClick={() => setViewMode(ViewMode.ANIMATIONS)}
                className={`p-2 rounded-md transition-all ${viewMode === ViewMode.ANIMATIONS ? 'bg-white shadow text-blue-600' : 'text-gray-500 hover:text-gray-700'}`}
                title="Animations"
              >
                <Film size={18} />
              </button>
            </div>

            {!hideExport && (
              <button
                onClick={handleDownloadCss}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200"
              >
                <Download size={16} aria-hidden="true" /> <span className="hidden sm:inline">Export CSS</span>
              </button>
            )}

            {!hideNewButton && viewMode === ViewMode.GRID && (
              <button
                onClick={handleCreateNew}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-gray-900 text-white hover:bg-gray-800 rounded-lg transition-all shadow-md hover:shadow-lg"
              >
                <Plus size={16} aria-hidden="true" /> <span className="hidden sm:inline">New Style</span>
              </button>
            )}
          </div>
        </header>
      )}

      {/* Content Area */}
      <main id="style-editor-content" className="flex-1 overflow-y-auto p-4">

        {viewMode === ViewMode.GRID && (
          <div id="style-editor-gallery" className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(7.5em, 1fr))' }}>
            {/* Add New - always first */}
            {!hideNewButton && (
              <button
                onClick={handleCreateNew}
                className="group bg-slate-100 rounded-lg aspect-square flex flex-col items-center justify-center gap-1 cursor-pointer select-none border-2 border-dashed border-slate-300 hover:border-violet-400 hover:bg-violet-50 transition-colors"
              >
                <Plus size={20} className="text-slate-500 group-hover:text-violet-500 transition-colors" />
                <span className="text-xs font-mono text-slate-500 group-hover:text-violet-500 transition-colors">nuevo</span>
              </button>
            )}
            {styles.map(style => (
              <div key={style.id} className="bg-slate-100 rounded-lg p-1.5">
                <StylePreviewCard
                  styleDef={style}
                  shape={effectiveShape}
                  onClick={() => handleEditClick(style)}
                />
              </div>
            ))}
          </div>
        )}

        {viewMode === ViewMode.CODE && (
          <div id="style-editor-code-view" className="max-w-4xl mx-auto">
            <div className="bg-gray-900 rounded-xl overflow-hidden shadow-2xl">
              <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
                <span className="text-xs font-mono text-gray-500">generated-styles.css</span>
                <button
                  onClick={() => navigator.clipboard.writeText(generateCssString(styles, keyframes))}
                  className="text-xs text-blue-400 hover:text-blue-300 font-medium"
                >
                  Copy to Clipboard
                </button>
              </div>
              <pre className="p-6 text-sm font-mono text-gray-300 overflow-x-auto">
                {generateCssString(styles, keyframes)}
              </pre>
            </div>
          </div>
        )}

        {viewMode === ViewMode.ANIMATIONS && (
          <div id="style-editor-animations-view">
            <KeyframeEditor
              keyframes={keyframes}
              onUpdate={setKeyframes}
            />
          </div>
        )}
      </main>

      {/* Editor Modal */}
      <EditModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        styleDef={currentEditingStyle}
        onSave={handleSaveStyle}
        onDelete={handleDeleteStyle}
        canDelete={(currentEditingStyle && deleteBlockedReason?.(currentEditingStyle)) || true}
        currentShape={effectiveShape}
        keyframes={keyframes}
      />
    </div>
  );
};

export default StyleEditor;
