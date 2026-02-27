import type { WorkerMessage, WorkerResponse, PreviewChunkPayload } from '../types/worker';
import * as XLSX from 'xlsx';

export interface ExcelConversionRequest {
    data: string | ArrayBuffer;
    type?: 'json-to-excel' | 'excel-to-json';
    options?: {
        sheetName?: string;
        flatten?: boolean;
        overwriteRows?: any[];
    };

}

export interface ExcelConversionResponse {
    data: any;
    totalRows?: number;
    fileName?: string;
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

function parseJsonInput(data: string | ArrayBuffer) {
    if (data instanceof ArrayBuffer) {
        const decoder = new TextDecoder();
        return JSON.parse(decoder.decode(data));
    }
    return typeof data === 'string' ? JSON.parse(data) : data;
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

self.onmessage = async (e: MessageEvent<WorkerMessage<ExcelConversionRequest>>) => {
    const { type, payload, id } = e.data;

    try {
        if (type === 'CONVERT_EXCEL') {
            const { data, type: convType, options } = payload;

            if (convType === 'json-to-excel') {
                const jsonData = parseJsonInput(data);
                let processedData = Array.isArray(jsonData) ? jsonData : [jsonData];
                processedData = options?.flatten
                    ? processedData.map((item: any) => flattenObject(item))
                    : sanitizeForTabular(processedData);
                enforceTabularLimits(processedData, 'Excel export');

                const worksheet = XLSX.utils.json_to_sheet(processedData);
                const workbook = XLSX.utils.book_new();
                XLSX.utils.book_append_sheet(workbook, worksheet, options?.sheetName || 'Sheet1');
                const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
                const buffer = excelBuffer instanceof Uint8Array ? excelBuffer.buffer : excelBuffer;

                const response: WorkerResponse<ExcelConversionResponse> = {
                    type: 'CONVERSION_SUCCESS',
                    payload: { data: buffer },
                    id,
                };
                // @ts-ignore - Worker transferable signature
                self.postMessage(response, [buffer]);
            } else if (convType === 'excel-to-json') {
                const workbook = XLSX.read(data, { type: 'array' });
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                const jsonData = XLSX.utils.sheet_to_json(worksheet);
                enforceTabularLimits(jsonData as any[], 'Excel parse');

                if (options?.overwriteRows && Array.isArray(options.overwriteRows)) {
                    const rowLimit = Math.min(options.overwriteRows.length, jsonData.length);
                    for (let i = 0; i < rowLimit; i++) {
                        jsonData[i] = options.overwriteRows[i];
                    }
                }

                const response: WorkerResponse<ExcelConversionResponse> = {
                    type: 'CONVERSION_SUCCESS',
                    payload: { data: jsonData },
                    id,
                };
                self.postMessage(response);
            }
            return;
        }

        if (type === 'PARSE_FOR_PREVIEW' || type === 'PARSE_FOR_PREVIEW_STREAM') {
            const { data, options } = payload as any;
            const jsonData = parseJsonInput(data);
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

        if (type === 'PREVIEW_EXCEL_STREAM') {
            const { data, options } = payload as any;
            const workbook = XLSX.read(data, { type: 'array' });
            const firstSheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[firstSheetName];
            let rows = XLSX.utils.sheet_to_json(worksheet);

            if (options?.flatten) {
                rows = rows.map((item: any) => flattenObject(item));
            }
            enforceTabularLimits(rows as any[], 'Excel preview parse');

            await emitPreviewChunks(rows, id);
            return;
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
