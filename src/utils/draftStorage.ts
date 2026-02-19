const DRAFTS_ENABLED_KEY = 'devdesk:drafts:enabled';
const DRAFT_PREFIX = 'devdesk:draft:';
const PREF_CHANGE_EVENT = 'devdesk:draft-preference-changed';
export const DRAFT_TTL_MS = 60 * 60 * 1000;

type DraftEnvelope<T> = {
    savedAt: number;
    data: T;
};

type LoadDraftResult<T> = {
    data: T | null;
    expired: boolean;
};

const isBrowser = () => typeof window !== 'undefined' && typeof localStorage !== 'undefined';

export const isDraftPersistenceEnabled = (): boolean => {
    if (!isBrowser()) return false;
    return localStorage.getItem(DRAFTS_ENABLED_KEY) === '1';
};

export const setDraftPersistenceEnabled = (enabled: boolean): void => {
    if (!isBrowser()) return;
    localStorage.setItem(DRAFTS_ENABLED_KEY, enabled ? '1' : '0');
    window.dispatchEvent(new CustomEvent(PREF_CHANGE_EVENT, { detail: { enabled } }));
};

export const onDraftPreferenceChange = (listener: (enabled: boolean) => void): (() => void) => {
    if (!isBrowser()) return () => { };

    const handleStorage = (event: StorageEvent) => {
        if (event.key !== DRAFTS_ENABLED_KEY) return;
        listener(event.newValue === '1');
    };
    const handleCustom = (event: Event) => {
        const detail = (event as CustomEvent<{ enabled: boolean }>).detail;
        listener(Boolean(detail?.enabled));
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(PREF_CHANGE_EVENT, handleCustom);

    return () => {
        window.removeEventListener('storage', handleStorage);
        window.removeEventListener(PREF_CHANGE_EVENT, handleCustom);
    };
};

export const saveDraft = <T>(key: string, data: T): void => {
    if (!isBrowser() || !isDraftPersistenceEnabled()) return;
    try {
        const payload: DraftEnvelope<T> = {
            savedAt: Date.now(),
            data,
        };
        localStorage.setItem(`${DRAFT_PREFIX}${key}`, JSON.stringify(payload));
    } catch {
        // Ignore storage quota or serialization failures.
    }
};

export const loadDraftWithStatus = <T>(key: string): LoadDraftResult<T> => {
    if (!isBrowser() || !isDraftPersistenceEnabled()) return { data: null, expired: false };
    try {
        const raw = localStorage.getItem(`${DRAFT_PREFIX}${key}`);
        if (!raw) return { data: null, expired: false };

        const parsed = JSON.parse(raw) as DraftEnvelope<T> | T;
        const isEnvelope = typeof parsed === 'object'
            && parsed !== null
            && 'savedAt' in parsed
            && 'data' in parsed;

        if (!isEnvelope) {
            return { data: parsed as T, expired: false };
        }

        const envelope = parsed as DraftEnvelope<T>;
        if (Date.now() - envelope.savedAt > DRAFT_TTL_MS) {
            localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
            return { data: null, expired: true };
        }

        return { data: envelope.data, expired: false };
    } catch {
        return { data: null, expired: false };
    }
};

export const loadDraft = <T>(key: string): T | null => {
    const result = loadDraftWithStatus<T>(key);
    return result.data;
};

export const clearDraft = (key: string): void => {
    if (!isBrowser()) return;
    localStorage.removeItem(`${DRAFT_PREFIX}${key}`);
};
