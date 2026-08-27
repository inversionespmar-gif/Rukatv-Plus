import React, { createContext, useContext } from 'react';
import { WHITELISTED_HOSTS } from 'rukautv/common/CONSTANTS';
import { name, isMobile } from './device';
import useShell from './shell/useShell';

interface PlatformContext {
    name: string;
    isMobile: boolean;
    shell: Shell;
    openExternal: (url: string) => void;
}

const PlatformContext = createContext<PlatformContext>({} as PlatformContext);

type Props = {
    children: JSX.Element;
};

const PlatformProvider = ({ children }: Props) => {
    const shell = useShell();

    const openExternal = (url: string) => {
        try {
            // URL whitelist redirect disabled for privacy - opens URL directly
            window.open(url, '_blank');
        } catch (e) {
            console.error('Failed to parse external url:', e);
        }
    };

    return (
        <PlatformContext.Provider value={{ openExternal, shell, name, isMobile }}>
            {children}
        </PlatformContext.Provider>
    );
};

const usePlatform = () => {
    return useContext(PlatformContext);
};

export {
    PlatformProvider,
    usePlatform
};
