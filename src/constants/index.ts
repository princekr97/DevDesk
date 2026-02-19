/** Application-wide constant values */

/**
 * Worker Performance Tuning
 * 
 * Controls how often workers yield to the main thread during heavy processing.
 * A smaller value = more responsive UI but slower total processing time.
 */
export const WORKER_YIELD_INTERVAL_MS = 12;

/**
 * JSON Viewer Configuration
 * 
 * Limits and thresholds for the JSON tree visualization feature.
 */
export const JSON_VIEWER = {
    /** 
     * File size threshold for Direct Mode (ArrayBuffer transfer).
     * Files larger than this use zero-copy transfer to avoid memory spikes.
     */
    DIRECT_MODE_THRESHOLD: 2 * 1024 * 1024, // 2 MB

    /** 
     * Maximum tree nodes to render before circuit breaker activates.
     * Prevents browser crashes on extremely large JSON structures.
     */
    MAX_TREE_NODES: 15000,

    /** 
     * Maximum children to display per node before pagination.
     * Large arrays are paginated to maintain scroll performance.
     */
    MAX_CHILDREN_PER_NODE: 200,
} as const;

/**
 * Search Configuration
 * 
 * Debounce timing for search inputs to prevent excessive worker calls.
 */
export const SEARCH_DEBOUNCE_MS = 300;

/**
 * Excel/CSV Processing Limits
 */
export const CONVERTER_LIMITS = {
    /** Maximum rows to preview in the UI */
    MAX_PREVIEW_ROWS: 1000,

    /** Threshold for worker-based processing */
    WORKER_THRESHOLD_ROWS: 500,

    /** Safe mode threshold for file-based preview (bytes) */
    SAFE_MODE_PREVIEW_FILE_BYTES: 8 * 1024 * 1024, // 8 MB

    /** Hard guard: maximum supported rows per conversion request */
    MAX_ROWS: 100000,

    /** Hard guard: maximum supported columns per conversion request */
    MAX_COLUMNS: 500,

    /** Hard guard: maximum serialized value length per cell */
    MAX_CELL_CHARS: 200000,
} as const;
