const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\u0000-\u001F]/g;

export const getFileNameWithoutExtension = (fileName: string): string => {
    const trimmed = fileName.trim();
    if (!trimmed) return '';

    const lastDotIndex = trimmed.lastIndexOf('.');
    if (lastDotIndex <= 0) return trimmed;
    return trimmed.slice(0, lastDotIndex);
};

export const sanitizeFileNameBase = (name: string): string => {
    return name.trim().replace(INVALID_FILENAME_CHARS, '_').replace(/\.+$/, '');
};

export const resolveExportBaseName = ({
    preferredName,
    sourceFileName,
    fallback,
}: {
    preferredName?: string | null;
    sourceFileName?: string | null;
    fallback: string;
}): string => {
    const candidates = [preferredName, sourceFileName, fallback];

    for (const candidate of candidates) {
        if (!candidate) continue;
        const normalized = sanitizeFileNameBase(getFileNameWithoutExtension(candidate));
        if (normalized) return normalized;
    }

    return 'export';
};

export const buildDownloadFileName = (baseName: string, extension: string): string => {
    const normalizedBase = sanitizeFileNameBase(getFileNameWithoutExtension(baseName)) || 'export';
    const normalizedExtension = extension.replace(/^\./, '').trim().toLowerCase();
    return normalizedExtension ? `${normalizedBase}.${normalizedExtension}` : normalizedBase;
};
