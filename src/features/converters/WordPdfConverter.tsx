import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
    Download,
    Loader2,
    Trash2,
    AlertCircle,
    ArrowRightLeft,
    FileDigit,
    XCircle
} from 'lucide-react';
import { WorkerManager } from '../../utils/WorkerManager';
import FileUploader from '../../components/FileUploader';
import type { WordPdfRequest, WordPdfResponse } from '../../workers/wordPdf.worker';
import { useAppStore } from '../../store/AppContext';
import { buildDownloadFileName, resolveExportBaseName } from '../../utils/fileName';

type ConversionMode = 'word-to-pdf' | 'pdf-to-word';

const WordPdfConverter: React.FC = () => {
    const { state, setWordPdf, setTaskStatus } = useAppStore();
    const { file, mode, success } = state.wordPdf;

    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Helpers
    const setFile = (val: File | null) => setWordPdf({ file: val });
    const setMode = (val: ConversionMode) => setWordPdf({ mode: val });
    const setSuccess = (val: boolean) => setWordPdf({ success: val });

    const workerRef = useRef<WorkerManager<WordPdfRequest, WordPdfResponse> | null>(null);

    const initWorker = useCallback(() => {
        if (!workerRef.current) {
            workerRef.current = new WorkerManager<WordPdfRequest, WordPdfResponse>(
                () => new Worker(new URL('../../workers/wordPdf.worker.ts', import.meta.url), { type: 'module' })
            );
        }
    }, []);

    useEffect(() => {
        return () => {
            workerRef.current?.terminate();
            workerRef.current = null;
        };
    }, []);

    const handleFileSelect = (selectedFile: File) => {
        setFile(selectedFile);
        setError(null);
        setSuccess(false);
    };

    const handleClear = () => {
        workerRef.current?.cancelAll('Cleared by user');
        setFile(null);
        setError(null);
        setSuccess(false);
    };

    const handleConvert = async () => {
        if (!file) {
            setError('Please upload a file first');
            return;
        }

        setIsLoading(true);
        setError(null);
        setSuccess(false);
        setTaskStatus({ state: 'running', label: mode === 'word-to-pdf' ? 'Converting to PDF' : 'Converting to Word' });
        workerRef.current?.cancelAll('Superseded by a newer conversion request');
        initWorker();

        try {
            const data = await file.arrayBuffer();
            const result = await workerRef.current!.postMessage('CONVERT_WORD_PDF', {
                data,
                type: mode,
            }, [data]);

            const blobType = mode === 'word-to-pdf' ? 'application/pdf' : 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
            const extension = mode === 'word-to-pdf' ? 'pdf' : 'docx';
            const sourceBaseName = resolveExportBaseName({
                sourceFileName: file.name,
                fallback: 'converted_document',
            });

            const blob = new Blob([result.data], { type: blobType });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = buildDownloadFileName(sourceBaseName, extension);
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            setSuccess(true);
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
        setMode(mode === 'word-to-pdf' ? 'pdf-to-word' : 'word-to-pdf');
        handleClear();
    };

    const handleCancelCurrentTask = useCallback(() => {
        workerRef.current?.cancelAll('Cancelled by user');
        setIsLoading(false);
        setTaskStatus({ state: 'cancelled', label: 'Operation cancelled' });
    }, [setTaskStatus]);

    return (
        <div className="h-full flex flex-col space-y-6">
            {/* Header / Actions Area */}
            <div className="flex items-center justify-between px-1 shrink-0">
                <div className="flex items-center space-x-4">
                    <div className="flex items-center bg-white px-4 py-2 rounded-xl border border-gray-100 shadow-sm space-x-3">
                        <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest">Operation</span>
                        <button
                            onClick={toggleMode}
                            className="text-xs font-bold text-indigo-600 bg-transparent focus:outline-none flex items-center space-x-2 group"
                        >
                            <span className="group-hover:translate-x-0.5 transition-transform">{mode === 'word-to-pdf' ? 'Word to PDF' : 'PDF to Word'}</span>
                            <ArrowRightLeft className="w-3.5 h-3.5 opacity-50 group-hover:rotate-180 transition-transform duration-500" />
                        </button>
                    </div>
                </div>

                <div className="flex items-center space-x-3">
                    <button onClick={handleClear} className="btn-secondary h-11 px-5">
                        <Trash2 className="w-4 h-4" />
                        <span className="text-sm font-bold">Reset</span>
                    </button>
                    {isLoading && (
                        <button onClick={handleCancelCurrentTask} className="btn-secondary h-11 px-5">
                            <XCircle className="w-4 h-4 text-red-500" />
                            <span className="text-sm font-bold">Cancel</span>
                        </button>
                    )}
                    <button
                        onClick={handleConvert}
                        disabled={isLoading || !file}
                        className="btn-primary-gradient h-11 px-8 shadow-indigo-100"
                    >
                        {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}
                        <span className="text-sm font-bold">{isLoading ? 'Processing...' : 'Run Transformation'}</span>
                    </button>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-gray-50/30 rounded-[2rem] border border-gray-100/50">
                <div className="max-w-2xl w-full space-y-8">
                    <div className="text-center space-y-2">
                        <h2 className="text-3xl font-black text-gray-900 tracking-tight">
                            {mode === 'word-to-pdf' ? 'Word to PDF' : 'PDF to Word'}
                        </h2>
                        <p className="text-gray-500 font-medium italic">High-fidelity document kernel processing</p>
                    </div>

                    <div className="premium-card p-10 space-y-8 bg-white/80 backdrop-blur-xl">
                        <FileUploader
                            accept={mode === 'word-to-pdf' ? '.docx,.doc' : '.pdf'}
                            onFileSelect={handleFileSelect}
                            onClear={() => setFile(null)}
                            currentFile={file}
                        />

                        {success && (
                            <div className="p-5 bg-indigo-50 border border-indigo-100 rounded-2xl flex items-center space-x-4 text-indigo-700 animate-in zoom-in-95 duration-500">
                                <div className="w-12 h-12 bg-indigo-600 rounded-xl flex items-center justify-center text-white shadow-lg shadow-indigo-200">
                                    <FileDigit className="w-6 h-6" />
                                </div>
                                <div>
                                    <p className="font-black uppercase tracking-widest text-[10px] text-indigo-400 mb-0.5">Stream Secure</p>
                                    <p className="font-bold text-sm">Conversion successful! File exported.</p>
                                </div>
                            </div>
                        )}

                        {mode === 'pdf-to-word' && (
                            <div className="p-5 bg-amber-50/50 border border-amber-100 rounded-2xl flex items-start space-x-4 text-amber-900 overflow-hidden relative">
                                <div className="absolute top-0 right-0 w-24 h-24 bg-amber-200/20 blur-3xl -mr-12 -mt-12 rounded-full" />
                                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-1 text-amber-500" />
                                <div className="text-xs relative z-10">
                                    <p className="font-black uppercase tracking-widest mb-1.5 text-amber-600/60">Fidelity Protocol</p>
                                    <p className="font-medium opacity-80 leading-relaxed">
                                        Client-side PDF to Word conversion focuses on text extraction.
                                        Complex layouts and high-res images may undergo normalization.
                                    </p>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Error Display */}
            {error && (
                <div className="p-5 bg-red-50 border border-red-100 rounded-3xl animate-in slide-in-from-bottom-6 mx-auto max-w-xl shadow-2xl shadow-red-100/50">
                    <div className="flex items-center space-x-5 text-red-900 text-sm">
                        <div className="bg-red-600 w-12 h-12 rounded-2xl flex items-center justify-center text-white shadow-lg shadow-red-200 rotate-3">
                            <AlertCircle className="w-7 h-7" />
                        </div>
                        <div className="flex-1">
                            <p className="font-black uppercase tracking-[0.1em] text-[10px] text-red-600/60 mb-1">Process Exception</p>
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

export default WordPdfConverter;
