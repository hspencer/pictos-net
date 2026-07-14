/**
 * Phase5ReviewPanel — Timed interactive review step for ESTRUCTURAR (recording mode).
 *
 * Displays the StructuringMapping returned by the vision model as a hierarchical tree.
 * A countdown timer gives the user time to read through the list thrice before
 * auto-confirming. Labels are editable; nodes can be deselected.
 *
 * Spec: visual-reasoning.allium § Phase5_Review
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import type { StructuringMapping, StructuringGroup } from '../types';
import { useTranslation } from '../hooks/useTranslation';

// ── Timer calculation ─────────────────────────────────────────────────────────

const READING_WPM = 200;
const REVIEW_MIN_MS = 10_000;
const REVIEW_MAX_MS = 90_000;

function computeTimerMs(mapping: StructuringMapping): number {
    const words = mapping.groups.reduce((acc, g) => {
        const labelWords = g.label.trim().split(/\s+/).length;
        const idWords = g.nodeId.split(/[_-]/).length;
        return acc + labelWords + idWords;
    }, 0);
    const raw = (words / READING_WPM) * 60 * 3 * 1000;
    return Math.max(REVIEW_MIN_MS, Math.min(REVIEW_MAX_MS, raw));
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Phase5ReviewPanelProps {
    mapping: StructuringMapping;
    onConfirm: (
        selectionOverrides: Map<string, boolean>,
        labelOverrides: Map<string, string>,
    ) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function Phase5ReviewPanel({ mapping, onConfirm }: Phase5ReviewPanelProps) {
    const { t } = useTranslation();
    const timerMs = useRef(computeTimerMs(mapping));
    const [remaining, setRemaining] = useState(timerMs.current);
    const [selections, setSelections] = useState<Map<string, boolean>>(() => {
        const m = new Map<string, boolean>();
        mapping.groups.forEach(g => m.set(g.nodeId, true));
        return m;
    });
    const [labels, setLabels] = useState<Map<string, string>>(() => {
        const m = new Map<string, string>();
        mapping.groups.forEach(g => m.set(g.nodeId, g.label));
        return m;
    });

    const confirmed = useRef(false);

    const handleConfirm = useCallback(() => {
        if (confirmed.current) return;
        confirmed.current = true;
        onConfirm(selections, labels);
    }, [onConfirm, selections, labels]);

    // Countdown
    useEffect(() => {
        const interval = setInterval(() => {
            setRemaining(prev => {
                const next = prev - 100;
                if (next <= 0) {
                    clearInterval(interval);
                    handleConfirm();
                    return 0;
                }
                return next;
            });
        }, 100);
        return () => clearInterval(interval);
    }, [handleConfirm]);

    // Build parent → children map
    const childMap = new Map<string | null, StructuringGroup[]>();
    for (const g of mapping.groups) {
        const parentId = g.parentId ?? null;
        if (!childMap.has(parentId)) childMap.set(parentId, []);
        childMap.get(parentId)!.push(g);
    }

    const progressPct = (remaining / timerMs.current) * 100;
    const totalSec = Math.ceil(remaining / 1000);
    const selectedCount = Array.from(selections.values()).filter(Boolean).length;

    function renderGroup(group: StructuringGroup, depth = 0): React.ReactNode {
        const children = childMap.get(group.nodeId) ?? [];
        const isSelected = selections.get(group.nodeId) ?? true;
        const currentLabel = labels.get(group.nodeId) ?? group.label;

        return (
            <div key={group.nodeId} style={{ marginLeft: depth * 16 }} className="phase5-review-row">
                <label className={`phase5-review-node ${!isSelected ? 'phase5-review-node--deselected' : ''}`}>
                    <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={e => {
                            const updated = new Map(selections);
                            updated.set(group.nodeId, e.target.checked);
                            setSelections(updated);
                        }}
                    />
                    <input
                        type="text"
                        value={currentLabel}
                        disabled={!isSelected}
                        className="phase5-review-label"
                        onChange={e => {
                            const updated = new Map(labels);
                            updated.set(group.nodeId, e.target.value);
                            setLabels(updated);
                        }}
                    />
                    <span className="phase5-review-meta">
                        <code className="phase5-review-nodeid">{group.nodeId}</code>
                        <span className="phase5-review-css">.{group.cssClass}</span>
                        <span className="phase5-review-paths">{group.keep?.length ?? 0} paths{group.merge ? ' +merge' : ''}</span>
                    </span>
                </label>
                {children.map(child => renderGroup(child, depth + 1))}
            </div>
        );
    }

    const topLevel = childMap.get(null) ?? [];

    return (
        <div className="phase5-review-panel">
            <div className="phase5-review-header">
                <span className="phase5-review-title">{t('phase5.reviewStructure')}</span>
                <span className="phase5-review-desc">{mapping.description}</span>
            </div>

            <div className="phase5-review-tree">
                {topLevel.map(g => renderGroup(g))}
                {mapping.discard?.length > 0 && (
                    <div className="phase5-review-discard">
                        <span className="phase5-review-discard-label">{t('phase5.discarded', { count: mapping.discard.length })}</span>
                        <span className="phase5-review-discard-ids">{mapping.discard.join(', ')}</span>
                    </div>
                )}
            </div>

            <div className="phase5-review-footer">
                <div className="phase5-review-timer-bar" role="progressbar" aria-valuenow={progressPct} aria-valuemin={0} aria-valuemax={100}>
                    <div className="phase5-review-timer-fill" style={{ width: `${progressPct}%` }} />
                </div>
                <div className="phase5-review-footer-row">
                    <span className="phase5-review-timer-text">{totalSec}s</span>
                    <span className="phase5-review-count">{t('phase5.nodes', { selected: selectedCount, total: mapping.groups.length })}</span>
                    <button
                        className="phase5-review-confirm-btn"
                        onClick={handleConfirm}
                        type="button"
                    >
                        {t('phase5.confirm')}
                    </button>
                </div>
            </div>
        </div>
    );
}
