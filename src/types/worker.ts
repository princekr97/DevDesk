// Shared types for Web Worker communication
export interface WorkerMessage<T = unknown> {
    type: string;
    payload: T;
    id?: string;
}

export interface WorkerResponse<T = unknown> {
    type: string;
    payload: T;
    id?: string;
    error?: string;
}

export interface PreviewChunkPayload<T = unknown> {
    chunk: T[];
    chunkIndex: number;
    totalRows?: number;
    done?: boolean;
}

export type WorkerMessageHandler<T = unknown, R = unknown> = (
    payload: T
) => R | Promise<R>;
