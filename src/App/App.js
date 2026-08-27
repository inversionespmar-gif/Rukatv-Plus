// Copyright (C) 2017-2023 Smart code 203358507

require('spatial-navigation-polyfill');
const React = require('react');
const { useTranslation } = require('react-i18next');
const { useNavigate } = require('react-router');
const { useCore } = require('rukautv/core');
const { Routes } = require('rukautv-router');
const { Chromecast, ServicesProvider, GamepadProvider } = require('rukautv/services');
const { FullscreenProvider, ToastProvider, TooltipProvider, ShortcutsProvider, DiscordProvider, CONSTANTS, useBinaryState, useProfile, withCoreSuspender, onFileDrop, usePlatform } = require('rukautv/common');
const ServicesToaster = require('./ServicesToaster');
const SearchParamsHandler = require('./SearchParamsHandler');
const DeepLinkHandler = require('./DeepLinkHandler');
const { default: UpdaterBanner } = require('./UpdaterBanner');
const { default: ShortcutsModal } = require('./ShortcutsModal');
const { default: GamepadModal } = require('./GamepadModal');
const styles = require('./styles');

const { syncXtreamAddonsToCore } = require('../routes/Addons/XtreamAddon/xtreamAddon');

const ProtectedRoutes = withCoreSuspender(Routes);
const NAVIGATE_TABS_ROUTES = ['/', '/discover', '/library', '/calendar', '/addons', '/settings'];

const App = () => {
    const core = useCore();
    const profile = useProfile();
    const { i18n } = useTranslation();

    React.useEffect(() => {
        syncXtreamAddonsToCore(core);
    }, [core]);
    const { shell } = usePlatform();
    const navigate = useNavigate();
    const [gamepadSupportEnabled, setGamepadSupportEnabled] = React.useState(false);
    const services = React.useMemo(() => {
        return {
            chromecast: { active: false, start: () => {}, stop: () => {}, on: () => {}, off: () => {}, transport: { setOptions: () => {} } },
        };
    }, []);
    const [shortcutModalOpen,, closeShortcutsModal, toggleShortcutModal] = useBinaryState(false);
    const [gamepadModalOpen,, closeGamepadModal, toggleGamepadModal] = useBinaryState(false);

    const onShortcut = React.useCallback((name, combo, key) => {
        switch (name) {
            case 'shortcuts':
                toggleShortcutModal();
                break;
            case 'gamepadGuide':
                toggleGamepadModal();
                break;
            case 'navigateSearch':
                navigate('/search');
                break;
            case 'navigateTabs': {
                const index = Number(key) - 1;
                if (index >= 0 && index < NAVIGATE_TABS_ROUTES.length)
                    navigate(NAVIGATE_TABS_ROUTES[index]);
                break;
            }
            case 'navigateHistory':
                navigate(combo === 0 ? -1 : 1);
                break;
        }
    }, [toggleShortcutModal, toggleGamepadModal]);

    onFileDrop(['application/x-bittorrent'], (file, buffer) => {
        core.transport.dispatch({
            action: 'StreamingServer',
            args: {
                action: 'CreateTorrent',
                args: Array.from(new Uint8Array(buffer))
            }
        });
    });

    React.useEffect(() => {
        let prevPath = window.location.hash.slice(1);
        const onLocationHashChange = () => {
            core.transport.analytics({
                event: 'LocationPathChanged',
                args: { prevPath }
            });
            prevPath = window.location.hash.slice(1);
        };
        window.addEventListener('hashchange', onLocationHashChange);
        return () => {
            window.removeEventListener('hashchange', onLocationHashChange);
        };
    }, []);

    React.useEffect(() => {
        // Chromecast disabled for privacy
    }, []);

    React.useEffect(() => {
        const onOpenMedia = (data) => {
            try {
                const { protocol, hostname, pathname, searchParams } = new URL(data);
                if (protocol === CONSTANTS.PROTOCOL) {
                    if (hostname.length) {
                        const transportUrl = `https://${hostname}${pathname}`;
                        navigate(`/addons?addon=${encodeURIComponent(transportUrl)}`);
                    } else {
                        navigate(`${pathname}?${searchParams.toString()}`);
                    }
                }
            } catch (e) {
                console.error('Failed to open media:', e);
            }
        };

        shell.on('open-media', onOpenMedia);
        if (shell.state.initialized) {
            shell.send('app-ready');
        }

        return () => shell.off('open-media', onOpenMedia);
    }, [shell.state.initialized]);

    React.useEffect(() => {
        if (typeof profile.settings?.interfaceLanguage === 'string') {
            i18n.changeLanguage(profile.settings.interfaceLanguage);
        }

        if (typeof profile.settings?.gamepadSupport === 'boolean') {
            setGamepadSupportEnabled(profile.settings.gamepadSupport);
        }

        if (profile.settings?.quitOnClose && shell.state.windowClosed) {
            shell.send('quit');
        }
    }, [profile.settings, shell.state.windowClosed]);

    React.useEffect(() => {
        // API calls disabled for privacy
    }, []);

    return (
        <ServicesProvider services={services}>
            <ToastProvider className={styles['toasts-container']}>
                <TooltipProvider className={styles['tooltip-container']}>
                    <GamepadProvider enabled={gamepadSupportEnabled} onGuide={toggleGamepadModal}>
                        <ShortcutsProvider onShortcut={onShortcut}>
                            <FullscreenProvider>
                                <DiscordProvider>
                                    {
                                        shortcutModalOpen && <ShortcutsModal onClose={closeShortcutsModal}/>
                                    }
                                    {
                                        gamepadModalOpen && <GamepadModal onClose={closeGamepadModal}/>
                                    }
                                    <ServicesToaster />
                                    <SearchParamsHandler />
                                    <DeepLinkHandler />
                                    <UpdaterBanner className={styles['updater-banner-container']} />
                                    <ProtectedRoutes />
                                </DiscordProvider>
                            </FullscreenProvider>
                        </ShortcutsProvider>
                    </GamepadProvider>
                </TooltipProvider>
            </ToastProvider>
        </ServicesProvider>
    );
};

module.exports = withCoreSuspender(App);
