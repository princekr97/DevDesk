import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    Download,
    Loader2,
    Trash2,
    AlertCircle,
    ArrowRightLeft,
    Table as TableIcon,
    Code,
    Eye,
    ChevronDown,
    Copy,
    Check,
    XCircle
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { WorkerManager } from '../../utils/WorkerManager';
import FileUploader from '../../components/FileUploader';
import TanStackDataTable from '../../components/TanStackDataTable';
import type { CsvConversionRequest } from '../../workers/csv.worker';
import { useAppStore } from '../../store/AppContext';
import { copyToClipboard } from '../../utils/jsonUtils';
import { perfMark, perfMeasure } from '../../utils/perf';
import { buildDownloadFileName, resolveExportBaseName } from '../../utils/fileName';
import type { PreviewChunkPayload } from '../../types/worker';
import { CONVERTER_LIMITS } from '../../constants';

type ConversionMode = 'json-to-csv' | 'csv-to-json';
type ViewType = 'json' | 'table';

const JsonCsvConverter: React.FC = () => {
    const { state, setJsonCsv, setTaskStatus } = useAppStore();
    const {
        file,
        inputData,
        mode,
        totalRows,
        isDirty,
        flatten,
        delimiter,
        isDirectMode
    } = state.jsonCsv;


    const [resultData, setResultData] = useState<any>(null);
    const [viewType, setViewType] = useState<ViewType>('table');
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [isJsonCopied, setIsJsonCopied] = useState(false);
    const [localInputData, setLocalInputData] = useState(inputData);
    const [exportFileName, setExportFileName] = useState('');
    const [previewRows, setPreviewRows] = useState<any[]>([]);
    const [previewTotalRows, setPreviewTotalRows] = useState<number | null>(totalRows);

    // State setters tied to global store
    const setFile = (val: File | null) => setJsonCsv({ file: val });
    const setInputData = (val: string) => setJsonCsv({ inputData: val });
    const setMode = (val: ConversionMode) => setJsonCsv({ mode: val });
    const setTotalRows = (val: number | null) => setJsonCsv({ totalRows: val });
    const setIsDirty = (val: boolean) => setJsonCsv({ isDirty: val });

    const setFlatten = (val: boolean) => setJsonCsv({ flatten: val });
    const setDelimiter = (val: string) => setJsonCsv({ delimiter: val });
    const setIsDirectMode = (val: boolean) => setJsonCsv({ isDirectMode: val });
    const [isLoading, setIsLoading] = useState(false);
    const [isParsing, setIsParsing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [previewStartedAt, setPreviewStartedAt] = useState<number | null>(null);
    const activeTableData = previewRows;
    const activeTotalRows = previewTotalRows ?? totalRows;
    const previewTargetRows = Math.min(activeTotalRows ?? 1000, 1000);
    const previewLoadedRows = Math.min(previewRows.length, previewTargetRows);
    const previewProgressPct = previewTargetRows > 0
        ? Math.min(100, Math.round((previewLoadedRows / previewTargetRows) * 100))
        : 0;
    const elapsedSeconds = previewStartedAt ? Math.max((Date.now() - previewStartedAt) / 1000, 0.001) : 0;
    const previewRowsPerSec = previewLoadedRows > 0 && elapsedSeconds > 0 ? Math.round(previewLoadedRows / elapsedSeconds) : 0;
    const previewRemainingRows = Math.max(previewTargetRows - previewLoadedRows, 0);
    const previewEtaSeconds = previewRowsPerSec > 0 ? Math.ceil(previewRemainingRows / previewRowsPerSec) : null;
    const previewEtaLabel = previewEtaSeconds === null
        ? null
        : previewEtaSeconds < 60
            ? `${previewEtaSeconds}s`
            : `${Math.floor(previewEtaSeconds / 60)}m ${previewEtaSeconds % 60}s`;
    const etaConfidence = previewRowsPerSec > 0 && previewLoadedRows >= 300 && elapsedSeconds >= 2 ? 'Stable' : 'Calibrating';
    const previewSafeModeActive = Boolean(
        file
        && file.size > CONVERTER_LIMITS.SAFE_MODE_PREVIEW_FILE_BYTES
        && (mode === 'csv-to-json' || isDirectMode || !localInputData.trim())
    );
    const safeModeLimitMb = Math.round(CONVERTER_LIMITS.SAFE_MODE_PREVIEW_FILE_BYTES / (1024 * 1024));

    const activeTableDataRef = useRef(activeTableData);
    useEffect(() => {
        activeTableDataRef.current = previewRows;
    }, [previewRows]);

    const handleTableDataChange = useCallback((newData: any[]) => {
        activeTableDataRef.current = newData;
        setPreviewRows(newData);
        setIsDirty(true);
    }, [setIsDirty]);

    const jsonPreviewText = useMemo(() => {
        if (resultData && mode === 'csv-to-json') {
            return JSON.stringify(resultData, null, 2);
        }
        if (activeTableData.length > 0) {
            return JSON.stringify(activeTableData, null, 2);
        }
        return '';
    }, [resultData, mode, activeTableData]);

    const editorOptions = useMemo(() => ({
        minimap: { enabled: false },
        fontSize: 12,
        lineNumbers: 'on' as const,
        folding: true,
        scrollBeyondLastLine: false,
        automaticLayout: true,
        tabSize: 2,
        wordWrap: 'on' as const,
        padding: { top: 12, bottom: 12 },
        formatOnPaste: false,
        formatOnType: false,
    }), []);

    const workerRef = useRef<WorkerManager<CsvConversionRequest, any> | null>(null);

    const initWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new WorkerManager<CsvConversionRequest, any>(
                () => new Worker(new URL('../../workers/csv.worker.ts', import.meta.url), { type: 'module' })
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
        setLocalInputData(inputData);
    }, [inputData]);

    useEffect(() => {
        const timer = window.setTimeout(() => {
            if (localInputData !== inputData) {
                setInputData(localInputData);
            }
        }, 180);
        return () => window.clearTimeout(timer);
    }, [localInputData, inputData]);

    useEffect(() => {
        setPreviewTotalRows(totalRows);
    }, [totalRows]);

    useEffect(() => {
        setExportFileName(file?.name ?? '');
    }, [file]);

    const validateAndPreview = useCallback(async () => {
        setError(null);
        if (previewSafeModeActive) {
            setError(`Preview is disabled in Safe Mode for files above ${safeModeLimitMb}MB. Use Convert & Export.`);
            return;
        }
        perfMark('json-csv-preview-start');
        setPreviewStartedAt(Date.now());
        let firstChunkMeasured = false;

        if (mode === 'json-to-csv') {
            if (!localInputData.trim() && !file) {
                setError('Please enter JSON data or upload a file first');
                return;
            }
        } else {
            if (!file) {
                setError('Please upload a CSV file first');
                return;
            }
        }

        setIsParsing(true);
        setTaskStatus({ state: 'running', label: 'Preparing preview' });
        workerRef.current?.cancelAll('Superseded by a newer preview request');
        initWorker();
        setPreviewRows([]);
        setPreviewTotalRows(null);
        setTotalRows(null);

        try {
            let data: any;
            let transfer: Transferable[] | undefined;
            const collectedRows: any[] = [];
            let collectedTotalRows: number | null = null;

            if (mode === 'json-to-csv') {
                if (isDirectMode && file) {
                    data = await file.arrayBuffer();
                    transfer = [data];
                } else {
                    data = localInputData;
                }

                await workerRef.current!.postMessage('PARSE_FOR_PREVIEW_STREAM' as any, {
                    data,
                    options: { flatten }
                }, transfer, 0, (progressData) => {
                    const payload = progressData as PreviewChunkPayload;
                    if (!Array.isArray(payload?.chunk)) return;
                    if (!firstChunkMeasured && payload.chunk.length > 0) {
                        perfMark('json-csv-preview-first-chunk');
                        perfMeasure('json-csv-first-preview', 'json-csv-preview-start', 'json-csv-preview-first-chunk');
                        firstChunkMeasured = true;
                    }
                    collectedRows.push(...payload.chunk);
                    setPreviewRows((prev) => [...prev, ...payload.chunk]);
                    if (typeof payload.totalRows === 'number') {
                        collectedTotalRows = payload.totalRows;
                        setPreviewTotalRows(payload.totalRows);
                    }
                });

                setTotalRows(collectedTotalRows ?? collectedRows.length);
                setViewType('table');
                setIsDirty(false);

            } else {
                // CSV-to-JSON preview
                data = await file!.arrayBuffer();
                transfer = [data];

                const result = await workerRef.current!.postMessage('CONVERT_CSV', {
                    data,
                    type: 'csv-to-json',
                    options: { delimiter, flatten }
                }, transfer);

                const jsonData = result;
                setResultData(jsonData);
                const nextPreview = Array.isArray(jsonData) ? jsonData.slice(0, 1000) : [jsonData];
                const nextTotal = Array.isArray(jsonData) ? jsonData.length : 1;
                setPreviewRows(nextPreview);
                setPreviewTotalRows(nextTotal);
                setTotalRows(nextTotal);
                setViewType('table');
                setIsDirty(false);

            }
            perfMark('json-csv-preview-complete');
            perfMeasure('json-csv-preview-total', 'json-csv-preview-start', 'json-csv-preview-complete');
            setTaskStatus({ state: 'done', label: 'Preview ready' });
        } catch (e) {
            if (WorkerManager.isCancelledError(e)) return;
            setError(`Preview failed: ${e instanceof Error ? e.message : 'Invalid data structure'}`);
            setTaskStatus({ state: 'error', label: 'Preview failed' });
            setPreviewStartedAt(null);
        } finally {
            setIsParsing(false);
        }
    }, [localInputData, file, isDirectMode, flatten, delimiter, initWorker, mode, previewSafeModeActive, safeModeLimitMb, setTaskStatus]);

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setError(null);
        setPreviewRows([]);
        setTotalRows(null);
        setPreviewTotalRows(null);
        setPreviewStartedAt(null);

        if (selectedFile.size > 1 * 1024 * 1024) {
            setIsDirectMode(true);
            setInputData('');
            setLocalInputData('');
        } else {
            setIsDirectMode(false);
            if (mode === 'json-to-csv' && selectedFile.name.toLowerCase().endsWith('.json')) {
                try {
                    const text = await selectedFile.text();
                    setInputData(text);
                    setLocalInputData(text);
                } catch (err) {
                    setError('Failed to read JSON file');
                }
            }
        }
    };

    const handleClear = () => {
        workerRef.current?.cancelAll('Cleared by user');
        setFile(null);
        setInputData('');
        setLocalInputData('');
        setExportFileName('');
        setPreviewRows([]);
        setTotalRows(null);
        setPreviewTotalRows(null);
        setPreviewStartedAt(null);
        setResultData(null);
        setError(null);
        setIsDirectMode(false);
        setIsDirty(false);
    };



    const handleExport = async (format: 'csv' | 'xlsx' | 'json') => {
        setIsLoading(true);
        setError(null);
        setShowExportMenu(false);
        perfMark('json-csv-export-start');
        setTaskStatus({ state: 'running', label: `Exporting ${format.toUpperCase()}` });
        workerRef.current?.cancelAll('Superseded by a newer export request');

        try {
            const sourceBaseName = resolveExportBaseName({
                preferredName: exportFileName,
                sourceFileName: file?.name,
                fallback: mode === 'json-to-csv' ? 'json_data' : 'csv_data',
            });
            let rowsForExport: any[] = [];

            const latestTableData = activeTableDataRef.current;

            if (mode === 'json-to-csv') {
                let rawJson = '';
                if (localInputData.trim()) {
                    rawJson = localInputData;
                } else if (file) {
                    rawJson = isDirectMode
                        ? new TextDecoder().decode(await file.arrayBuffer())
                        : await file.text();
                } else {
                    throw new Error('Please provide JSON data or upload a file');
                }
                const parsed = JSON.parse(rawJson);
                rowsForExport = Array.isArray(parsed) ? parsed : [parsed];
            } else {
                if (!file) throw new Error('Please upload a CSV file');
                initWorker();
                const data = await file.arrayBuffer();
                const workerOptions: any = { delimiter, flatten };
                if (isDirty && latestTableData.length > 0) {
                    workerOptions.overwriteRows = latestTableData;
                }
                const parsed = await workerRef.current!.postMessage('CONVERT_CSV', {
                    data,
                    type: 'csv-to-json',
                    options: workerOptions
                }, [data]);
                rowsForExport = Array.isArray(parsed) ? parsed : [parsed];
            }


            if (mode === 'json-to-csv' && isDirty && latestTableData.length > 0) {
                if (format === 'xlsx' || format === 'json') {
                    const previewedCount = Math.min(1000, rowsForExport.length);
                    rowsForExport.splice(0, previewedCount, ...latestTableData);
                }
            }

            if (format === 'xlsx') {
                // Dynamic import of xlsx library
                const XLSX = await import('xlsx');
                const ws = XLSX.utils.json_to_sheet(rowsForExport);
                const wb = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(wb, ws, 'Data');
                XLSX.writeFile(wb, buildDownloadFileName(sourceBaseName, 'xlsx'));
            } else if (format === 'csv') {
                // Use existing worker for CSV export
                initWorker();
                const workerOptions: any = { delimiter, flatten };
                if (mode === 'json-to-csv' && isDirty && latestTableData.length > 0) {
                    workerOptions.overwriteRows = latestTableData;
                }
                const data = JSON.stringify(rowsForExport);
                const result = await workerRef.current!.postMessage('CONVERT_CSV', {
                    data,
                    type: 'json-to-csv',
                    options: workerOptions
                });

                const blob = new Blob([result], { type: 'text/csv;charset=utf-8;' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = buildDownloadFileName(sourceBaseName, 'csv');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            } else if (format === 'json') {
                // JSON export
                const blob = new Blob([JSON.stringify(rowsForExport, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = buildDownloadFileName(sourceBaseName, 'json');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }
            perfMark('json-csv-export-complete');
            perfMeasure('json-csv-export-total', 'json-csv-export-start', 'json-csv-export-complete');
            setIsDirty(false);
            setTaskStatus({ state: 'done', label: 'Export complete' });
        } catch (err) {
            if (WorkerManager.isCancelledError(err)) return;
            setError(`Export failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
            setTaskStatus({ state: 'error', label: 'Export failed' });
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(mode === 'json-to-csv' ? 'csv-to-json' : 'json-to-csv');
        handleClear();
    };

    const handleCopyJson = useCallback(async () => {
        if (!jsonPreviewText) return;
        const copied = await copyToClipboard(jsonPreviewText);
        if (!copied) return;
        setIsJsonCopied(true);
        window.setTimeout(() => setIsJsonCopied(false), 1200);
    }, [jsonPreviewText]);

    const handleCancelCurrentTask = useCallback(() => {
        workerRef.current?.cancelAll('Cancelled by user');
        setIsParsing(false);
        setIsLoading(false);
        setShowExportMenu(false);
        setPreviewStartedAt(null);
        setTaskStatus({ state: 'cancelled', label: 'Operation cancelled' });
    }, [setTaskStatus]);

    const canPreview = mode === 'json-to-csv'
        ? Boolean(localInputData.trim() || file)
        : Boolean(file);
    const canRunPreview = canPreview && !previewSafeModeActive;
    const hasSourceInput = mode === 'json-to-csv'
        ? Boolean(localInputData.trim() || file)
        : Boolean(file);

    return (
        <div className="h-full flex flex-col space-y-6">
            {/* Header / Actions Area */}
            <div className="flex items-center justify-between px-1 shrink-0">
                <div className="flex items-center space-x-4">
                    <button
                        onClick={toggleMode}
                        className="btn-secondary h-11 px-5 border-indigo-100 group/mode"
                    >
                        <ArrowRightLeft className="w-4 h-4 text-indigo-500 group-hover/mode:rotate-180 transition-transform duration-500" />
                        <span className="text-sm font-bold">{mode === 'json-to-csv' ? 'JSON to CSV' : 'CSV to JSON'}</span>
                    </button>

                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Delimiter</span>
                        <select
                            value={delimiter}
                            onChange={(e) => setDelimiter(e.target.value)}
                            className="text-xs font-bold text-indigo-600 bg-transparent focus:outline-none cursor-pointer"
                        >
                            <option value=",">Comma (,)</option>
                            <option value=";">Semicolon (;)</option>
                            <option value="	">Tab (\t)</option>
                            <option value="|">Pipe (|)</option>
                        </select>
                    </div>

                    {mode === 'json-to-csv' && (
                        <label className="flex items-center space-x-2 cursor-pointer group bg-white px-4 py-2.5 rounded-xl border border-gray-100 shadow-sm hover:border-indigo-200 transition-all">
                            <input
                                type="checkbox"
                                checked={flatten}
                                onChange={(e) => setFlatten(e.target.checked)}
                                className="w-4 h-4 text-indigo-600 border-gray-300 rounded focus:ring-indigo-500"
                            />
                            <span className="text-xs font-bold text-gray-600 group-hover:text-indigo-600 transition-colors uppercase tracking-widest">Flatten</span>
                        </label>
                    )}
                </div>

                <div className="flex items-center space-x-3">
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Filename</span>
                        <input
                            type="text"
                            value={exportFileName}
                            onChange={(e) => setExportFileName(e.target.value)}
                            className="text-xs font-bold text-gray-700 bg-transparent focus:outline-none w-40"
                            placeholder={mode === 'json-to-csv' ? 'json_data' : 'csv_data'}
                        />
                        {file && (
                            <button
                                type="button"
                                onClick={() => setExportFileName(file.name)}
                                className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700"
                            >
                                Original
                            </button>
                        )}
                    </div>
                    <button onClick={handleClear} className="btn-secondary h-11 px-5">
                        <Trash2 className="w-4 h-4" />
                        <span className="text-sm font-bold">Reset</span>
                    </button>
                    {(isParsing || isLoading) && (
                        <button onClick={handleCancelCurrentTask} className="btn-secondary h-11 px-5">
                            <XCircle className="w-4 h-4 text-red-500" />
                            <span className="text-sm font-bold">Cancel</span>
                        </button>
                    )}

                    {/* Export Dropdown */}
                    <div className="relative">
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={isLoading}
                            className="btn-primary-gradient h-11 px-8 shadow-indigo-100"
                        >
                            {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                            <span className="text-sm">Convert & Export</span>
                            <ChevronDown className="w-3 h-3 ml-1" />
                        </button>

                        {showExportMenu && (
                            <>
                                <div
                                    className="fixed inset-0 z-10"
                                    onClick={() => setShowExportMenu(false)}
                                />
                                <div className="absolute right-0 top-full mt-2 w-56 bg-white rounded-lg shadow-xl border border-gray-200 py-2 z-20">
                                    <button
                                        onClick={() => handleExport('csv')}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        <TableIcon className="w-4 h-4 text-green-600" />
                                        <span className="font-medium">Save as CSV</span>
                                    </button>
                                    <button
                                        onClick={() => handleExport('xlsx')}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        <TableIcon className="w-4 h-4 text-emerald-600" />
                                        <span className="font-medium">Save as Excel (.xlsx)</span>
                                    </button>
                                    <button
                                        onClick={() => handleExport('json')}
                                        className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                    >
                                        <Code className="w-4 h-4 text-indigo-600" />
                                        <span className="font-medium">Save as JSON</span>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            </div>
            <div className="mx-1 -mt-2 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-600">Default: use <span className="font-semibold text-slate-800">Convert & Export</span>. Open preview only when you need to review.</p>
                {previewSafeModeActive && (
                    <p className="text-xs text-amber-700 font-semibold whitespace-nowrap">
                        Safe Mode: preview disabled for large files.
                    </p>
                )}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden min-h-0 gap-8">
                {/* Left Panel: Source */}
                <div className="w-[380px] flex flex-col space-y-4 min-h-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 tracking-tight">Source</h2>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Define your input data</p>
                    </div>

                    <div className="flex-1 flex flex-col premium-card overflow-hidden">
                        {mode === 'json-to-csv' ? (
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="flex-1 relative min-h-0 border-b border-gray-50/50">
                                    {isDirectMode ? (
                                        <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center space-y-6 bg-gray-50/30">
                                            <div className="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center">
                                                <AlertCircle className="w-8 h-8 text-indigo-500" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">High-Performance Mode</p>
                                                <p className="text-xs text-gray-500 mt-2 leading-relaxed px-4">Direct memory access active. Text view disabled to preserve system resources.</p>
                                            </div>
                                            <button
                                                onClick={() => setIsDirectMode(false)}
                                                className="text-[10px] text-indigo-600 font-black uppercase tracking-widest hover:underline"
                                            >
                                                Show text anyway
                                            </button>
                                        </div>
                                    ) : (
                                        <Editor
                                            height="100%"
                                            defaultLanguage="json"
                                            value={localInputData}
                                            onChange={(value) => setLocalInputData(value || '')}
                                            theme="light"
                                            options={{ ...editorOptions, padding: { top: 20, bottom: 20 } }}
                                        />
                                    )}
                                </div>
                                <div className="p-6 bg-gray-50/50 flex flex-col space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Or Import File</span>
                                        {file && mode === 'json-to-csv' && (
                                            <span className="text-[9px] font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded-full">FILE LOADED</span>
                                        )}
                                    </div>
                                    <FileUploader
                                        accept=".json"
                                        onFileSelect={handleFileSelect}
                                        onClear={() => setFile(null)}
                                        currentFile={file}
                                        compact
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="flex-1 flex flex-col items-center justify-start p-6 sm:p-8 gap-5 overflow-y-auto">
                                <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center animate-float">
                                    <Code className="w-10 h-10 text-indigo-600" />
                                </div>
                                <div className="text-center space-y-2 mb-4 px-4">
                                    <p className="font-bold text-gray-900">Upload CSV File</p>
                                    <p className="text-xs text-gray-500 leading-relaxed">Drop your .csv or .txt file here to begin parsing the data structure.</p>
                                </div>
                                <FileUploader
                                    accept=".csv,.txt"
                                    onFileSelect={handleFileSelect}
                                    onClear={() => setFile(null)}
                                    currentFile={file}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Viewport */}
                <div className="flex-1 flex flex-col space-y-4 min-h-0 min-w-0">
                    <div className="flex items-center justify-between px-1">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                                Preview Workspace {activeTotalRows !== null && <span className="text-indigo-600 ml-2 opacity-50 font-normal">({activeTotalRows} Records)</span>}
                            </h2>
                            <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Review Before Export</p>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="bg-gray-100/80 p-1.5 rounded-2xl flex items-center border border-gray-200/50 shadow-inner">
                                <button
                                    onClick={() => setViewType('table')}
                                    className={`flex items-center space-x-2 px-4 h-9 rounded-xl text-[10px] font-black tracking-[0.15em] transition-all ${viewType === 'table' ? 'bg-white text-indigo-600 shadow-lg' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    <TableIcon className="w-3.5 h-3.5" />
                                    <span>TABLE</span>
                                </button>
                                <button
                                    onClick={() => setViewType('json')}
                                    className={`flex items-center space-x-2 px-4 h-9 rounded-xl text-[10px] font-black tracking-[0.15em] transition-all ${viewType === 'json' ? 'bg-white text-indigo-600 shadow-lg' : 'text-gray-500 hover:text-gray-700'
                                        }`}
                                >
                                    <Code className="w-3.5 h-3.5" />
                                    <span>JSON</span>
                                </button>
                            </div>
                            <button
                                onClick={handleCopyJson}
                                disabled={!jsonPreviewText}
                                className="btn-secondary h-10 px-4 disabled:opacity-50"
                                title="Copy transformed JSON"
                            >
                                {isJsonCopied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                                <span className="text-xs font-bold">{isJsonCopied ? 'Copied' : 'Copy JSON'}</span>
                            </button>
                        </div>
                    </div>

                    <div className="flex-1 premium-card overflow-hidden relative bg-white/50">
                        {isParsing && (
                            <div className="absolute inset-0 z-50 bg-white/80 backdrop-blur-md flex flex-col items-center justify-center space-y-6">
                                <div className="relative">
                                    <Loader2 className="w-12 h-12 animate-spin text-indigo-600" />
                                    <div className="absolute inset-0 blur-xl bg-indigo-400/20 animate-pulse" />
                                </div>
                                <p className="text-sm font-black text-gray-900 tracking-[0.2em] uppercase">Processing Data Stream</p>
                                <div className="w-[280px] space-y-2">
                                    <div className="h-2 w-full rounded-full bg-slate-200 overflow-hidden">
                                        <div className="h-full bg-indigo-600 transition-all duration-200" style={{ width: `${previewProgressPct}%` }} />
                                    </div>
                                    <p className="text-xs font-semibold text-slate-600 text-center">
                                        Preview {previewLoadedRows.toLocaleString()} / {previewTargetRows.toLocaleString()} rows
                                        {activeTotalRows ? ` • Total ${activeTotalRows.toLocaleString()} rows` : ''}
                                    </p>
                                    <p className="text-[11px] font-medium text-slate-500 text-center">
                                        {previewRowsPerSec > 0 ? `${previewRowsPerSec.toLocaleString()} rows/s` : 'Calculating speed...'}
                                        {previewEtaLabel && previewRemainingRows > 0 ? ` • ETA ${previewEtaLabel}` : ''}
                                    </p>
                                    <div className="flex justify-center">
                                        <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${etaConfidence === 'Stable'
                                            ? 'bg-emerald-100 text-emerald-700'
                                            : 'bg-amber-100 text-amber-700'
                                            }`}>
                                            ETA {etaConfidence}
                                        </span>
                                    </div>
                                </div>
                            </div>
                        )}

                        {viewType === 'table' ? (
                            <div className="h-full animate-in fade-in zoom-in-95 duration-700">
                                {activeTableData.length > 0 ? (
                                    <TanStackDataTable
                                        data={activeTableData}
                                        onDataChange={handleTableDataChange}
                                        onHeaderChange={() => {
                                            // Column rename handled in DataPreviewTable
                                        }}
                                    />

                                ) : (
                                    <div className="h-full flex items-center justify-center p-6">
                                        <div className="w-full max-w-lg rounded-3xl border border-slate-200/80 bg-gradient-to-br from-white via-slate-50 to-indigo-50/40 p-6 shadow-[0_16px_40px_rgba(15,23,42,0.08)]">
                                            <div className="flex items-center gap-4">
                                                <div className="w-12 h-12 bg-white rounded-2xl flex items-center justify-center border border-slate-200 shadow-sm">
                                                    <TableIcon className="w-5 h-5 text-indigo-600" />
                                                </div>
                                                <div>
                                                    <p className="text-base font-bold text-slate-900 tracking-tight">No preview opened</p>
                                                    <p className="text-sm text-slate-600">Convert directly, or review before export.</p>
                                                </div>
                                            </div>
                                            {!hasSourceInput ? (
                                                <div className="mt-5 grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                                                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                                                        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Default action</p>
                                                        <p className="mt-1 font-semibold text-slate-800">Use Convert & Export</p>
                                                    </div>
                                                    <div className="rounded-2xl border border-slate-200 bg-white/90 px-4 py-3">
                                                        <p className="text-[11px] uppercase tracking-wide font-semibold text-slate-500">Before exporting</p>
                                                        <p className="mt-1 font-semibold text-slate-800">Open Preview & Edit if needed</p>
                                                    </div>
                                                </div>
                                            ) : (
                                                <div className="mt-5 flex flex-wrap gap-3">
                                                    <button
                                                        onClick={() => void handleExport(mode === 'json-to-csv' ? 'csv' : 'json')}
                                                        disabled={isLoading}
                                                        className="btn-primary h-10 px-5 disabled:opacity-50"
                                                    >
                                                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                                        <span className="text-sm font-semibold">Convert & Export</span>
                                                    </button>
                                                    <button
                                                        onClick={validateAndPreview}
                                                        disabled={isParsing || isLoading || !canRunPreview}
                                                        className="btn-secondary h-10 px-5 disabled:opacity-50"
                                                    >
                                                        {isParsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />}
                                                        <span className="text-sm font-semibold">Open Preview & Edit</span>
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ) : (
                            <div className="h-full overflow-auto custom-scrollbar bg-gray-900 animate-in fade-in duration-500">
                                <pre className="font-mono text-[13px] text-gray-300 p-8 min-w-full leading-relaxed selection:bg-indigo-500/30">
                                    {activeTotalRows && activeTotalRows > 1000 && (
                                        <div className="mb-6 p-4 bg-indigo-600/10 border border-indigo-500/20 rounded-2xl text-indigo-400 font-bold text-xs flex items-center space-x-3">
                                            <AlertCircle className="w-4 h-4" />
                                            <span>Displaying head (1,000 records) for low-latency scrolling. Export will contain full dataset.</span>
                                        </div>
                                    )}
                                    {jsonPreviewText || '// No preview opened. Use Convert & Export, or open Preview & Edit first.'}
                                </pre>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Banner */}
            {error && (
                <div className="p-5 bg-red-50 border border-red-100 rounded-3xl animate-in slide-in-from-bottom-6 min-w-[500px] shadow-2xl shadow-red-100/50">
                    <div className="flex items-center space-x-5 text-red-900 text-sm">
                        <div className="bg-red-600 w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-red-200 rotate-3">
                            <AlertCircle className="w-7 h-7" />
                        </div>
                        <div className="flex-1">
                            <p className="font-black uppercase tracking-[0.1em] text-[10px] text-red-600/60 mb-1">Transformation Kernel Fault</p>
                            <p className="font-bold text-red-900 leading-snug">{error}</p>
                        </div>
                        <button onClick={() => setError(null)} className="p-3 hover:bg-red-100 rounded-xl transition-colors">
                            <Trash2 className="w-5 h-5 text-red-400" />
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default JsonCsvConverter;
