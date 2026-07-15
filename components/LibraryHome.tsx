import React, { useState, useRef, useEffect } from 'react';
import {
  Plus, MoreHorizontal, Globe, Download, Copy, Trash2, Edit,
  FolderOpen, HardDrive, Upload, FileText, EyeOff, BookOpen,
} from 'lucide-react';
import { LibraryMeta } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import * as libraryService from '../services/libraryService';

interface LibraryMetadata {
  filename: string;
  name: string;
  location: string;
  language: string;
  items: number;
  credits?: string;
}

interface LibraryHomeProps {
  libraries: LibraryMeta[];
  templates: LibraryMetadata[];
  sort: 'recientes' | 'alfabetico';
  onSortChange: (s: 'recientes' | 'alfabetico') => void;
  storageUsed: number;
  storageQuota: number;
  activeLibraryId?: string;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDownload: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
  onImportPhrases: () => void;
  onBackup: () => void;
  onOpenTemplate: (filename: string) => void;
  /** Hide an example template card on this device (localStorage). */
  onHideTemplate: (filename: string) => void;
  /** How many example templates are currently hidden (for the restore link). */
  hiddenTemplateCount: number;
  /** Unhide all example templates. */
  onRestoreTemplates: () => void;
}

// ── helpers ────────────────────────────────────────────────────────────────────

function relativeDate(iso: string, t: (k: string, v?: Record<string, string | number>) => string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return t('sequence.today');
  if (days === 1) return t('sequence.yesterday');
  if (days < 7) return t('sequence.daysAgo', { days });
  if (days < 30) return t('sequence.weeksAgo', { weeks: Math.floor(days / 7) });
  return t('sequence.monthsAgo', { months: Math.floor(days / 30) });
}

function formatBytes(n: number): string {
  return n > 1e9 ? `${(n / 1e9).toFixed(1)} GB` : `${Math.round(n / 1e6)} MB`;
}

// ── ThumbnailStrip ─────────────────────────────────────────────────────────────
// NOTE: overflow-hidden lives here (not on the card root) so the card's
// dropdown menu is not clipped by an ancestor overflow context.

interface ThumbnailImage {
  src: string;
  srcSet?: string;
}

function ThumbnailStrip({ images }: { images: ThumbnailImage[] }) {
  const slots = [0, 1, 2].map(i => images[i] ?? null);
  return (
    <div className="flex aspect-[3/1] bg-slate-100 rounded-t-xl overflow-hidden shrink-0">
      {slots.map((img, i) =>
        img ? (
          // bg-white so pictograms on transparent/white backgrounds render cleanly.
          // object-contain prevents cropping (pictograms must not be clipped).
          <div key={i} className="w-1/3 h-full bg-white">
            {img.srcSet ? (
              <picture className="w-full h-full block">
                <source srcSet={img.srcSet} type="image/webp" />
                <img src={img.src} alt="" className="w-full h-full object-contain" loading="lazy" width={300} height={300} />
              </picture>
            ) : (
              <img src={img.src} alt="" className="w-full h-full object-contain" loading="lazy" width={300} height={300} />
            )}
          </div>
        ) : (
          <div key={i} className="w-1/3 h-full bg-slate-100" />
        )
      )}
    </div>
  );
}

// ── LibraryCard ────────────────────────────────────────────────────────────────

interface LibraryCardProps {
  lib: LibraryMeta;
  isActive?: boolean;
  onOpen: (id: string) => void;
  onDuplicate: (id: string) => void;
  onDownload: (id: string) => void;
  onRename: (id: string, newName: string) => void;
  onDelete: (id: string) => void;
}

function LibraryCard({ lib, isActive, onOpen, onDuplicate, onDownload, onRename, onDelete }: LibraryCardProps) {
  const { t } = useTranslation();
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState(lib.name);
  const [menuOpen, setMenuOpen] = useState(false);
  const [previews, setPreviews] = useState<string[]>([]);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPreviews(libraryService.getLibraryPreviews(lib.id));
  }, [lib.id, lib.modifiedAt]);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  const commitRename = () => {
    const name = editName.trim();
    if (name && name !== lib.name) onRename(lib.id, name);
    setIsEditing(false);
  };

  const thumbnailImages: ThumbnailImage[] = previews.map(src => ({ src }));

  const menuItems = [
    { label: t('actions.openLibrary'),      icon: <FolderOpen size={12} />, action: () => { onOpen(lib.id); setMenuOpen(false); } },
    { label: t('actions.duplicateLibrary'), icon: <Copy size={12} />,       action: () => { onDuplicate(lib.id); setMenuOpen(false); } },
    { label: t('actions.downloadLibrary'),  icon: <Download size={12} />,   action: () => { onDownload(lib.id); setMenuOpen(false); } },
    { label: t('actions.renameLibrary'),    icon: <Edit size={12} />,       action: () => { setIsEditing(true); setEditName(lib.name); setMenuOpen(false); } },
  ];

  return (
    // No overflow-hidden here — the dropdown menu must escape the card bounds.
    // The ThumbnailStrip handles its own rounded-t-xl overflow clipping.
    <div
      className={`relative bg-white rounded-xl border border-slate-200 transition-all duration-300 ease-out flex flex-col group cursor-pointer ${
        isActive
          ? 'scale-[1.05] -translate-y-2 shadow-[0_28px_50px_-12px_rgba(76,8,119,0.45)] z-20'
          : 'hover:-translate-y-1 hover:shadow-xl hover:z-10'
      }`}
      onClick={() => !menuOpen && !isEditing && onOpen(lib.id)}
    >
      <ThumbnailStrip images={thumbnailImages} />

      <div className="p-4 flex flex-col gap-1.5 flex-1">
        {/* Name + menu row */}
        <div className="flex items-start justify-between gap-2" onClick={e => e.stopPropagation()}>
          {isEditing ? (
            <input
              value={editName}
              onChange={e => setEditName(e.target.value)}
              onBlur={commitRename}
              onKeyDown={e => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') { setEditName(lib.name); setIsEditing(false); }
              }}
              className="font-bold text-sm text-slate-900 bg-transparent border-b border-violet-400 outline-none flex-1 min-w-0"
              autoFocus
            />
          ) : (
            <h3
              className="font-bold text-sm text-slate-900 leading-tight flex-1 min-w-0 truncate flex items-center gap-1.5"
              onDoubleClick={() => { setIsEditing(true); setEditName(lib.name); }}
              title={lib.name}
            >
              {isActive && (
                <span className="w-1.5 h-1.5 rounded-full bg-orange-400 shrink-0" aria-label={t('home.activeLibrary')} />
              )}
              <span className="truncate">{lib.name}</span>
            </h3>
          )}
          {lib.language && !isEditing && (
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0 leading-tight">
              {lib.language}
            </span>
          )}

          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              aria-label={t('actions.options')}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[160px] py-1">
                {menuItems.map(item => (
                  <button
                    key={item.label}
                    onClick={e => { e.stopPropagation(); item.action(); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                  >
                    {item.icon}{item.label}
                  </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                  <button
                    onClick={e => { e.stopPropagation(); onDelete(lib.id); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left"
                  >
                    <Trash2 size={12} />{t('actions.deleteLibrary')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        <p className="text-xs text-slate-400">
          {t('home.libraryItemCount', { pictograms: lib.pictogramCount, sequences: lib.sequenceCount })}
        </p>
        <p className="text-xs text-slate-400 mt-auto">{relativeDate(lib.modifiedAt, t)}</p>
      </div>
    </div>
  );
}

// ── TemplateCard ───────────────────────────────────────────────────────────────
// Visually identical structure to LibraryCard: strip → name+badge+menu → count → footer.

function TemplateCard({ tmpl, onOpen, onHide }: { tmpl: LibraryMetadata; onOpen: () => void; onHide: () => void }) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const slug = tmpl.filename.replace(/(_graph.*)?\.json$/, '');
  const images: ThumbnailImage[] = [0, 1, 2].map(i => ({
    src: `/libraries/thumbs/${slug}_${i}.jpg`,
    srcSet: `/libraries/thumbs-opt/${slug}_${i}.webp`,
  }));

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [menuOpen]);

  return (
    <div
      onClick={() => !menuOpen && onOpen()}
      className="bg-white border border-slate-200 rounded-xl transition-all duration-300 ease-out hover:-translate-y-1 hover:shadow-xl hover:z-10 flex flex-col group cursor-pointer"
    >
      <ThumbnailStrip images={images} />

      <div className="p-4 flex flex-col gap-1.5 flex-1">
        {/* Name + language badge + menu row — mirrors LibraryCard */}
        <div className="flex items-start justify-between gap-2" onClick={e => e.stopPropagation()}>
          <h3
            className="font-bold text-sm text-slate-900 leading-tight flex-1 min-w-0 truncate"
            title={tmpl.name}
          >
            {tmpl.name}
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-100 px-1.5 py-0.5 rounded shrink-0 leading-tight">
            {tmpl.language}
          </span>
          <div className="relative" ref={menuRef}>
            <button
              onClick={e => { e.stopPropagation(); setMenuOpen(m => !m); }}
              className="p-1 text-slate-400 hover:text-slate-700 rounded transition-colors"
              aria-label={t('actions.options')}
            >
              <MoreHorizontal size={14} />
            </button>
            {menuOpen && (
              <div className="absolute right-0 top-7 z-30 bg-white border border-slate-200 rounded-lg shadow-lg min-w-[160px] py-1">
                <button
                  onClick={e => { e.stopPropagation(); onOpen(); setMenuOpen(false); }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-slate-700 hover:bg-slate-50 text-left"
                >
                  <FolderOpen size={12} />{t('actions.openLibrary')}
                </button>
                <div className="border-t border-slate-100 mt-1 pt-1">
                  {/* Example templates ship with the deploy: they cannot be
                      deleted, but they can be hidden per device. */}
                  <button
                    onClick={e => { e.stopPropagation(); onHide(); setMenuOpen(false); }}
                    className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-600 hover:bg-red-50 text-left"
                  >
                    <EyeOff size={12} />{t('actions.hideTemplate')}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Item count — unified with LibraryCard */}
        <p className="text-xs text-slate-400">
          {t('home.libraryItemCount', { pictograms: tmpl.items, sequences: 0 })}
        </p>

        {/* Footer — location */}
        <p className="text-xs text-slate-400 mt-auto flex items-center gap-1 min-w-0">
          <Globe size={10} className="shrink-0" />
          <span className="truncate">{tmpl.location}</span>
        </p>
      </div>
    </div>
  );
}

// ── PictosMark ─────────────────────────────────────────────────────────────────
// White-on-dark rendering of the pictos isotype (the "p" with the eye). The eye
// aperture is filled with the card background (violet-950) so it reads as a hole
// cut out of the white "p"; the pupil is white.

function PictosMark({ size = 44 }: { size?: number }) {
  return (
    <svg viewBox="0 0 45.9 45.9" width={size} height={size} aria-hidden="true" className="shrink-0">
      <path
        fill="#ffffff"
        d="m 23.091677,5.4233045 c -9.4,0 -17.1,6.2999995 -17.1,14.0999995 0,7.8 0,0 0,0 v 0 17.7 c 0,2.1 1.7,3.9 3.9,3.9 h 1.6 c 2.1,0 3.9,-1.7 3.9,-3.9 v -5.3 c 2.3,1 4.9,1.5 7.7,1.5 9.4,0 17.1,-6.3 17.1,-14.1 0,-7.8 -7.7,-13.8999995 -17.1,-13.8999995 z m 0.3,20.4999995 c -6.4,0 -9.2,-6.4 -9.2,-6.4 0,0 2.8,-6.4 9.2,-6.4 6.4,0 9.2,6.4 9.2,6.4 0,0 -2.8,6.4 -9.2,6.4 z"
      />
      <path
        fill="#2e1065"
        d="m 23.410324,13.143028 c -6.4,0 -9.199219,6.40039 -9.199219,6.40039 0,1e-6 2.799219,6.400391 9.199219,6.400391 6.4,0 9.199219,-6.400391 9.199219,-6.400391 0,1e-6 -2.799219,-6.40039 -9.199219,-6.40039 z"
      />
      <circle fill="#ffffff" cx="23.391676" cy="19.223303" r="3.1" />
    </svg>
  );
}

// ── HomeActionsCard ────────────────────────────────────────────────────────────
// First grid cell: the pictos mark plus the home-level library actions
// (import phrases, import library, back up). Replaces the separate logo card and
// the old bottom action bar.

function HomeActionsCard({
  onImport,
  onImportPhrases,
  onBackup,
}: {
  onImport: () => void;
  onImportPhrases: () => void;
  onBackup: () => void;
}) {
  const { t } = useTranslation();
  const actions = [
    { icon: <FileText size={13} />, label: t('home.importPhrases'), onClick: onImportPhrases },
    { icon: <Upload size={13} />, label: t('home.importLibraryFile'), onClick: onImport },
    { icon: <Download size={13} />, label: t('actions.backupLibraries'), onClick: onBackup },
  ];
  return (
    // Compact action list: the card must not outgrow the row and stretch its
    // sibling cards, so the actions stay xs-sized and tightly packed.
    <div className="bg-violet-950 rounded-xl p-5 flex flex-col gap-3 min-h-[160px] shadow-xl">
      <PictosMark size={40} />
      <div className="flex flex-col gap-0.5">
        {actions.map(a => (
          <button
            key={a.label}
            onClick={a.onClick}
            className="flex items-center gap-2 py-0.5 text-xs font-medium text-violet-200 hover:text-white transition-colors text-left"
          >
            <span className="shrink-0">{a.icon}</span>
            <span className="truncate">{a.label}</span>
          </button>
        ))}
        <a
          href="/tutorial.pdf"
          target="_blank"
          rel="noopener"
          className="flex items-center gap-2 py-0.5 text-xs font-medium text-violet-200 hover:text-white transition-colors text-left"
        >
          <span className="shrink-0"><BookOpen size={13} /></span>
          <span className="truncate">{t('home.tutorialPdf')}</span>
        </a>
      </div>
    </div>
  );
}

// ── CreateLibraryCard ──────────────────────────────────────────────────────────

function CreateLibraryCard({ onCreate }: { onCreate: () => void }) {
  const { t } = useTranslation();
  return (
    <div
      onClick={onCreate}
      className="border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center gap-2 cursor-pointer hover:border-violet-400 hover:bg-violet-50 hover:-translate-y-1 hover:shadow-lg transition-all duration-300 ease-out min-h-[160px] group"
    >
      <Plus size={20} className="text-slate-300 group-hover:text-violet-500 transition-colors" />
      <span className="text-xs font-semibold text-slate-400 group-hover:text-violet-600 transition-colors text-center px-4">
        {t('actions.createLibrary')}
      </span>
    </div>
  );
}

// ── LibraryHome ────────────────────────────────────────────────────────────────

export function LibraryHome({
  libraries,
  templates,
  sort,
  onSortChange,
  storageUsed,
  storageQuota,
  activeLibraryId,
  onOpen,
  onCreate,
  onDuplicate,
  onDownload,
  onRename,
  onDelete,
  onImport,
  onImportPhrases,
  onBackup,
  onOpenTemplate,
  onHideTemplate,
  hiddenTemplateCount,
  onRestoreTemplates,
}: LibraryHomeProps) {
  const { t } = useTranslation();

  const sortedLibraries = sort === 'alfabetico'
    ? [...libraries].sort((a, b) => a.name.localeCompare(b.name))
    : [...libraries].sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime());

  const isStorageHigh = storageQuota > 0 && storageUsed / storageQuota > 0.8;

  // Community sort is independent of the workspace sort: each section header
  // carries its own control. 'recientes' keeps the stock (curation) order.
  const [templateSort, setTemplateSort] = useState<'recientes' | 'alfabetico'>('recientes');
  const [templateSearch, setTemplateSearch] = useState('');
  const sortedTemplates = (() => {
    const base = templateSort === 'alfabetico'
      ? [...templates].sort((a, b) => a.name.localeCompare(b.name))
      : templates;
    if (!templateSearch.trim()) return base;
    const q = templateSearch.toLowerCase();
    return base.filter(t =>
      (t.name ?? '').toLowerCase().includes(q) ||
      (t.location ?? '').toLowerCase().includes(q) ||
      (t.language ?? '').toLowerCase().includes(q) ||
      (t.credits ?? '').toLowerCase().includes(q)
    );
  })();

  return (
    <div id="library-home" className="py-12 space-y-10 animate-in fade-in zoom-in-95 duration-700">

      {/* ── Own zone: pictos actions + create + the user's libraries.
             Opening a community template always forks an own copy here, so the
             'current' library always lives in this section. ── */}
      <section aria-labelledby="workspace-title">
        <div id="library-home-toolbar" className="flex items-center justify-between mb-5">
          <h2 id="workspace-title" className="text-xs font-semibold uppercase tracking-wider text-slate-900">
            {t('home.workspaceSection')}
          </h2>
          <div className="flex items-center gap-3">
            <button
              onClick={() => onSortChange('recientes')}
              className={`text-xs uppercase tracking-wider transition-colors ${sort === 'recientes' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t('library.recent')}
            </button>
            <button
              onClick={() => onSortChange('alfabetico')}
              className={`text-xs uppercase tracking-wider transition-colors ${sort === 'alfabetico' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t('library.alphabetical')}
            </button>
          </div>
        </div>
        <div id="library-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          <HomeActionsCard onImport={onImport} onImportPhrases={onImportPhrases} onBackup={onBackup} />
          <CreateLibraryCard onCreate={onCreate} />
          {sortedLibraries.map(lib => (
            <LibraryCard
              key={lib.id}
              lib={lib}
              isActive={lib.id === activeLibraryId}
              onOpen={onOpen}
              onDuplicate={onDuplicate}
              onDownload={onDownload}
              onRename={onRename}
              onDelete={onDelete}
            />
          ))}
        </div>
      </section>

      {/* ── Community zone: the stock templates shipped with the app ── */}
      <section aria-labelledby="community-title">
        <div className="flex items-center gap-4 mb-5">
          <h2 id="community-title" className="text-xs font-semibold uppercase tracking-wider text-slate-900 shrink-0">
            {t('home.communitySection')}
          </h2>
          <div className="flex-1 flex justify-center">
            <input
              type="search"
              value={templateSearch}
              onChange={e => setTemplateSearch(e.target.value)}
              placeholder={t('home.communitySearchPlaceholder')}
              className="w-full max-w-xs text-xs border border-slate-200 rounded px-2.5 py-1.5 bg-slate-50 focus:bg-white focus:outline-none focus:border-slate-400 transition-colors"
            />
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {hiddenTemplateCount > 0 && (
              <button
                onClick={onRestoreTemplates}
                className="text-xs text-slate-400 hover:text-violet-700 transition-colors"
              >
                {t('home.showHiddenTemplates', { count: hiddenTemplateCount })}
              </button>
            )}
            <button
              onClick={() => setTemplateSort('recientes')}
              className={`text-xs uppercase tracking-wider transition-colors ${templateSort === 'recientes' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t('library.recent')}
            </button>
            <button
              onClick={() => setTemplateSort('alfabetico')}
              className={`text-xs uppercase tracking-wider transition-colors ${templateSort === 'alfabetico' ? 'text-slate-900 font-semibold' : 'text-slate-400 hover:text-slate-600'}`}
            >
              {t('library.alphabetical')}
            </button>
          </div>
        </div>
        <div id="community-grid" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {sortedTemplates.map(tmpl => (
            <TemplateCard
              key={tmpl.filename}
              tmpl={tmpl}
              onOpen={() => onOpenTemplate(tmpl.filename)}
              onHide={() => onHideTemplate(tmpl.filename)}
            />
          ))}
        </div>
      </section>

      {/* Bottom bar: storage indicator (import/backup actions live in the actions card) */}
      <div className="flex items-center justify-between gap-4 pt-4 border-t border-slate-100">
        <div className="flex items-center gap-1.5">
          <HardDrive size={12} className={isStorageHigh ? 'text-amber-500' : 'text-slate-400'} />
          {storageQuota > 0 && (
            <span className={`text-xs ${isStorageHigh ? 'text-amber-600 font-semibold' : 'text-slate-400'}`}>
              {t(isStorageHigh ? 'library.storageIndicatorHigh' : 'library.storageIndicator', {
                used: formatBytes(storageUsed),
                total: formatBytes(storageQuota),
              })}
            </span>
          )}
        </div>
      </div>

    </div>
  );
}
