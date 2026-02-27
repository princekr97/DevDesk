import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import {
    Loader2,
    Trash2,
    AlertCircle,
    ArrowRightLeft,
    Table as TableIcon,
    Code,
    Eye,
    Save,
    FileSpreadsheet,
    Copy,
    Check,
    XCircle
} from 'lucide-react';
import Editor from '@monaco-editor/react';
import { WorkerManager } from '../../utils/WorkerManager';
import FileUploader from '../../components/FileUploader';
import TanStackDataTable from '../../components/TanStackDataTable';
import type { ExcelConversionRequest, ExcelConversionResponse } from '../../workers/excel.worker';
import { useAppStore } from '../../store/AppContext';
import { copyToClipboard } from '../../utils/jsonUtils';
import { perfMark, perfMeasure } from '../../utils/perf';
import { buildDownloadFileName, resolveExportBaseName } from '../../utils/fileName';
import type { PreviewChunkPayload } from '../../types/worker';
import { CONVERTER_LIMITS } from '../../constants';

type ConversionMode = 'json-to-excel' | 'excel-to-json';
type ViewType = 'json' | 'table';

const JsonExcelConverter: React.FC = () => {
    const { state, setJsonExcel, setTaskStatus } = useAppStore();
    const {
        file,
        inputData,
        mode,
        totalRows,
        isDirty,
        flatten,
        isDirectMode
    } = state.jsonExcel;

    const [resultData, setResultData] = useState<any>(null);
    const [viewType, setViewType] = useState<ViewType>('table');
    const [isJsonCopied, setIsJsonCopied] = useState(false);
    const [localInputData, setLocalInputData] = useState(inputData);
    const [exportFileName, setExportFileName] = useState('');
    const [previewRows, setPreviewRows] = useState<any[]>([]);
    const [previewTotalRows, setPreviewTotalRows] = useState<number | null>(totalRows);

    // State setters tied to global store
    const setFile = (val: File | null) => setJsonExcel({ file: val });
    const setInputData = (val: string) => setJsonExcel({ inputData: val });
    const setMode = (val: ConversionMode) => setJsonExcel({ mode: val });
    const setTotalRows = (val: number | null) => setJsonExcel({ totalRows: val });
    const setIsDirty = (val: boolean) => setJsonExcel({ isDirty: val });
    const setFlatten = (val: boolean) => setJsonExcel({ flatten: val });
    const setIsDirectMode = (val: boolean) => setJsonExcel({ isDirectMode: val });

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
        renderLineHighlight: 'all' as const,
        overviewRulerBorder: false,
        hideCursorInOverviewRuler: true,
    }), []);
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
        && (mode === 'excel-to-json' || isDirectMode || !localInputData.trim())
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
        if (resultData && mode === 'excel-to-json') {
            return JSON.stringify(resultData, null, 2);
        }
        if (activeTableData.length > 0) {
            return JSON.stringify(activeTableData, null, 2);
        }
        return '';
    }, [resultData, mode, activeTableData]);

    const workerRef = useRef<WorkerManager<ExcelConversionRequest, ExcelConversionResponse> | null>(null);

    const initWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new WorkerManager<ExcelConversionRequest, ExcelConversionResponse>(
                () => new Worker(new URL('../../workers/excel.worker.ts', import.meta.url), { type: 'module' })
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
        perfMark('json-excel-preview-start');
        setPreviewStartedAt(Date.now());
        let firstChunkMeasured = false;

        if (mode === 'json-to-excel') {
            if (!localInputData.trim() && !file) {
                setError('Please enter JSON data or upload a file first');
                return;
            }

            // Validate JSON syntax before processing
            if (!isDirectMode && localInputData.trim()) {
                try {
                    JSON.parse(localInputData);
                } catch (e) {
                    setError(`Invalid JSON syntax: ${e instanceof Error ? e.message : 'Please check your JSON format'}`);
                    return;
                }
            }
        } else {
            if (!file) {
                setError('Please upload an Excel file first');
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

        // Add timeout protection
        const timeoutId = setTimeout(() => {
            setIsParsing(false);
            setError('Processing timeout - file may be too large or complex. Try a smaller dataset.');
            setPreviewStartedAt(null);
        }, 30000); // 30 second timeout

        try {
            let data: any;
            let transfer: Transferable[] | undefined;
            const collectedRows: any[] = [];
            let collectedTotalRows: number | null = null;

            if (mode === 'json-to-excel') {
                if (isDirectMode && file) {
                    data = await file.arrayBuffer();
                    transfer = [data];
                } else {
                    data = localInputData;
                }

                await workerRef.current!.postMessage('PARSE_FOR_PREVIEW_STREAM', {
                    data,
                    options: { flatten }
                } as any, transfer, 0, (progressData) => {
                    const payload = progressData as PreviewChunkPayload;
                    if (!Array.isArray(payload?.chunk)) return;
                    if (!firstChunkMeasured && payload.chunk.length > 0) {
                        perfMark('json-excel-preview-first-chunk');
                        perfMeasure('json-excel-first-preview', 'json-excel-preview-start', 'json-excel-preview-first-chunk');
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
                // Excel-to-JSON preview
                data = await file!.arrayBuffer();
                transfer = [data];

                const result = await workerRef.current!.postMessage('CONVERT_EXCEL', {
                    data,
                    type: 'excel-to-json',
                    options: { flatten }
                }, transfer, 0);

                const jsonData = result.data;
                if (!jsonData) {
                    throw new Error('No data received from Excel file');
                }

                setResultData(jsonData);
                const nextPreview = Array.isArray(jsonData) ? jsonData.slice(0, 1000) : [jsonData];
                const nextTotal = Array.isArray(jsonData) ? jsonData.length : 1;
                setPreviewRows(nextPreview);
                setPreviewTotalRows(nextTotal);
                setTotalRows(nextTotal);
                setViewType('table');
                setIsDirty(false);
            }

            perfMark('json-excel-preview-complete');
            perfMeasure('json-excel-preview-total', 'json-excel-preview-start', 'json-excel-preview-complete');
            clearTimeout(timeoutId);
            setTaskStatus({ state: 'done', label: 'Preview ready' });
        } catch (e) {
            if (WorkerManager.isCancelledError(e)) return;
            setError(`Preview failed: ${e instanceof Error ? e.message : 'Invalid data structure'}`);
            setTaskStatus({ state: 'error', label: 'Preview failed' });
            setPreviewStartedAt(null);
        } finally {
            setIsParsing(false);
        }
    }, [localInputData, file, isDirectMode, flatten, initWorker, mode, previewSafeModeActive, safeModeLimitMb, setTaskStatus]);

    const handleFileSelect = async (selectedFile: File) => {
        setFile(selectedFile);
        setError(null);
        setPreviewRows([]);
        setTotalRows(null);
        setPreviewTotalRows(null);
        setPreviewStartedAt(null);

        // Optimization: Files > 1MB use Direct Mode
        if (selectedFile.size > 1 * 1024 * 1024) {
            setIsDirectMode(true);
            setInputData(''); // Clear to save memory
            setLocalInputData('');
        } else {
            setIsDirectMode(false);
            if (mode === 'json-to-excel' && selectedFile.name.toLowerCase().endsWith('.json')) {
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
    };

    const handleConvert = async () => {
        setIsLoading(true);
        setError(null);
        perfMark('json-excel-export-start');
        setTaskStatus({ state: 'running', label: mode === 'json-to-excel' ? 'Converting to Excel' : 'Converting to JSON' });
        workerRef.current?.cancelAll('Superseded by a newer conversion request');
        initWorker();

        // Add timeout protection for conversion
        const timeoutId = setTimeout(() => {
            setIsLoading(false);
            setError('Conversion timeout - file may be too large. Try exporting in smaller batches.');
        }, 60000); // 60 second timeout for conversion

        try {
            const sourceBaseName = resolveExportBaseName({
                preferredName: exportFileName,
                sourceFileName: file?.name,
                fallback: mode === 'json-to-excel' ? 'json_data' : 'excel_data',
            });
            let data: any;
            let transfer: Transferable[] | undefined;
            const workerOptions: any = { flatten };
            const latestTableData = activeTableDataRef.current;

            if (mode === 'json-to-excel') {
                if (latestTableData.length > 0 && isDirty) {
                    data = JSON.stringify(latestTableData);
                } else {
                    if (isDirectMode && file) {
                        data = await file.arrayBuffer();
                        transfer = [data];
                    } else if (localInputData.trim()) {
                        data = localInputData;
                    } else if (file) {
                        data = await file.arrayBuffer();
                        transfer = [data];
                    } else {
                        throw new Error('Please provide JSON data or upload a file');
                    }
                }
            } else {
                if (!file) throw new Error('Please upload an Excel file');
                data = await file.arrayBuffer();
                transfer = [data];
                if (isDirty && latestTableData.length > 0) {
                    workerOptions.overwriteRows = latestTableData;
                }
            }

            const result = await workerRef.current!.postMessage('CONVERT_EXCEL', {
                data,
                type: mode,
                options: workerOptions
            }, transfer, 0);


            if (mode === 'json-to-excel') {
                const blob = new Blob([result.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = buildDownloadFileName(sourceBaseName, 'xlsx');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
                setResultData({ status: 'success', message: 'Excel file exported successfully' });
            } else {
                // Excel-to-JSON: Download result and update preview
                const jsonData = result.data;
                const blob = new Blob([JSON.stringify(jsonData, null, 2)], { type: 'application/json' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = buildDownloadFileName(sourceBaseName, 'json');
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                setResultData(jsonData);
                const nextPreview = Array.isArray(jsonData) ? jsonData.slice(0, 1000) : [jsonData];
                const nextTotal = Array.isArray(jsonData) ? jsonData.length : 1;
                setPreviewRows(nextPreview);
                setPreviewTotalRows(nextTotal);
                setTotalRows(nextTotal);
                setViewType('table');
            }

            perfMark('json-excel-export-complete');
            perfMeasure('json-excel-export-total', 'json-excel-export-start', 'json-excel-export-complete');
            clearTimeout(timeoutId);
            setIsDirty(false);
            setTaskStatus({ state: 'done', label: 'Conversion complete' });
        } catch (err) {
            if (WorkerManager.isCancelledError(err)) return;
            setError(err instanceof Error ? err.message : 'Conversion failed');
            setTaskStatus({ state: 'error', label: 'Conversion failed' });
        } finally {
            setIsLoading(false);
        }
    };

    const toggleMode = () => {
        setMode(mode === 'json-to-excel' ? 'excel-to-json' : 'json-to-excel');
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
        setPreviewStartedAt(null);
        setTaskStatus({ state: 'cancelled', label: 'Operation cancelled' });
    }, [setTaskStatus]);

    const canPreview = mode === 'json-to-excel'
        ? Boolean(localInputData.trim() || file)
        : Boolean(file);
    const canRunPreview = canPreview && !previewSafeModeActive;
    const hasSourceInput = mode === 'json-to-excel'
        ? Boolean(localInputData.trim() || file)
        : Boolean(file);

    return (
        <div className="h-full flex flex-col space-y-4 sm:space-y-6">
            {/* Header / Actions Area */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 px-1 shrink-0">
                <div className="flex flex-wrap items-center gap-2 sm:gap-4">
                    <button
                        onClick={toggleMode}
                        className="btn-secondary h-11 px-5 border-indigo-100 group/mode"
                    >
                        <ArrowRightLeft className="w-4 h-4 text-indigo-500 group-hover/mode:rotate-180 transition-transform duration-500" />
                        <span className="text-sm font-bold">{mode === 'json-to-excel' ? 'JSON to Excel' : 'Excel to JSON'}</span>
                    </button>
                    {mode === 'json-to-excel' && (
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

                <div className="flex items-center gap-2 sm:gap-3 flex-wrap">
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Filename</span>
                        <input
                            type="text"
                            value={exportFileName}
                            onChange={(e) => setExportFileName(e.target.value)}
                            className="text-xs font-bold text-gray-700 bg-transparent focus:outline-none w-40"
                            placeholder={mode === 'json-to-excel' ? 'json_data' : 'excel_data'}
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
                    <button
                        onClick={handleConvert}
                        disabled={isLoading}
                        className="btn-primary-gradient h-11 px-8 shadow-indigo-100"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                        <span className="text-sm">{mode === 'json-to-excel' ? 'Convert & Export Excel' : 'Convert & Export JSON'}</span>
                    </button>
                </div>
            </div>
            <div className="mx-1 -mt-1 flex items-center justify-between gap-3">
                <p className="text-xs text-slate-600">
                    Default: use <span className="font-semibold text-slate-800">{mode === 'json-to-excel' ? 'Convert & Export Excel' : 'Convert & Export JSON'}</span>. Open preview only when you need to review.
                </p>
                {previewSafeModeActive && (
                    <p className="text-xs text-amber-700 font-semibold whitespace-nowrap">
                        Safe Mode: preview disabled for large files.
                    </p>
                )}
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 gap-4 sm:gap-6 lg:gap-8">
                {/* Left Panel: Source */}
                <div className="w-full lg:w-[380px] flex flex-col space-y-3 sm:space-y-4 min-h-0 lg:min-h-full">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 tracking-tight">Source</h2>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Define your input data</p>
                    </div>

                    <div className="flex-1 flex flex-col premium-card overflow-hidden">
                        {mode === 'json-to-excel' ? (
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="flex-1 relative min-h-0 border-b border-gray-50/50">
                                    {isDirectMode ? (
                                        <div className="flex-1 h-full flex flex-col items-center justify-center p-8 text-center space-y-6 bg-gray-50/30">
                                            <div className="w-16 h-16 bg-white rounded-2xl shadow-xl flex items-center justify-center">
                                                <AlertCircle className="w-8 h-8 text-indigo-500" />
                                            </div>
                                            <div>
                                                <p className="font-bold text-gray-900">Direct Memory Path</p>
                                                <p className="text-xs text-gray-500 mt-2 leading-relaxed px-4">To maintain ultra-high performance, text rendering is bypassed for large datasets.</p>
                                            </div>
                                            <button
                                                onClick={() => setIsDirectMode(false)}
                                                className="text-[10px] text-indigo-600 font-black uppercase tracking-widest hover:underline"
                                            >
                                                Force Show Text
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
                                        {file && mode === 'json-to-excel' && (
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
                                    <FileSpreadsheet className="w-10 h-10 text-indigo-600" />
                                </div>
                                <div className="text-center space-y-2 mb-4 px-4">
                                    <p className="font-bold text-gray-900">Upload Spreadsheet</p>
                                    <p className="text-xs text-gray-500 leading-relaxed">Drop your .xlsx file here to begin the transformation process.</p>
                                </div>
                                <FileUploader
                                    accept=".xlsx,.xls"
                                    onFileSelect={handleFileSelect}
                                    onClear={() => setFile(null)}
                                    currentFile={file}
                                />
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Panel: Viewport */}
                <div className="flex-1 flex flex-col space-y-3 sm:space-y-4 min-h-0 min-w-0">
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
                                                        onClick={handleConvert}
                                                        disabled={isLoading}
                                                        className="btn-primary h-10 px-5 disabled:opacity-50"
                                                    >
                                                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                                                        <span className="text-sm font-semibold">{mode === 'json-to-excel' ? 'Convert & Export Excel' : 'Convert & Export JSON'}</span>
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

export default JsonExcelConverter;
