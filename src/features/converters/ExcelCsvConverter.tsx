import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    FileSpreadsheet,
    Trash2,
    Download,
    Eye,
    Loader2,
    AlertCircle,
    XCircle,
} from 'lucide-react';
import { useAppStore } from '../../store/AppContext';
import { WorkerManager } from '../../utils/WorkerManager';
import FileUploader from '../../components/FileUploader';
import TanStackDataTable from '../../components/TanStackDataTable';
import { perfMark, perfMeasure } from '../../utils/perf';
import { buildDownloadFileName, resolveExportBaseName } from '../../utils/fileName';
import { CONVERTER_LIMITS } from '../../constants';

const ExcelCsvConverter: React.FC = () => {
    const { state, setExcelCsv, setTaskStatus } = useAppStore();
    const { file, totalRows, fileName, isDirty, isParsing } = state.excelCsv;

    const [error, setError] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [saveMode, setSaveMode] = useState<'csv' | 'xlsx'>('csv');
    const [previewRows, setPreviewRows] = useState<any[]>([]);
    const [previewTotalRows, setPreviewTotalRows] = useState<number | null>(totalRows);
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
    const previewSafeModeActive = Boolean(file && file.size > CONVERTER_LIMITS.SAFE_MODE_PREVIEW_FILE_BYTES);
    const safeModeLimitMb = Math.round(CONVERTER_LIMITS.SAFE_MODE_PREVIEW_FILE_BYTES / (1024 * 1024));

    const activeTableDataRef = useRef(activeTableData);
    useEffect(() => {
        activeTableDataRef.current = previewRows;
    }, [previewRows]);

    const handleTableDataChange = useCallback((newData: any[]) => {
        activeTableDataRef.current = newData;
        setPreviewRows(newData);
        setExcelCsv({ isDirty: true });
    }, [setExcelCsv]);

    const excelWorkerRef = useRef<WorkerManager<any, any> | null>(null);

    const csvWorkerRef = useRef<WorkerManager<any, any> | null>(null);

    const initWorkers = useCallback(() => {
        if (!excelWorkerRef.current) {
            excelWorkerRef.current = new WorkerManager(
                () => new Worker(new URL('../../workers/excel.worker.ts', import.meta.url), { type: 'module' })
            );
        }
        if (!csvWorkerRef.current) {
            csvWorkerRef.current = new WorkerManager(
                () => new Worker(new URL('../../workers/csv.worker.ts', import.meta.url), { type: 'module' })
            );
        }
    }, []);

    useEffect(() => {
        return () => {
            excelWorkerRef.current?.terminate();
            excelWorkerRef.current = null;
            csvWorkerRef.current?.terminate();
            csvWorkerRef.current = null;
        };
    }, []);

    useEffect(() => {
        setPreviewTotalRows(totalRows);
    }, [totalRows]);

    const handleFileSelect = async (selectedFile: File) => {
        setExcelCsv({ file: selectedFile, fileName: selectedFile.name, isDirty: false });
        setError(null);
        setPreviewRows([]);
        setPreviewTotalRows(null);
        setPreviewStartedAt(null);
    };

    const handlePreview = async () => {
        if (!file) return;
        if (previewSafeModeActive) {
            setError(`Preview is disabled in Safe Mode for files above ${safeModeLimitMb}MB. Use Convert & Export.`);
            return;
        }

        perfMark('excel-csv-preview-start');
        setPreviewStartedAt(Date.now());
        setExcelCsv({ isParsing: true });
        setError(null);
        setTaskStatus({ state: 'running', label: 'Preparing preview' });
        excelWorkerRef.current?.cancelAll('Superseded by a newer preview request');
        csvWorkerRef.current?.cancelAll('Superseded by a newer preview request');
        initWorkers();
        setPreviewRows([]);
        setPreviewTotalRows(null);
        setExcelCsv({ totalRows: null });

        // Add timeout protection
        const timeoutId = setTimeout(() => {
            setExcelCsv({ isParsing: false });
            setError('Processing timeout - file may be too large or corrupted. Try a smaller file.');
        }, 30000); // 30 second timeout

        try {
            const extension = file.name.split('.').pop()?.toLowerCase();
            const buffer = await file.arrayBuffer();
            const collectedRows: any[] = [];
            let collectedTotalRows = 0;
            let firstChunkMeasured = false;

            if (extension === 'xlsx' || extension === 'xls') {
                await excelWorkerRef.current!.postMessage('PREVIEW_EXCEL_STREAM', {
                    data: buffer,
                    options: { flatten: true }
                }, [buffer], 0, (progressData) => {
                    const payload = progressData as { chunk?: any[]; totalRows?: number };
                    const chunk = Array.isArray(payload?.chunk) ? payload.chunk : [];
                    if (chunk.length > 0 && !firstChunkMeasured) {
                        perfMark('excel-csv-preview-first-chunk');
                        perfMeasure('excel-csv-first-preview', 'excel-csv-preview-start', 'excel-csv-preview-first-chunk');
                        firstChunkMeasured = true;
                    }
                    if (chunk.length > 0) {
                        collectedRows.push(...chunk);
                        setPreviewRows((prev) => [...prev, ...chunk]);
                    }
                    if (typeof payload?.totalRows === 'number') {
                        collectedTotalRows = payload.totalRows;
                        setPreviewTotalRows(payload.totalRows);
                    }
                });
            } else if (extension === 'csv') {
                await csvWorkerRef.current!.postMessage('PREVIEW_CSV_STREAM', {
                    data: buffer,
                }, [buffer], 0, (progressData) => {
                    const payload = progressData as { chunk?: any[]; totalRows?: number };
                    const chunk = Array.isArray(payload?.chunk) ? payload.chunk : [];
                    if (chunk.length > 0 && !firstChunkMeasured) {
                        perfMark('excel-csv-preview-first-chunk');
                        perfMeasure('excel-csv-first-preview', 'excel-csv-preview-start', 'excel-csv-preview-first-chunk');
                        firstChunkMeasured = true;
                    }
                    if (chunk.length > 0) {
                        collectedRows.push(...chunk);
                        setPreviewRows((prev) => [...prev, ...chunk]);
                    }
                    if (typeof payload?.totalRows === 'number') {
                        collectedTotalRows = payload.totalRows;
                        setPreviewTotalRows(payload.totalRows);
                    }
                });
            } else {
                throw new Error('Unsupported file format. Please upload XLSX or CSV.');
            }

            if (collectedRows.length === 0) {
                throw new Error('No data found in file');
            }

            setExcelCsv({
                totalRows: collectedTotalRows || collectedRows.length,
                isParsing: false
            });
            perfMark('excel-csv-preview-complete');
            perfMeasure('excel-csv-preview-total', 'excel-csv-preview-start', 'excel-csv-preview-complete');
            clearTimeout(timeoutId);
            setTaskStatus({ state: 'done', label: 'Preview ready' });
        } catch (err) {
            if (WorkerManager.isCancelledError(err)) return;
            setError(err instanceof Error ? err.message : 'Failed to parse file');
            setExcelCsv({ isParsing: false });
            setTaskStatus({ state: 'error', label: 'Preview failed' });
            setPreviewStartedAt(null);
        }
    };

    const handleSave = async () => {
        if (!file) {
            setError('Please upload a file first');
            return;
        }

        setIsLoading(true);
        setError(null);
        perfMark('excel-csv-export-start');
        setTaskStatus({ state: 'running', label: `Exporting ${saveMode.toUpperCase()}` });
        excelWorkerRef.current?.cancelAll('Superseded by a newer export request');
        csvWorkerRef.current?.cancelAll('Superseded by a newer export request');
        initWorkers();

        // Add timeout protection for export
        const timeoutId = setTimeout(() => {
            setIsLoading(false);
            setError('Export timeout - file may be too large. Try exporting fewer rows.');
        }, 60000); // 60 second timeout

        try {
            const sourceExtension = file.name.split('.').pop()?.toLowerCase();
            const baseName = resolveExportBaseName({
                preferredName: fileName,
                sourceFileName: file.name,
                fallback: 'converted_data',
            });

            const latestTableData = activeTableDataRef.current;

            if (!isDirty || latestTableData.length === 0) {
                const sourceBuffer = await file.arrayBuffer();

                if (saveMode === 'csv') {
                    if (sourceExtension === 'csv') {
                        const blob = new Blob([sourceBuffer], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = buildDownloadFileName(baseName, 'csv');
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        const parsed = await excelWorkerRef.current!.postMessage('CONVERT_EXCEL', {
                            data: sourceBuffer,
                            type: 'excel-to-json'
                        }, [sourceBuffer], 0);

                        const csvResult = await csvWorkerRef.current!.postMessage('CONVERT_CSV', {
                            data: JSON.stringify(parsed.data),
                            type: 'json-to-csv'
                        }, undefined, 0);

                        const blob = new Blob([csvResult], { type: 'text/csv;charset=utf-8;' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = buildDownloadFileName(baseName, 'csv');
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                } else {
                    if (sourceExtension === 'xlsx') {
                        const blob = new Blob([sourceBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = buildDownloadFileName(baseName, 'xlsx');
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    } else {
                        let rows: any[] = [];

                        if (sourceExtension === 'csv') {
                            const parsed = await csvWorkerRef.current!.postMessage('CONVERT_CSV', {
                                data: sourceBuffer,
                                type: 'csv-to-json'
                            }, [sourceBuffer], 0);
                            rows = Array.isArray(parsed) ? parsed : [parsed];
                        } else {
                            const parsed = await excelWorkerRef.current!.postMessage('CONVERT_EXCEL', {
                                data: sourceBuffer,
                                type: 'excel-to-json'
                            }, [sourceBuffer], 0);
                            rows = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
                        }

                        const excelResult = await excelWorkerRef.current!.postMessage('CONVERT_EXCEL', {
                            data: JSON.stringify(rows),
                            type: 'json-to-excel'
                        }, undefined, 0);

                        const blob = new Blob([excelResult.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = buildDownloadFileName(baseName, 'xlsx');
                        document.body.appendChild(a);
                        a.click();
                        document.body.removeChild(a);
                        URL.revokeObjectURL(url);
                    }
                }
            } else {
                // Modified rows scenario - read from source file and overwrite with preview rows
                const sourceBuffer = await file.arrayBuffer();
                let fullData: any[] = [];

                if (sourceExtension === 'csv') {
                    const parsed = await csvWorkerRef.current!.postMessage('CONVERT_CSV', {
                        data: sourceBuffer,
                        type: 'csv-to-json',
                        options: { overwriteRows: latestTableData }
                    }, [sourceBuffer], 0);
                    fullData = Array.isArray(parsed) ? parsed : [parsed];
                } else {
                    const parsed = await excelWorkerRef.current!.postMessage('CONVERT_EXCEL', {
                        data: sourceBuffer,
                        type: 'excel-to-json',
                        options: { overwriteRows: latestTableData }
                    }, [sourceBuffer], 0);
                    fullData = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
                }

                if (saveMode === 'csv') {
                    const result = await csvWorkerRef.current!.postMessage('CONVERT_CSV', {
                        data: JSON.stringify(fullData),
                        type: 'json-to-csv'
                    }, undefined, 0);

                    const blob = new Blob([result], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = buildDownloadFileName(baseName, 'csv');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } else {
                    const result = await excelWorkerRef.current!.postMessage('CONVERT_EXCEL', {
                        data: JSON.stringify(fullData),
                        type: 'json-to-excel'
                    }, undefined, 0);

                    const blob = new Blob([result.data], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = buildDownloadFileName(baseName, 'xlsx');
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }
            }


            perfMark('excel-csv-export-complete');
            perfMeasure('excel-csv-export-total', 'excel-csv-export-start', 'excel-csv-export-complete');
            clearTimeout(timeoutId);
            setExcelCsv({ isDirty: false });
            setTaskStatus({ state: 'done', label: 'Export complete' });
        } catch (err) {
            if (WorkerManager.isCancelledError(err)) return;
            setError(err instanceof Error ? err.message : 'Export failed');
            setTaskStatus({ state: 'error', label: 'Export failed' });
        } finally {
            setIsLoading(false);
        }
    };

    const handleClear = () => {
        excelWorkerRef.current?.cancelAll('Cleared by user');
        csvWorkerRef.current?.cancelAll('Cleared by user');
        setExcelCsv({
            file: null,
            totalRows: null,
            fileName: '',
            isDirty: false,
            isParsing: false,
        });
        setPreviewRows([]);
        setPreviewTotalRows(null);
        setPreviewStartedAt(null);
        setError(null);
    };

    const handleCancelCurrentTask = useCallback(() => {
        excelWorkerRef.current?.cancelAll('Cancelled by user');
        csvWorkerRef.current?.cancelAll('Cancelled by user');
        setExcelCsv({ isParsing: false });
        setIsLoading(false);
        setPreviewStartedAt(null);
        setTaskStatus({ state: 'cancelled', label: 'Operation cancelled' });
    }, [setExcelCsv, setTaskStatus]);

    const canPreview = Boolean(file) && !previewSafeModeActive;
    const hasSourceInput = Boolean(file);

    return (
        <div className="h-full flex flex-col space-y-6">
            {/* Header / Actions Area */}
            <div className="flex items-center justify-between px-1 shrink-0">
                <div className="flex items-center space-x-4">
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Save As</span>
                        <select
                            value={saveMode}
                            onChange={(e) => setSaveMode(e.target.value as 'csv' | 'xlsx')}
                            className="text-xs font-bold text-indigo-600 bg-transparent focus:outline-none cursor-pointer"
                        >
                            <option value="csv">CSV Document</option>
                            <option value="xlsx">Excel Spreadsheet</option>
                        </select>
                    </div>

                    {file && (
                        <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                            <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Filename</span>
                            <input
                                type="text"
                                value={fileName}
                                onChange={(e) => setExcelCsv({ fileName: e.target.value })}
                                className="text-xs font-bold text-gray-700 bg-transparent focus:outline-none w-40"
                                placeholder="Export name..."
                            />
                            <button
                                type="button"
                                onClick={() => setExcelCsv({ fileName: file.name })}
                                className="text-[10px] font-black uppercase tracking-widest text-indigo-600 hover:text-indigo-700"
                            >
                                Original
                            </button>
                        </div>
                    )}
                </div>

                <div className="flex items-center space-x-3">
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
                        onClick={handleSave}
                        disabled={isLoading || !file}
                        className="btn-primary-gradient h-11 px-8 shadow-indigo-100"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span className="text-sm font-bold">Convert & Export</span>
                    </button>
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
            <div className="flex-1 flex flex-col lg:flex-row overflow-hidden min-h-0 gap-4 sm:gap-6 lg:gap-8">
                {/* Left Panel: Source */}
                <div className="w-full lg:w-[320px] flex flex-col space-y-4 min-h-0">
                    <div>
                        <h2 className="text-xl font-bold text-gray-900 tracking-tight">Source</h2>
                        <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Input Spreadsheet</p>
                    </div>

                    <div className="flex-1 flex flex-col premium-card overflow-hidden">
                        <div className="flex-1 flex flex-col items-center justify-start p-6 sm:p-8 gap-5 overflow-y-auto">
                            <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center animate-float">
                                <FileSpreadsheet className="w-10 h-10 text-indigo-600" />
                            </div>
                            <div className="text-center space-y-2 mb-4 px-4">
                                <p className="font-bold text-gray-900">Upload Data File</p>
                                <p className="text-xs text-gray-500 leading-relaxed">Select any .xlsx, .xls, or .csv file to begin processing.</p>
                            </div>
                            <FileUploader
                                accept=".xlsx,.xls,.csv"
                                onFileSelect={handleFileSelect}
                                onClear={() => setExcelCsv({ file: null })}
                                currentFile={file}
                            />
                        </div>
                    </div>
                </div>

                {/* Right Panel: Viewport */}
                <div className="flex-1 flex flex-col space-y-4 min-h-0 min-w-0">
                    <div className="flex items-center justify-between px-1">
                        <div>
                            <h2 className="text-xl font-bold text-gray-900 tracking-tight">
                                Preview Editor {activeTotalRows !== null && <span className="text-indigo-600 ml-2 opacity-50 font-normal">({activeTotalRows} Records)</span>}
                            </h2>
                            <p className="text-xs text-gray-500 font-medium uppercase tracking-widest mt-0.5">Review Before Export</p>
                        </div>
                        {isDirty && (
                            <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 px-3 py-1 rounded-full font-black tracking-widest animate-pulse">
                                UNSAVED CHANGES
                            </span>
                        )}
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
                                                <FileSpreadsheet className="w-5 h-5 text-indigo-600" />
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
                                                    onClick={handleSave}
                                                    disabled={isLoading || !file}
                                                    className="btn-primary h-10 px-5 disabled:opacity-50"
                                                >
                                                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                                                    <span className="text-sm font-semibold">Convert & Export</span>
                                                </button>
                                                <button
                                                    onClick={handlePreview}
                                                    disabled={!canPreview || isParsing || isLoading}
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

export default ExcelCsvConverter;
