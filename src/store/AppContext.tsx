import React, { createContext, useContext, useState, type ReactNode } from 'react';

/**
 * State for the JSON Structure Viewer feature.
 * 
 * Manages large JSON file visualization with virtualized tree rendering.
 * Supports two modes: standard (for files < 2MB) and Direct Mode (for large files).
 */
interface JsonViewerState {
    /** Raw JSON string input from user or file */
    jsonInput: string;
    /** Parsed tree structure for visualization (null if not yet parsed) */
    jsonTree: any | null;
    /** Metadata about the uploaded file (name and size) */
    fileInfo: { name: string; size: number } | null;
    /** 
     * Direct Mode flag - When true, uses ArrayBuffer transfer to avoid memory cloning.
     * Automatically enabled for files > 2MB.
     */
    isDirectMode: boolean;
    /** Raw File object reference for Direct Mode processing */
    rawFile: File | null;
    /** Parse error details (message and optional line number) */
    error: any | null;
}

/**
 * State for the Diff Checker feature.
 * 
 * Compares two text/JSON inputs with optional whitespace/key sorting.
 */
interface DiffCheckerState {
    /** Left-side text or JSON input */
    text1: string;
    /** Right-side text or JSON input */
    text2: string;
    /** Comparison mode: plain text or structured JSON */
    mode: 'text' | 'json';
    /** When true, whitespace differences are ignored */
    ignoreWhitespace: boolean;
    /** When true (JSON mode only), object keys are sorted before comparison */
    sortKeys: boolean;
}

/**
 * State for JSON ⇄ Excel converter feature.
 */
interface JsonExcelState {
    /** Raw JSON or Excel data as string */
    inputData: string;
    /** Uploaded Excel file reference */
    file: File | null;
    /** Current conversion direction */
    mode: 'json-to-excel' | 'excel-to-json';
    /** Total rows in the dataset */
    totalRows: number | null;
    /** Indicates unsaved changes */
    isDirty: boolean;
    /** When true, nested objects are flattened to table rows */
    flatten: boolean;
    /** Direct Mode for large files (ArrayBuffer transfer) */
    isDirectMode: boolean;
}

/**
 * State for JSON ⇄ CSV converter feature.
 */
interface JsonCsvState {
    /** Raw JSON or CSV data as string */
    inputData: string;
    /** Uploaded CSV file reference */
    file: File | null;
    /** Current conversion direction */
    mode: 'json-to-csv' | 'csv-to-json';
    /** Total rows in the dataset */
    totalRows: number | null;
    /** Indicates unsaved changes */
    isDirty: boolean;
    /** When true, nested objects are flattened to table rows */
    flatten: boolean;
    /** CSV delimiter character (default: comma) */
    delimiter: string;
    /** Direct Mode for large files (ArrayBuffer transfer) */
    isDirectMode: boolean;
}

/**
 * State for Word ⇄ PDF converter feature.
 */
interface WordPdfState {
    /** Uploaded document file */
    file: File | null;
    /** Current conversion direction */
    mode: 'word-to-pdf' | 'pdf-to-word';
    /** Indicates successful conversion */
    success: boolean;
}

/**
 * State for Excel ⇄ CSV converter feature.
 */
interface ExcelCsvState {
    /** Uploaded Excel or CSV file */
    file: File | null;
    /** Total rows in the dataset */
    totalRows: number | null;
    /** Original filename */
    fileName: string;
    /** Indicates unsaved changes */
    isDirty: boolean;
    /** Parsing operation in progress */
    isParsing: boolean;
}

type GlobalTaskState = 'idle' | 'running' | 'done' | 'cancelled' | 'error';

interface GlobalTaskStatus {
    state: GlobalTaskState;
    label: string;
    updatedAt: number;
}

/**
 * Global application state container.
 * 
 * Holds state for all DevDesk features. Each feature gets its own state slice
 * to keep concerns separated and enable independent updates.
 */
interface AppState {
    jsonViewer: JsonViewerState;
    diffChecker: DiffCheckerState;
    jsonExcel: JsonExcelState;
    jsonCsv: JsonCsvState;
    wordPdf: WordPdfState;
    excelCsv: ExcelCsvState;
    taskStatus: GlobalTaskStatus;
}

/**
 * React Context API type for DevDesk's global state.
 * 
 * Provides read access to all feature states and memoized update functions.
 * Update functions are stable (won't cause re-renders) thanks to useCallback.
 * 
 * @example
 * ```tsx
 * const { state, setJsonViewer } = useAppStore();
 * 
 * // Update JSON viewer state
 * setJsonViewer({ jsonInput: '{"key": "value"}' });
 * 
 * // Read current state
 * console.log(state.jsonViewer.jsonTree);
 * ```
 */
interface AppContextType {
    state: AppState;
    setJsonViewer: (data: Partial<JsonViewerState>) => void;
    setDiffChecker: (data: Partial<DiffCheckerState>) => void;
    setJsonExcel: (data: Partial<JsonExcelState>) => void;
    setJsonCsv: (data: Partial<JsonCsvState>) => void;
    setWordPdf: (data: Partial<WordPdfState>) => void;
    setExcelCsv: (data: Partial<ExcelCsvState>) => void;
    setTaskStatus: (data: Partial<GlobalTaskStatus>) => void;
}

const initialJsonViewer: JsonViewerState = {
    jsonInput: JSON.stringify({
        "tool": {
            "name": "DevDesk",
            "tagline": "Developer Data Tools",
            "version": "1.0.0"
        },
        "developer": {
            "name": "Prince Gupta",
            "role": "SSE",
            "focus": ["JSON", "Diff", "Data Conversion"]
        },
        "features": {
            "jsonViewer": true,
            "diffChecker": true,
            "jsonToCsv": true,
            "jsonToExcel": true,
            "wordToPdf": true
        },
        "useCase": {
            "problem": "Switching between multiple websites for daily dev tasks",
            "solution": "One fast, local, privacy-first workspace"
        },
        "🚀_action": "This is just a demo. Clear this editor (or paste your own JSON) to begin your mission."
    }, null, 2),
    jsonTree: null,
    fileInfo: null,
    isDirectMode: false,
    rawFile: null,
    error: null,
};

const initialDiffChecker: DiffCheckerState = {
    text1: '',
    text2: '',
    mode: 'text',
    ignoreWhitespace: false,
    sortKeys: false,
};

const initialJsonExcel: JsonExcelState = {
    inputData: '',
    file: null,
    mode: 'json-to-excel',
    totalRows: null,
    isDirty: false,
    flatten: true,
    isDirectMode: false,
};

const initialJsonCsv: JsonCsvState = {
    inputData: '',
    file: null,
    mode: 'json-to-csv',
    totalRows: null,
    isDirty: false,
    flatten: true,
    delimiter: ',',
    isDirectMode: false,
};

const initialWordPdf: WordPdfState = {
    file: null,
    mode: 'word-to-pdf',
    success: false,
};

const initialExcelCsv: ExcelCsvState = {
    file: null,
    totalRows: null,
    fileName: '',
    isDirty: false,
    isParsing: false,
};

const initialTaskStatus: GlobalTaskStatus = {
    state: 'idle',
    label: '',
    updatedAt: Date.now(),
};

const AppContext = createContext<AppContextType | undefined>(undefined);

export const AppProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [jsonViewer, setJsonViewerState] = useState<JsonViewerState>(initialJsonViewer);
    const [diffChecker, setDiffCheckerState] = useState<DiffCheckerState>(initialDiffChecker);
    const [jsonExcel, setJsonExcelState] = useState<JsonExcelState>(initialJsonExcel);
    const [jsonCsv, setJsonCsvState] = useState<JsonCsvState>(initialJsonCsv);
    const [wordPdf, setWordPdfState] = useState<WordPdfState>(initialWordPdf);
    const [excelCsv, setExcelCsvState] = useState<ExcelCsvState>(initialExcelCsv);
    const [taskStatus, setTaskStatusState] = useState<GlobalTaskStatus>(initialTaskStatus);

    const setJsonViewer = React.useCallback((data: Partial<JsonViewerState>) =>
        setJsonViewerState(prev => ({ ...prev, ...data })), []);

    const setDiffChecker = React.useCallback((data: Partial<DiffCheckerState>) =>
        setDiffCheckerState(prev => ({ ...prev, ...data })), []);

    const setJsonExcel = React.useCallback((data: Partial<JsonExcelState>) =>
        setJsonExcelState(prev => ({ ...prev, ...data })), []);

    const setJsonCsv = React.useCallback((data: Partial<JsonCsvState>) =>
        setJsonCsvState(prev => ({ ...prev, ...data })), []);

    const setWordPdf = React.useCallback((data: Partial<WordPdfState>) =>
        setWordPdfState(prev => ({ ...prev, ...data })), []);

    const setExcelCsv = React.useCallback((data: Partial<ExcelCsvState>) =>
        setExcelCsvState(prev => ({ ...prev, ...data })), []);

    const setTaskStatus = React.useCallback((data: Partial<GlobalTaskStatus>) =>
        setTaskStatusState(prev => ({ ...prev, ...data, updatedAt: Date.now() })), []);

    const value = React.useMemo(() => ({
        state: { jsonViewer, diffChecker, jsonExcel, jsonCsv, wordPdf, excelCsv, taskStatus },
        setJsonViewer,
        setDiffChecker,
        setJsonExcel,
        setJsonCsv,
        setWordPdf,
        setExcelCsv,
        setTaskStatus,
    }), [jsonViewer, diffChecker, jsonExcel, jsonCsv, wordPdf, excelCsv, taskStatus]);

    return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
};

/**
 * Hook to access DevDesk's global application state.
 * 
 * Provides read access to all feature states and memoized update functions.
 * Must be used within an AppProvider component.
 * 
 * **Performance Note:**
 * All setter functions are memoized with useCallback, so passing them as props
 * to child components won't trigger unnecessary re-renders.
 * 
 * @throws {Error} If used outside of AppProvider
 * @returns {AppContextType} State object and setter functions
 * 
 * @example
 * ```tsx
 * function MyComponent() {
 *   const { state, setJsonViewer } = useAppStore();
 *   
 *   const handleParse = () => {
 *     setJsonViewer({ 
 *       jsonInput: '{"hello": "world"}',
 *       error: null 
 *     });
 *   };
 *   
 *   return <div>{state.jsonViewer.jsonTree}</div>;
 * }
 * ```
 */
export const useAppStore = () => {
    const context = useContext(AppContext);
    if (context === undefined) {
        throw new Error('useAppStore must be used within an AppProvider');
    }
    return context;
};
