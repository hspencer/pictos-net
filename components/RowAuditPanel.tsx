import React, { useState, useMemo } from 'react';
import ReactDOM from 'react-dom';
import { X, Copy, Trash2, Save } from 'lucide-react';
import { RowInterventionLog } from '../types';
import { useTranslation } from '../hooks/useTranslation';
import { useDialogA11y } from '../hooks/useDialogA11y';
import { sentenceCase } from '../utils/textFormat';

interface Props {
  isOpen: boolean;
  log: RowInterventionLog | undefined;
  utterance: string;
  onClose: () => void;
  onReplace: (log: RowInterventionLog) => void;
  onClear: () => void;
  onLog: (type: 'info' | 'error' | 'success', message: string) => void;
}

export const RowAuditPanel: React.FC<Props> = ({ isOpen, log, utterance, onClose, onReplace, onClear, onLog }) => {
  const { t } = useTranslation();
  const empty: RowInterventionLog = useMemo(() => ({ sessions: [] }), []);
  const initialText = useMemo(
    () => JSON.stringify(log ?? empty, null, 2),
    [log, empty]
  );
  const [text, setText] = useState(initialText);
  const [parseError, setParseError] = useState<string | null>(null);
  const [confirmingClear, setConfirmingClear] = useState(false);

  const { dialogProps } = useDialogA11y({ isOpen, onClose, label: t('audit.title') });

  React.useEffect(() => {
    if (isOpen) {
      setText(initialText);
      setParseError(null);
      setConfirmingClear(false);
    }
  }, [isOpen, initialText]);

  if (!isOpen) return null;

  const sessionCount = log?.sessions.length ?? 0;
  const eventCount = log?.sessions.reduce((sum, s) => sum + s.events.length, 0) ?? 0;
  const isEmpty = sessionCount === 0;
  const isDirty = text !== initialText;

  const handleCopy = () => {
    const textToCopy = isDirty ? text : initialText;
    navigator.clipboard.writeText(textToCopy)
      .then(() => onLog('success', t('audit.copySuccess', { utterance })))
      .catch((err: Error) => onLog('error', t('audit.copyError', { error: err.message })));
  };

  const handleSave = () => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setParseError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (!parsed || typeof parsed !== 'object' || !Array.isArray((parsed as RowInterventionLog).sessions)) {
      setParseError(t('audit.invalidShape'));
      return;
    }
    setParseError(null);
    onReplace(parsed as RowInterventionLog);
    onLog('success', t('audit.saveSuccess', { utterance }));
    onClose();
  };

  const handleClearConfirm = () => {
    onClear();
    onLog('info', t('audit.clearedSuccess', { utterance }));
    setConfirmingClear(false);
    onClose();
  };

  return ReactDOM.createPortal(
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[60] animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div
        {...dialogProps}
        className="bg-white rounded-lg shadow-2xl max-w-3xl w-full mx-4 max-h-[85vh] flex flex-col animate-in zoom-in-95 duration-200"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 border-b border-slate-200 flex items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-bold text-slate-900">{t('audit.title')}</h3>
            <p className="text-xs text-slate-500 mt-1 tracking-widest">{sentenceCase(utterance)}</p>
            <p className="text-xs text-slate-600 mt-2">
              {isEmpty
                ? t('audit.emptyDescription')
                : t('audit.summary', { sessions: String(sessionCount), events: String(eventCount) })
              }
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-700 transition-colors"
            aria-label={t('actions.close')}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col p-6 gap-3">
          <label className="text-xs font-medium uppercase text-slate-500 tracking-widest">
            {t('audit.jsonLabel')}
          </label>
          <textarea
            value={text}
            onChange={e => { setText(e.target.value); setParseError(null); }}
            spellCheck={false}
            className="flex-1 w-full min-h-[300px] border border-slate-200 rounded p-3 text-xs font-mono text-slate-800 bg-slate-50 outline-none focus:ring-2 focus:ring-violet-500 resize-none leading-relaxed"
          />
          {parseError && (
            <p className="text-xs text-rose-600">{t('audit.parseError', { error: parseError })}</p>
          )}
          <p className="text-xs text-slate-500">{t('audit.editingHint')}</p>
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex justify-between items-center gap-2 bg-slate-50">
          {confirmingClear ? (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-rose-700 font-medium">{t('audit.clearConfirmPrompt')}</span>
              <button
                onClick={handleClearConfirm}
                className="px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium uppercase tracking-widest transition-colors"
              >
                {t('audit.clearConfirm')}
              </button>
              <button
                onClick={() => setConfirmingClear(false)}
                className="px-3 py-1.5 border border-slate-300 hover:border-slate-500 text-slate-700 text-xs font-medium uppercase tracking-widest transition-colors"
              >
                {t('actions.cancel')}
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmingClear(true)}
              disabled={isEmpty}
              className="flex items-center gap-2 px-3 py-2 border border-slate-200 hover:border-rose-600 text-slate-500 hover:text-rose-600 transition-all disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium uppercase tracking-widest"
              title={t('audit.clearTooltip')}
            >
              <Trash2 size={14} />
              {t('audit.clear')}
            </button>
          )}
          <div className="flex gap-2">
            <button
              onClick={handleCopy}
              className="flex items-center gap-2 px-3 py-2 border border-slate-200 hover:border-violet-950 text-slate-500 hover:text-violet-950 transition-all text-xs font-medium uppercase tracking-widest"
              title={t('audit.copyTooltip')}
            >
              <Copy size={14} />
              {t('audit.copy')}
            </button>
            <button
              onClick={handleSave}
              disabled={!isDirty}
              className="flex items-center gap-2 px-3 py-2 bg-violet-950 hover:bg-black text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed text-xs font-medium uppercase tracking-widest"
              title={t('audit.saveTooltip')}
            >
              <Save size={14} />
              {t('audit.save')}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
};
