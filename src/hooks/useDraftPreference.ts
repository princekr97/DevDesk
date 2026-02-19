import React from 'react';
import {
    isDraftPersistenceEnabled,
    onDraftPreferenceChange,
    setDraftPersistenceEnabled,
} from '../utils/draftStorage';

export const useDraftPreference = () => {
    const [enabled, setEnabled] = React.useState<boolean>(() => isDraftPersistenceEnabled());

    React.useEffect(() => {
        return onDraftPreferenceChange((value) => setEnabled(value));
    }, []);

    const updateEnabled = React.useCallback((value: boolean) => {
        setDraftPersistenceEnabled(value);
        setEnabled(value);
    }, []);

    return { enabled, setEnabled: updateEnabled };
};
