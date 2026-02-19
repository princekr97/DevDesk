import { logger } from './logger';

const PERF_DEBUG = import.meta.env.DEV;

export const perfMark = (name: string) => {
    if (typeof performance === 'undefined') return;
    performance.mark(name);
};

export const perfMeasure = (name: string, startMark: string, endMark: string) => {
    if (typeof performance === 'undefined') return;
    try {
        performance.measure(name, startMark, endMark);
        const entries = performance.getEntriesByName(name);
        const latest = entries[entries.length - 1];
        if (latest && PERF_DEBUG) {
            logger.debug(`[perf] ${name}: ${latest.duration.toFixed(2)}ms`);
        }
    } catch {
        // Ignore measure errors when marks are missing.
    }
};
