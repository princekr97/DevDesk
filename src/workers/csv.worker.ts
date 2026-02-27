import type { WorkerMessage, WorkerResponse, PreviewChunkPayload } from '../types/worker';
import Papa from 'papaparse';

export interface CsvConversionRequest {
    data: string | ArrayBuffer;
    type?: 'json-to-csv' | 'csv-to-json';
    options?: {
        delimiter?: string;
        flatten?: boolean;
        overwriteRows?: any[];
    };

}

const FIRST_PREVIEW_CHUNK = 100;
const PREVIEW_CHUNK_SIZE = 200;
const PREVIEW_LIMIT = 1000;
const MAX_ROWS = 100000;
const MAX_COLUMNS = 500;
const MAX_CELL_CHARS = 200000;

function enforceTabularLimits(rows: any[], context: string): void {
    if (rows.length > MAX_ROWS) {
        throw new Error(`${context}: dataset exceeds ${MAX_ROWS.toLocaleString()} rows`);
    }

    const columnSet = new Set<string>();
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        for (const [key, value] of Object.entries(row)) {
            columnSet.add(key);
            if (columnSet.size > MAX_COLUMNS) {
                throw new Error(`${context}: dataset exceeds ${MAX_COLUMNS} columns`);
            }
            if (typeof value === 'string' && value.length > MAX_CELL_CHARS) {
                throw new Error(`${context}: cell value is too large (>${MAX_CELL_CHARS.toLocaleString()} chars)`);
            }
        }
    }
}

function flattenObject(obj: any): any {
    const result: any = {};
    if (obj === null || typeof obj !== 'object') return obj;

    const stack: { current: any; prefix: string }[] = [{ current: obj, prefix: '' }];

    while (stack.length > 0) {
        const { current, prefix } = stack.pop()!;
        for (const k in current) {
            if (!Object.prototype.hasOwnProperty.call(current, k)) continue;
            const value = current[k];
            const newKey = prefix ? `${prefix}.${k}` : k;

            if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
                stack.push({ current: value, prefix: newKey });
            } else if (Array.isArray(value)) {
                result[newKey] = JSON.stringify(value);
            } else {
                result[newKey] = value;
            }
        }
    }

    return result;
}

function sanitizeForTabular(data: any[]): any[] {
    return data.map((item) => {
        if (typeof item !== 'object' || item === null) return { value: item };

        const sanitized: any = {};
        for (const [key, value] of Object.entries(item)) {
            sanitized[key] = value !== null && typeof value === 'object' ? JSON.stringify(value) : value;
        }
        return sanitized;
    });
}

function toStringData(data: string | ArrayBuffer): string {
    if (data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        return decoder.decode(data);
    }
    return data;
}

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

async function emitPreviewChunks(rows: any[], id?: string) {
    const cappedRows = rows.slice(0, PREVIEW_LIMIT);
    const totalRows = rows.length;
    let index = 0;
    let chunkIndex = 0;

    while (index < cappedRows.length) {
        const size = chunkIndex === 0 ? FIRST_PREVIEW_CHUNK : PREVIEW_CHUNK_SIZE;
        const chunk = cappedRows.slice(index, index + size);
        const payload: PreviewChunkPayload = {
            chunk,
            chunkIndex,
            totalRows,
            done: index + size >= cappedRows.length,
        };

        const response: WorkerResponse<PreviewChunkPayload> = {
            type: 'PREVIEW_CHUNK',
            payload,
            id,
        };
        self.postMessage(response);

        index += size;
        chunkIndex += 1;
        await nextTick();
    }

    if (cappedRows.length === 0) {
        const response: WorkerResponse<PreviewChunkPayload> = {
            type: 'PREVIEW_CHUNK',
            payload: { chunk: [], chunkIndex: 0, totalRows, done: true },
            id,
        };
        self.postMessage(response);
    }

    const completeResponse: WorkerResponse<{ totalRows: number; previewRows: number }> = {
        type: 'PREVIEW_COMPLETE',
        payload: { totalRows, previewRows: cappedRows.length },
        id,
    };
    self.postMessage(completeResponse);
}

self.onmessage = async (e: MessageEvent<WorkerMessage<CsvConversionRequest>>) => {
    const { type, payload, id } = e.data;

    try {
        if (type === 'CONVERT_CSV') {
            const { data, type: convType, options } = payload;
            const stringData = toStringData(data);

            if (convType === 'json-to-csv') {
                const jsonData = JSON.parse(stringData);
                const normalized = Array.isArray(jsonData) ? jsonData : [jsonData];
                const processedData = options?.flatten
                    ? normalized.map((item: any) => flattenObject(item))
                    : sanitizeForTabular(normalized);
                enforceTabularLimits(processedData, 'CSV export');

                const csv = Papa.unparse(processedData, {
                    delimiter: options?.delimiter || ',',
                });

                const response: WorkerResponse<string> = {
                    type: 'CONVERSION_SUCCESS',
                    payload: csv,
                    id,
                };
                self.postMessage(response);
            } else if (convType === 'csv-to-json') {
                const results = Papa.parse(stringData, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    delimiter: options?.delimiter || '',
                });
                enforceTabularLimits(results.data as any[], 'CSV parse');

                if (options?.overwriteRows && Array.isArray(options.overwriteRows)) {
                    const rowLimit = Math.min(options.overwriteRows.length, results.data.length);
                    for (let i = 0; i < rowLimit; i++) {
                        results.data[i] = options.overwriteRows[i];
                    }
                }

                const response: WorkerResponse<any[]> = {
                    type: 'CONVERSION_SUCCESS',
                    payload: results.data,
                    id,
                };

                self.postMessage(response);
            }
            return;
        }

        if (type === 'PREVIEW_CSV_STREAM') {
            const { data, options } = payload as any;
            const stringData = toStringData(data);
            const emittedRows: any[] = [];
            const pendingRows: any[] = [];
            let totalRows = 0;
            let chunkIndex = 0;

            const flushChunk = async (force = false) => {
                if (pendingRows.length === 0) return;
                const size = chunkIndex === 0 ? FIRST_PREVIEW_CHUNK : PREVIEW_CHUNK_SIZE;
                if (!force && pendingRows.length < size) return;

                const chunk = pendingRows.splice(0, size);
                const response: WorkerResponse<PreviewChunkPayload> = {
                    type: 'PREVIEW_CHUNK',
                    payload: {
                        chunk,
                        chunkIndex,
                        totalRows,
                        done: false,
                    },
                    id,
                };
                self.postMessage(response);
                chunkIndex += 1;
                await nextTick();
            };

            await new Promise<void>((resolve, reject) => {
                Papa.parse(stringData, {
                    header: true,
                    dynamicTyping: true,
                    skipEmptyLines: true,
                    delimiter: options?.delimiter || '',
                    step: (result, parser) => {
                        totalRows += 1;
                        if (totalRows > MAX_ROWS) {
                            parser.abort();
                            reject(new Error(`Preview parse stopped: dataset exceeds ${MAX_ROWS.toLocaleString()} rows`));
                            return;
                        }
                        if (emittedRows.length >= PREVIEW_LIMIT) return;

                        const row = result.data;
                        if (!row || (typeof row === 'object' && Object.keys(row).length === 0)) return;
                        if (typeof row === 'object' && Object.keys(row).length > MAX_COLUMNS) {
                            parser.abort();
                            reject(new Error(`Preview parse stopped: dataset exceeds ${MAX_COLUMNS} columns`));
                            return;
                        }
                        emittedRows.push(row);
                        pendingRows.push(row);
                        void flushChunk();
                    },
                    complete: () => resolve(),
                    error: (err: Error) => reject(err),
                });
            });

            while (pendingRows.length > 0) {
                await flushChunk(true);
            }

            if (chunkIndex === 0) {
                const response: WorkerResponse<PreviewChunkPayload> = {
                    type: 'PREVIEW_CHUNK',
                    payload: { chunk: [], chunkIndex: 0, totalRows, done: true },
                    id,
                };
                self.postMessage(response);
            }

            const completeResponse: WorkerResponse<{ totalRows: number; previewRows: number }> = {
                type: 'PREVIEW_COMPLETE',
                payload: { totalRows, previewRows: emittedRows.length },
                id,
            };
            self.postMessage(completeResponse);
            return;
        }

        if (type === 'PARSE_FOR_PREVIEW' || type === 'PARSE_FOR_PREVIEW_STREAM') {
            const { data, options } = payload as any;
            const stringData = toStringData(data);
            const jsonData = JSON.parse(stringData);
            let processedData = Array.isArray(jsonData) ? jsonData : [jsonData];

            if (options?.flatten) {
                processedData = processedData.map((item: any) => flattenObject(item));
            }
            enforceTabularLimits(processedData, 'Preview parse');

            if (type === 'PARSE_FOR_PREVIEW_STREAM') {
                await emitPreviewChunks(processedData, id);
                return;
            }

            const previewData = processedData.slice(0, PREVIEW_LIMIT);
            const response: WorkerResponse<any> = {
                type: 'PARSE_SUCCESS',
                payload: {
                    data: previewData,
                    totalRows: processedData.length,
                },
                id,
            };
            self.postMessage(response);
        }
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        const response: WorkerResponse = {
            type: 'CONVERSION_ERROR',
            payload: null,
            id,
            error: errorMessage,
        };
        self.postMessage(response);
    }
};

export { };
