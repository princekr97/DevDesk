import React, { Suspense, lazy, useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    GitCompare,
    Loader2,
    Trash2,
    Settings,
    XCircle
} from 'lucide-react';
import { WorkerManager } from '../../utils/WorkerManager';
import type { DiffRequest, DiffResult } from '../../workers/diff.worker';
import { useAppStore } from '../../store/AppContext';
import { useDraftPreference } from '../../hooks/useDraftPreference';
import { DRAFT_TTL_MS, loadDraftWithStatus, saveDraft, clearDraft } from '../../utils/draftStorage';

type DiffMode = 'text' | 'json';
type DiffCheckerDraft = {
    text1: string;
    text2: string;
    mode: DiffMode;
    ignoreWhitespace: boolean;
    sortKeys: boolean;
};
const DIFF_CHECKER_DRAFT_KEY = 'diff-checker';
const MonacoEditor = lazy(() => import('@monaco-editor/react').then((mod) => ({ default: mod.default })));
const MonacoDiffEditor = lazy(() => import('@monaco-editor/react').then((mod) => ({ default: mod.DiffEditor })));

/**
 * Diff Checker Component
 * 
 * **Purpose:**
 * Compare two text or JSON inputs with intelligent diffing.
 * 
 ** **Key Features:**
 * - Text mode: Line-by-line comparison
 * - JSON mode: Structural comparison with key sorting
 * - Whitespace ignore option
 * - Side-by-side Monaco editor with diff highlighting
 * - Worker-based diff computation (non-blocking)
 * 
 * **Mobile Responsive:**
 * - Stacks editors vertically on small screens
 * - Touch-friendly controls
 * 
 * @component
 */
const DiffChecker: React.FC = () => {
    const { state, setDiffChecker, setTaskStatus } = useAppStore();
    const { text1, text2, mode, ignoreWhitespace } = state.diffChecker;

    const [diffResult, setDiffResult] = useState<DiffResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [localText1, setLocalText1] = useState(text1);
    const [localText2, setLocalText2] = useState(text2);
    const [draftNotice, setDraftNotice] = useState<string | null>(null);
    const leftLines = useMemo(() => localText1.split('\n').length, [localText1]);
    const rightLines = useMemo(() => localText2.split('\n').length, [localText2]);
    const { enabled: draftsEnabled } = useDraftPreference();

    // Helpers
    const setText1 = (val: string) => setLocalText1(val);
    const setText2 = (val: string) => setLocalText2(val);
    const setMode = (val: DiffMode) => setDiffChecker({ mode: val });
    const setIgnoreWhitespace = (val: boolean) => setDiffChecker({ ignoreWhitespace: val });

    const commonOptions = useMemo(() => ({
        minimap: { enabled: false },
        fontSize: 13,
        lineNumbers: 'on' as const,
        folding: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        wordWrap: 'on' as const,
        padding: { top: 16, bottom: 16 },
        formatOnPaste: false,
        formatOnType: false,
    }), []);

    const diffOptions = useMemo(() => ({
        ...commonOptions,
        renderSideBySide: true,
        readOnly: true,
        originalEditable: false,
        useInlineViewWhenSpaceIsLimited: true,
    }), [commonOptions]);

    const workerRef = useRef<WorkerManager<DiffRequest, DiffResult> | null>(null);

    // Initialize worker
    const initWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new WorkerManager<DiffRequest, DiffResult>(
                () => new Worker(new URL('../../workers/diff.worker.ts', import.meta.url), { type: 'module' })
            );
        }
    }, []);

    useEffect(() => {
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    useEffect(() => {
        if (!draftsEnabled) return;
        const { data: draft, expired } = loadDraftWithStatus<DiffCheckerDraft>(DIFF_CHECKER_DRAFT_KEY);
        if (expired) {
            setDraftNotice(`Session expired (${Math.round(DRAFT_TTL_MS / 60000)} min). Draft cleared.`);
            const timer = window.setTimeout(() => setDraftNotice(null), 2000);
            return () => window.clearTimeout(timer);
        }
        if (!draft) return;
        setLocalText1(draft.text1 || '');
        setLocalText2(draft.text2 || '');
        setDiffChecker({
            text1: draft.text1 || '',
            text2: draft.text2 || '',
            mode: draft.mode || 'text',
            ignoreWhitespace: Boolean(draft.ignoreWhitespace),
            sortKeys: Boolean(draft.sortKeys),
        });
        setDraftNotice('Draft restored');
        const timer = window.setTimeout(() => setDraftNotice(null), 1600);
        return () => window.clearTimeout(timer);
    }, [draftsEnabled, setDiffChecker]);

    useEffect(() => {
        setLocalText1(text1);
    }, [text1]);

    useEffect(() => {
        setLocalText2(text2);
    }, [text2]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (localText1 !== text1 || localText2 !== text2) {
                setDiffChecker({ text1: localText1, text2: localText2 });
            }
        }, 160);
        return () => window.clearTimeout(timer);
    }, [localText1, localText2, text1, text2, setDiffChecker]);

    useEffect(() => {
        if (!draftsEnabled) return;
        const timer = window.setTimeout(() => {
            saveDraft<DiffCheckerDraft>(DIFF_CHECKER_DRAFT_KEY, {
                text1: localText1,
                text2: localText2,
                mode,
                ignoreWhitespace,
                sortKeys: Boolean(state.diffChecker.sortKeys),
            });
        }, 800);
        return () => window.clearTimeout(timer);
    }, [draftsEnabled, localText1, localText2, mode, ignoreWhitespace, state.diffChecker.sortKeys]);

    useEffect(() => {
        if (draftsEnabled) return;
        const hasUnsavedData = Boolean(localText1.trim() || localText2.trim() || diffResult);
        if (!hasUnsavedData) return;
        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [draftsEnabled, localText1, localText2, diffResult]);

    const handleCompare = useCallback(async () => {
        if (!localText1.trim() && !localText2.trim()) {
            setError('Please enter text in at least one editor');
            return;
        }

        setIsLoading(true);
        setError(null);
        setTaskStatus({ state: 'running', label: 'Computing diff' });
        workerRef.current?.cancelAll('Superseded by a newer compare request');
        initWorker();

        try {
            let processed1 = localText1;
            let processed2 = localText2;

            if (mode === 'json' && state.diffChecker.sortKeys) {
                try {
                    const obj1 = JSON.parse(localText1);
                    const obj2 = JSON.parse(localText2);
                    const { deepSortKeys } = await import('../../utils/jsonUtils');
                    processed1 = JSON.stringify(deepSortKeys(obj1), null, 2);
                    processed2 = JSON.stringify(deepSortKeys(obj2), null, 2);

                    // Update the state with sorted strings so they appear in DiffEditor
                    setLocalText1(processed1);
                    setLocalText2(processed2);
                    setDiffChecker({ text1: processed1, text2: processed2 });
                } catch (e) {
                    throw new Error('Invalid JSON structure. Sorting failed.');
                }
            }

            const result = await workerRef.current!.postMessage('COMPUTE_DIFF', {
                text1: processed1,
                text2: processed2,
                mode: mode === 'json' ? 'json' : 'lines',
                ignoreWhitespace,
            });

            setDiffResult(result);
            setTaskStatus({ state: 'done', label: 'Diff ready' });
        } catch (err) {
            if (WorkerManager.isCancelledError(err)) return;
            setError(err instanceof Error ? err.message : 'Failed to compute diff');
            setDiffResult(null);
            setTaskStatus({ state: 'error', label: 'Diff failed' });
        } finally {
            setIsLoading(false);
        }
    }, [localText1, localText2, mode, ignoreWhitespace, state.diffChecker.sortKeys, initWorker, setDiffChecker, setTaskStatus]);

    const handleClear = () => {
        const hasData = Boolean(localText1.trim() || localText2.trim() || diffResult);
        if (hasData && !window.confirm('Clear current diff input?')) {
            return;
        }
        workerRef.current?.cancelAll('Cleared by user');
        setText1('');
        setText2('');
        setDiffResult(null);
        setError(null);
        clearDraft(DIFF_CHECKER_DRAFT_KEY);
    };

    const handleSwap = () => {
        const temp = text1;
        setText1(text2);
        setText2(temp);
    };

    const handleCancelCurrentTask = useCallback(() => {
        workerRef.current?.cancelAll('Cancelled by user');
        setIsLoading(false);
        setTaskStatus({ state: 'cancelled', label: 'Diff cancelled' });
    }, [setTaskStatus]);

    return (
        <div className="h-full min-h-0 flex flex-col gap-3">
            <div className="premium-card p-3 sm:p-4 shrink-0">
                <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between">
                        <div>
                            <h1 className="text-base sm:text-lg font-bold text-slate-900 tracking-tight">Diff Checker</h1>
                            <p className="text-xs text-slate-500 mt-0.5">Compare plain text or JSON with a fast side-by-side view.</p>
                            {draftNotice && (
                                <span className="inline-block mt-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                                    {draftNotice}
                                </span>
                            )}
                        </div>
                        <div className="hidden sm:flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-500">
                            <span className="bg-slate-100 px-2 py-1 rounded">Left {leftLines} lines</span>
                            <span className="bg-slate-100 px-2 py-1 rounded">Right {rightLines} lines</span>
                        </div>
                    </div>

                    <div className="flex flex-col xl:flex-row xl:items-center xl:justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm font-semibold text-slate-700">Mode</span>
                            <div className="flex bg-slate-100 rounded-lg p-1 border border-slate-200/80">
                                <button
                                    onClick={() => setMode('text')}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'text'
                                        ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-indigo-100'
                                        : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                >
                                    Text
                                </button>
                                <button
                                    onClick={() => setMode('json')}
                                    className={`px-3 py-1.5 text-sm rounded-md transition-colors ${mode === 'json'
                                        ? 'bg-white text-indigo-700 font-semibold shadow-sm border border-indigo-100'
                                        : 'text-slate-600 hover:text-slate-900'
                                        }`}
                                >
                                    JSON
                                </button>
                            </div>
                            <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 ml-1 bg-white border border-slate-200 rounded-lg px-3 h-9">
                                <input
                                    type="checkbox"
                                    checked={ignoreWhitespace}
                                    onChange={(e) => setIgnoreWhitespace(e.target.checked)}
                                    className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                />
                                <span>Ignore whitespace</span>
                            </label>
                            {mode === 'json' && (
                                <label className="flex items-center gap-2 cursor-pointer text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 h-9">
                                    <input
                                        type="checkbox"
                                        checked={state.diffChecker.sortKeys || false}
                                        onChange={(e) => setDiffChecker({ sortKeys: e.target.checked })}
                                        className="w-4 h-4 text-indigo-600 border-slate-300 rounded focus:ring-indigo-500"
                                    />
                                    <span>Sort keys</span>
                                </label>
                            )}
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                            <button
                                onClick={handleSwap}
                                className="btn-outline h-9 px-3"
                                title="Swap left and right"
                            >
                                <GitCompare className="w-4 h-4" />
                                <span>Swap</span>
                            </button>
                            <button onClick={handleClear} className="btn-secondary h-9 px-3">
                                <Trash2 className="w-4 h-4" />
                                <span>Reset</span>
                            </button>
                            {isLoading && (
                                <button onClick={handleCancelCurrentTask} className="btn-secondary h-9 px-3 border-red-200 text-red-700">
                                    <XCircle className="w-4 h-4 text-red-500" />
                                    <span>Cancel</span>
                                </button>
                            )}
                            <button
                                onClick={handleCompare}
                                disabled={isLoading}
                                className="btn-primary h-9 px-4 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isLoading ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        <span>Computing</span>
                                    </>
                                ) : (
                                    <>
                                        <GitCompare className="w-4 h-4" />
                                        <span>Compare</span>
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex-1 min-h-0 overflow-hidden premium-card">
                {!diffResult ? (
                    <div className="h-full grid grid-cols-1 xl:grid-cols-2 gap-3 p-3 min-h-0">
                        <div className="flex flex-col space-y-2 min-h-0">
                            <div className="flex items-center justify-between px-1.5">
                                <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.18em]">Original Content</h2>
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                                    {leftLines} lines
                                </span>
                            </div>
                            <div className="flex-1 min-h-0 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-slate-500">Loading editor...</div>}>
                                    <MonacoEditor
                                        height="100%"
                                        language={mode === 'json' ? 'json' : 'plaintext'}
                                        path="diffchecker-left-input"
                                        value={localText1}
                                        onChange={(val) => setText1(val || '')}
                                        theme="light"
                                        keepCurrentModel={true}
                                        options={commonOptions}
                                    />
                                </Suspense>
                            </div>
                        </div>

                        <div className="flex flex-col space-y-2 min-h-0">
                            <div className="flex items-center justify-between px-1.5">
                                <h2 className="text-[10px] font-black text-slate-500 uppercase tracking-[0.18em]">Modified Content</h2>
                                <span className="text-[10px] font-bold text-indigo-700 bg-indigo-50 border border-indigo-100 px-2 py-0.5 rounded">
                                    {rightLines} lines
                                </span>
                            </div>
                            <div className="flex-1 min-h-0 border border-slate-200 rounded-xl overflow-hidden bg-white shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-slate-500">Loading editor...</div>}>
                                    <MonacoEditor
                                        height="100%"
                                        language={mode === 'json' ? 'json' : 'plaintext'}
                                        path="diffchecker-right-input"
                                        value={localText2}
                                        onChange={(val) => setText2(val || '')}
                                        theme="light"
                                        keepCurrentModel={true}
                                        options={commonOptions}
                                    />
                                </Suspense>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="h-full flex flex-col min-h-0">
                        <div className="px-3 py-2.5 border-b border-slate-200 bg-white/90 flex items-center justify-between">
                            <div className="flex items-center space-x-2">
                                <GitCompare className="w-5 h-5 text-indigo-600" />
                                <h2 className="text-sm font-bold text-slate-900 uppercase tracking-tight">Comparison Result</h2>
                            </div>
                            <button
                                onClick={() => setDiffResult(null)}
                                className="btn-secondary h-8 px-3 text-xs font-bold"
                            >
                                BACK TO EDIT
                            </button>
                        </div>
                        <div className="flex-1 min-h-0">
                            <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-slate-500">Loading diff view...</div>}>
                                <MonacoDiffEditor
                                    height="100%"
                                    original={localText1}
                                    modified={localText2}
                                    originalModelPath="diffchecker-original-model"
                                    modifiedModelPath="diffchecker-modified-model"
                                    language={mode === 'json' ? 'json' : 'plaintext'}
                                    theme="light"
                                    keepCurrentOriginalModel={true}
                                    keepCurrentModifiedModel={true}
                                    options={diffOptions}
                                />
                            </Suspense>
                        </div>
                    </div>
                )}
            </div>

            {error && (
                <div className="border border-red-200 px-3 py-2 bg-red-50 rounded-md">
                    <div className="flex items-center space-x-2 text-red-700">
                        <Settings className="w-4 h-4" />
                        <span className="text-sm font-medium">{error}</span>
                    </div>
                </div>
            )}
        </div>
    );
};

export default DiffChecker;
