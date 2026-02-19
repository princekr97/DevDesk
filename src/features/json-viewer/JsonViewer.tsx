import React, { useState, useRef, useCallback, useEffect, useMemo, lazy, Suspense } from 'react';
import {
    Upload,
    FileJson,
    Search,
    AlertCircle,
    Trash2,
    ChevronDown,
    ChevronRight,
    Wand2,
    Copy,
    Check,
    XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { WorkerManager } from '../../utils/WorkerManager';
import type { JsonNode } from '../../types/json';
import { copyToClipboard, formatFileSize } from '../../utils/jsonUtils';
import { useAppStore } from '../../store/AppContext';
import AppLoader from '../../components/AppLoader';
import { logger } from '../../utils/logger';
import { useDraftPreference } from '../../hooks/useDraftPreference';
import { DRAFT_TTL_MS, loadDraftWithStatus, saveDraft, clearDraft } from '../../utils/draftStorage';

const MonacoEditor = lazy(() => import('@monaco-editor/react'));
const VirtualizedJsonTree = lazy(() => import('../../components/VirtualizedJsonTree'));
type JsonSearchResult = { paths: string[]; count: number };
type JsonViewerDraft = { jsonInput: string };
const JSON_VIEWER_DRAFT_KEY = 'json-viewer';

const containerMotion = {
    hidden: { opacity: 0, y: 8 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.28, ease: 'easeOut' as const },
    },
};

const sectionMotion = {
    hidden: { opacity: 0, y: 10 },
    show: {
        opacity: 1,
        y: 0,
        transition: { duration: 0.26, ease: 'easeOut' as const },
    },
};

/**
 * JSON Structure Viewer Component
 * 
 * **Purpose:**
 * High-performance JSON visualization with support for massive files (100MB+).
 * 
 * **Key Features:**
 * - Virtualized tree rendering (only visible nodes)
 * - Worker-based parsing (non-blocking UI)
 * - Direct Mode for files > 2MB (zero-copy ArrayBuffer transfer)
 * - Real-time search with match counting
 * - Circuit breaker at 15,000 nodes to prevent crashes
 * 
 * **Performance:**
 * - Uses `jsonParser.worker.ts` for background parsing
 * - Yields to UI every 12ms during parse
 * - Maintains 60 FPS during scrolling
 * 
 * **Mobile Responsive:**
 * - Adapts layout for small screens
 * - Touch-friendly expand/collapse
 * 
 * @component
 * @example
 * ```tsx
 * <JsonViewer />  // Used in routes
 * ```
 */
const JsonViewer: React.FC = () => {
    const { state, setJsonViewer, setTaskStatus } = useAppStore();
    const { jsonInput, jsonTree, error, fileInfo, isDirectMode, rawFile } = state.jsonViewer;

    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
    const [expandAll, setExpandAll] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [searchCount, setSearchCount] = useState<number | null>(null);
    const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set(['root']));
    const [isCopied, setIsCopied] = useState(false);
    const [draftNotice, setDraftNotice] = useState<string | null>(null);
    const { enabled: draftsEnabled } = useDraftPreference();

    const workerRef = useRef<WorkerManager<unknown, unknown> | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const parseSeqRef = useRef(0);
    const searchSeqRef = useRef(0);

    // Initialize worker once
    const initWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new WorkerManager<unknown, unknown>(
                () => new Worker(new URL('../../workers/jsonParser.worker.ts', import.meta.url), { type: 'module' })
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
        const { data: draft, expired } = loadDraftWithStatus<JsonViewerDraft>(JSON_VIEWER_DRAFT_KEY);
        if (expired) {
            setDraftNotice(`Session expired (${Math.round(DRAFT_TTL_MS / 60000)} min). Draft cleared.`);
            const timer = window.setTimeout(() => setDraftNotice(null), 2000);
            return () => window.clearTimeout(timer);
        }
        if (!draft?.jsonInput) return;
        setJsonViewer({
            jsonInput: draft.jsonInput,
            rawFile: null,
            isDirectMode: false,
            fileInfo: null,
        });
        setDraftNotice('Draft restored');
        const timer = window.setTimeout(() => setDraftNotice(null), 1600);
        return () => window.clearTimeout(timer);
    }, [draftsEnabled, setJsonViewer]);

    useEffect(() => {
        if (!draftsEnabled) return;
        const timer = window.setTimeout(() => {
            saveDraft<JsonViewerDraft>(JSON_VIEWER_DRAFT_KEY, { jsonInput });
        }, 800);
        return () => window.clearTimeout(timer);
    }, [draftsEnabled, jsonInput]);

    useEffect(() => {
        if (draftsEnabled) return;
        const hasUnsavedData = Boolean(jsonInput.trim() || rawFile || jsonTree);
        if (!hasUnsavedData) return;

        const handler = (event: BeforeUnloadEvent) => {
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [draftsEnabled, jsonInput, rawFile, jsonTree]);

    // Stable Parse Handler
    const handleToggle = useCallback((path: string) => {
        setExpandedPaths(prev => {
            const next = new Set(prev);
            if (next.has(path)) next.delete(path);
            else next.add(path);
            return next;
        });
    }, []);

    const handleParse = useCallback(async (input?: string, file?: File | null, directMode?: boolean) => {
        const sourceInput = input !== undefined ? input : jsonInput;
        const sourceFile = file !== undefined ? file : rawFile;
        const sourceDirect = directMode !== undefined ? directMode : isDirectMode;
        const requestId = ++parseSeqRef.current;

        if (!sourceInput.trim() && !sourceFile) {
            return;
        }

        workerRef.current?.cancelAll('Superseded by a newer parse request');
        setIsLoading(true);
        setTaskStatus({ state: 'running', label: 'Parsing JSON' });
        setJsonViewer({ error: null });

        setTimeout(async () => {
            initWorker();
            try {
                let payload: string | ArrayBuffer;
                let transfer: Transferable[] | undefined;

                if (sourceDirect && sourceFile) {
                    payload = await sourceFile.arrayBuffer();
                    transfer = [payload];
                } else {
                    const encoder = new TextEncoder();
                    const buffer = encoder.encode(sourceInput);
                    payload = buffer.buffer;
                    transfer = [buffer.buffer];
                }

                const result = await workerRef.current!.postMessage(
                    'PARSE_JSON',
                    payload,
                    transfer,
                    0,
                    (progressData) => {
                        void progressData;
                    }
                ) as JsonNode;
                if (requestId !== parseSeqRef.current) return;
                setJsonViewer({ jsonTree: result, error: null });
                setTaskStatus({ state: 'done', label: 'JSON parsed' });
            } catch (err: unknown) {
                if (requestId !== parseSeqRef.current) return;
                if (WorkerManager.isCancelledError(err)) return;
                const parseError = err instanceof Error
                    ? { message: err.message, lineNumber: null }
                    : { message: String(err), lineNumber: null };
                setJsonViewer({ jsonTree: null, error: parseError });
                setTaskStatus({ state: 'error', label: 'JSON parse failed' });
            } finally {
                if (requestId === parseSeqRef.current) {
                    setIsLoading(false);
                }
            }
        }, 0);
    }, [jsonInput, rawFile, isDirectMode, initWorker, setJsonViewer, setTaskStatus]);

    // Handle Search
    useEffect(() => {
        if (!jsonTree) return;
        if (!debouncedSearchQuery) {
            setExpandedPaths(new Set(['root']));
            setSearchCount(null);
            return;
        }

        const searchId = ++searchSeqRef.current;
        initWorker();
        workerRef.current!.postMessage('SEARCH_JSON', debouncedSearchQuery, undefined, 150)
            .then((result) => {
                if (searchId !== searchSeqRef.current) return;
                const searchResult = result as JsonSearchResult;
                const paths = Array.isArray(searchResult?.paths) ? searchResult.paths : [];
                const count = typeof searchResult?.count === 'number' ? searchResult.count : 0;
                setExpandedPaths(new Set(['root', ...paths]));
                setSearchCount(count);
            })
            .catch((err: unknown) => {
                if (searchId !== searchSeqRef.current) return;
                if (!WorkerManager.isCancelledError(err)) {
                    logger.error('Search failed:', err);
                    setSearchCount(0);
                }
            });
    }, [debouncedSearchQuery, jsonTree, initWorker]);

    // Debounce search input
    useEffect(() => {
        const timer = setTimeout(() => setDebouncedSearchQuery(searchQuery), 300);
        return () => clearTimeout(timer);
    }, [searchQuery]);

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        const useDirect = file.size > 2 * 1024 * 1024;
        setJsonViewer({
            fileInfo: { name: file.name, size: file.size },
            jsonTree: null,
            error: null,
            isDirectMode: useDirect,
            rawFile: file,
            jsonInput: useDirect ? '' : '' // Placeholder
        });

        if (!useDirect) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result as string;
                setJsonViewer({ jsonInput: content });
            };
            reader.readAsText(file);
        }
    };

    const handleFormat = async () => {
        if (!jsonInput.trim() && !rawFile) return;
        try {
            const content = (rawFile && isDirectMode) ? await rawFile.text() : jsonInput;
            const formatted = JSON.stringify(JSON.parse(content), null, 2);
            setJsonViewer({ jsonInput: formatted, isDirectMode: false, rawFile: null, error: null });
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            setJsonViewer({ error: { message: `Invalid JSON: ${message}`, lineNumber: null } });
        }
    };

    const handleClear = () => {
        const hasData = Boolean(jsonInput.trim() || rawFile || jsonTree);
        if (hasData && !window.confirm('Clear current JSON data?')) {
            return;
        }
        if (isLoading) {
            setTaskStatus({ state: 'cancelled', label: 'JSON parse cancelled' });
        }
        parseSeqRef.current += 1;
        workerRef.current?.cancelAll('Cleared by user');
        setJsonViewer({
            jsonInput: '', jsonTree: null, error: null, fileInfo: null,
            isDirectMode: false, rawFile: null
        });
        setSearchQuery('');
        setSearchCount(null);
        searchSeqRef.current += 1;
        if (fileInputRef.current) fileInputRef.current.value = '';
        clearDraft(JSON_VIEWER_DRAFT_KEY);
    };

    const handleCopyJson = useCallback(async () => {
        let content = jsonInput;
        if (!content.trim() && rawFile) {
            content = await rawFile.text();
        }
        if (!content.trim()) return;

        const copied = await copyToClipboard(content);
        if (copied) {
            setIsCopied(true);
            window.setTimeout(() => setIsCopied(false), 1400);
        }
    }, [jsonInput, rawFile]);

    const handleCancelCurrentTask = useCallback(() => {
        parseSeqRef.current += 1;
        workerRef.current?.cancelAll('Cancelled by user');
        setIsLoading(false);
        setTaskStatus({ state: 'cancelled', label: 'JSON parse cancelled' });
    }, [setTaskStatus]);

    const canVisualize = Boolean(jsonInput.trim() || rawFile);
    const hasTree = Boolean(jsonTree);
    const approxLineCount = useMemo(() => {
        if (!jsonInput.trim()) return 0;
        return jsonInput.split('\n').length;
    }, [jsonInput]);
    const approxCharCount = jsonInput.length;
    const compactMeta = `${approxLineCount.toLocaleString()} Lines • ${approxCharCount.toLocaleString()} Chars`;

    return (
        <motion.div
            initial="hidden"
            animate="show"
            variants={containerMotion}
            className="h-full min-h-0 flex flex-col gap-2 sm:gap-3 premium-pattern-bg rounded-2xl p-2 sm:p-3 border border-slate-200/70 shadow-[0_14px_34px_rgba(15,23,42,0.05)]"
        >
            <motion.div variants={sectionMotion} className="flex items-center justify-between gap-2 px-1">
                <div className="flex items-center gap-1.5 min-w-0">
                    <span className="text-[11px] font-semibold bg-white/85 border border-slate-200/80 px-2 py-0.5 rounded-md text-slate-600 shrink-0">
                        {compactMeta}
                    </span>
                    {fileInfo && <span className="text-[11px] font-semibold bg-indigo-50/90 border border-indigo-100 text-indigo-700 px-2 py-0.5 rounded-md shrink-0">{formatFileSize(fileInfo.size)}</span>}
                </div>
                <span className="hidden md:inline text-[11px] font-semibold text-slate-400 shrink-0">Client-side processing</span>
                {draftNotice && (
                    <span className="text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 px-2 py-0.5 rounded-md">
                        {draftNotice}
                    </span>
                )}
            </motion.div>

            <div className="flex-1 grid grid-cols-1 xl:grid-cols-2 gap-3 sm:gap-4 min-h-0 overflow-hidden">
                <motion.section variants={sectionMotion} className="flex flex-col gap-2 min-h-0 min-w-0">
                    <div className="flex items-end justify-between px-1 h-8">
                        <h2 className="text-lg font-bold text-slate-900 leading-none tracking-tight">Source JSON</h2>
                    </div>

                    <div className="premium-card p-2.5 flex items-center justify-between gap-2 ring-1 ring-white/40">
                        <input ref={fileInputRef} type="file" accept=".json" onChange={handleFileUpload} className="hidden" id="json-file-upload" />
                        <div className="flex items-center gap-2 flex-wrap">
                            <label htmlFor="json-file-upload" className="btn-secondary h-9 px-3.5 cursor-pointer">
                                <Upload className="w-4 h-4" />
                                <span className="text-sm font-semibold">Upload</span>
                            </label>
                            <button onClick={handleFormat} className="btn-secondary h-9 px-3.5">
                                <Wand2 className="w-4 h-4 text-amber-500" />
                                <span className="text-sm font-semibold">Format</span>
                            </button>
                            <button onClick={handleCopyJson} disabled={!canVisualize} className="btn-secondary h-9 px-3.5 disabled:opacity-50">
                                {isCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                                <span className="text-sm font-semibold">{isCopied ? 'Copied' : 'Copy'}</span>
                            </button>
                            <button onClick={handleClear} className="btn-secondary h-9 px-3.5">
                                <Trash2 className="w-4 h-4" />
                                <span className="text-sm font-semibold">Reset</span>
                            </button>
                        </div>
                        {isLoading ? (
                            <button onClick={handleCancelCurrentTask} className="btn-secondary h-9 px-4 shrink-0">
                                <XCircle className="w-4 h-4 text-red-500" />
                                <span className="text-sm font-semibold">Cancel</span>
                            </button>
                        ) : (
                            <button onClick={() => handleParse()} disabled={!canVisualize} className="btn-primary-gradient h-9 px-4 shrink-0 disabled:opacity-50">
                                <FileJson className="w-4 h-4" />
                                <span className="text-sm font-semibold">Visualize</span>
                            </button>
                        )}
                    </div>

                    <div className="flex-1 premium-card panel-pattern overflow-hidden min-h-0 relative ring-1 ring-white/40">
                        {fileInfo && (
                            <div className="px-4 py-2.5 bg-indigo-50/70 border-b border-indigo-100/80 flex justify-between items-center">
                                <div className="flex items-center gap-2 min-w-0">
                                    <FileJson className="w-4 h-4 text-indigo-500 shrink-0" />
                                    <span className="text-xs font-bold text-indigo-700 truncate">{fileInfo.name}</span>
                                </div>
                                {isDirectMode && <span className="bg-indigo-600 text-white px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-[0.14em]">Turbo</span>}
                            </div>
                        )}

                        <div className="h-full min-h-0">
                            {isDirectMode ? (
                                <div className="w-full h-full flex flex-col items-center justify-center text-slate-500 gap-4 bg-gradient-to-b from-slate-50/80 to-white/90 p-6">
                                    <div className="w-16 h-16 bg-white border border-slate-200 rounded-2xl shadow-sm flex items-center justify-center">
                                        <FileJson className="w-8 h-8 text-indigo-500" />
                                    </div>
                                    <div className="text-center max-w-sm">
                                        <p className="font-bold text-gray-900">Large JSON loaded in Direct Mode</p>
                                        <p className="text-sm text-gray-500 mt-1">Editor rendering is bypassed to keep the app responsive. Click Visualize to parse.</p>
                                    </div>
                                </div>
                            ) : (
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-gray-500">Loading editor...</div>}>
                                    <MonacoEditor
                                        height="100%"
                                        defaultLanguage="json"
                                        value={jsonInput}
                                        onChange={(v) => setJsonViewer({ jsonInput: v || '' })}
                                        theme="light"
                                        options={{
                                            minimap: { enabled: false },
                                            fontSize: 13,
                                            automaticLayout: true,
                                            padding: { top: 16, bottom: 16 },
                                            scrollBeyondLastLine: false
                                        }}
                                    />
                                </Suspense>
                            )}
                        </div>
                    </div>

                    {error && (
                        <div className="bg-red-50/95 border border-red-200 rounded-lg p-4 flex items-start gap-3 shadow-sm">
                            <AlertCircle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
                            <div>
                                <h3 className="font-bold text-red-900 text-sm">Syntax Error</h3>
                                <p className="text-sm text-red-700 mt-1">{error.message}</p>
                            </div>
                        </div>
                    )}
                </motion.section>

                <motion.section variants={sectionMotion} className="flex flex-col gap-2 min-h-0 min-w-0">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between px-1 h-8">
                        <div>
                            <h2 className="text-lg font-bold text-slate-900 leading-none tracking-tight">Structured View</h2>
                        </div>
                    </div>

                    <div className="premium-card p-2.5 flex items-center justify-between gap-2 ring-1 ring-white/40">
                        <div className="flex items-center gap-2 w-full min-w-0">
                            <div className="relative w-full max-w-[320px]">
                                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                                <input
                                    type="text"
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    placeholder="Search keys or values..."
                                    className="modern-input h-9 pl-10 pr-20 w-full text-sm disabled:bg-gray-50"
                                    disabled={!hasTree}
                                />
                                {searchCount !== null && (
                                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-black bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">
                                        {searchCount}
                                    </span>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => setExpandAll(true)}
                                className="btn-secondary h-9 px-3 disabled:opacity-50"
                                disabled={!hasTree || (jsonTree?.children?.length || 0) > 2000}
                                title="Expand all"
                            >
                                <ChevronDown className="w-4 h-4" />
                            </button>
                            <button
                                onClick={() => setExpandAll(false)}
                                className="btn-secondary h-9 px-3 disabled:opacity-50"
                                disabled={!hasTree}
                                title="Collapse all"
                            >
                                <ChevronRight className="w-4 h-4" />
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 premium-card panel-pattern overflow-hidden min-h-0 ring-1 ring-white/40">
                        <div className="h-full p-3 sm:p-4 min-h-0 relative">
                            {isLoading && (
                                <div className="absolute inset-0 z-20 bg-white/80 backdrop-blur-sm flex items-center justify-center">
                                    <AppLoader label="Parsing JSON" size="sm" showBrandText={false} />
                                </div>
                            )}
                            {jsonTree ? (
                                <Suspense fallback={<div className="h-full flex items-center justify-center text-sm text-gray-500">Loading structure...</div>}>
                                    <VirtualizedJsonTree
                                        data={jsonTree}
                                        searchQuery={debouncedSearchQuery}
                                        defaultExpanded={expandAll}
                                        externalExpandedPaths={expandedPaths}
                                        onToggle={handleToggle}
                                    />
                                </Suspense>
                            ) : (
                                <div className="h-full flex flex-col items-center justify-center subtle-grid rounded-xl p-6 text-center">
                                    <div className="w-14 h-14 bg-white/90 rounded-2xl flex items-center justify-center border border-slate-200 shadow-sm">
                                        <FileJson className="w-7 h-7 text-indigo-500/70" />
                                    </div>
                                    <p className="mt-4 text-base font-bold text-slate-900">Structured view is ready</p>
                                    <p className="mt-1 text-sm text-slate-600 max-w-md">
                                        Click Visualize to load and explore your JSON tree.
                                    </p>
                                    <button
                                        onClick={() => handleParse()}
                                        disabled={!jsonInput.trim() && !rawFile}
                                        className="mt-4 btn-primary h-9 px-4 disabled:opacity-50"
                                    >
                                        <Wand2 className="w-4 h-4" />
                                        <span className="text-sm font-semibold">Visualize Now</span>
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                </motion.section>
            </div>
        </motion.div>
    );
};

export default JsonViewer;
