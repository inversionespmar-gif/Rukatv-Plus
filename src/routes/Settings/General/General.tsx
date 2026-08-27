import React, { forwardRef, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useCore } from 'rukautv/core';
import { Button, Toggle } from 'rukautv/components';
import { usePlatform, useToast, useDiscord } from 'rukautv/common';
import { Section, Option, Link } from '../components';
import User from './User';
import useDataExport from './useDataExport';
import styles from './General.less';

type Props = {
    profile: Profile,
};

const General = forwardRef<HTMLDivElement, Props>(({ profile }: Props, ref) => {
    const { t } = useTranslation();
    const core = useCore();
    const platform = usePlatform();
    const toast = useToast();
    const discord = useDiscord();
    const [dataExport, loadDataExport] = useDataExport();

    const [traktAuthStarted, setTraktAuthStarted] = useState(false);

    const isTraktAuthenticated = useMemo(() => {
        const trakt = profile?.auth?.user?.trakt;
        return trakt && (Date.now() / 1000) < (trakt.created_at + trakt.expires_in);
    }, [profile.auth]);

    const onExportData = useCallback(() => {
        loadDataExport();
    }, []);

    const onCalendarSubscribe = useCallback(() => {
        // Calendar subscribe disabled for privacy - would open strem.io with user ID
    }, []);

    const onToggleTrakt = useCallback(() => {
        // Trakt auth disabled for privacy - would open strem.io with user ID
    }, []);

    const discordToggle = useMemo(() => ({
        checked: profile.settings.discordRpcEnabled === true,
        onClick: () => {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'UpdateSettings',
                    args: {
                        ...profile.settings,
                        discordRpcEnabled: !profile.settings.discordRpcEnabled
                    }
                }
            });
        }
    }), [profile.settings]);

    useEffect(() => {
        if (dataExport.exportUrl) {
            platform.openExternal(dataExport.exportUrl);
        }
    }, [dataExport.exportUrl]);

    useEffect(() => {
        if (isTraktAuthenticated && traktAuthStarted) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'InstallTraktAddon'
                }
            });
            setTraktAuthStarted(false);
        }
    }, [isTraktAuthenticated, traktAuthStarted]);

    return <>
        <Section ref={ref}>
            <User profile={profile} />
        </Section>

        <Section>
            {
                profile?.auth?.user &&
                    <Link
                        label={t('SETTINGS_DATA_EXPORT')}
                        onClick={onExportData}
                    />
            }
            {
                profile?.auth?.user &&
                    <Link
                        label={t('SETTINGS_SUBSCRIBE_CALENDAR')}
                        onClick={onCalendarSubscribe}
                    />
            }
            <Link
                label={t('SETTINGS_SUPPORT')}
                href={'https://rukatv.com/support'}
            />
            <Link
                label={t('SETTINGS_SOURCE_CODE')}
                href={`https://github.com/rukautv/rukatv-web/tree/${process.env.COMMIT_HASH}`}
            />
            <Link
                label={t('TERMS_OF_SERVICE')}
                href={'https://rukatv.com/tos'}
            />
            <Link
                label={t('PRIVACY_POLICY')}
                href={'https://rukatv.com/privacy'}
            />
            {
                profile?.auth?.user &&
                    <Link
                        label={t('SETTINGS_ACC_DELETE')}
                        href={'https://rukatv.com/delete-account'}
                    />
            }
            {
                profile?.auth?.user?.email &&
                    <Link
                        label={t('SETTINGS_CHANGE_PASSWORD')}
                        href={`https://www.strem.io/reset-password/${profile.auth.user.email}`}
                    />
            }
            <Option className={styles['trakt-container']} icon={'trakt'} label={t('SETTINGS_TRAKT')}>
                <Button className={'button'} title={isTraktAuthenticated ? t('LOG_OUT') : t('SETTINGS_TRAKT_AUTHENTICATE')} disabled={profile.auth === null} tabIndex={-1} onClick={onToggleTrakt}>
                    {isTraktAuthenticated ? t('LOG_OUT') : t('SETTINGS_TRAKT_AUTHENTICATE')}
                </Button>
            </Option>
            {
                discord.available &&
                    <Option className={styles['discord-container']} icon={'discord'} label={'SETTINGS_DISCORD'}>
                        <Toggle
                            tabIndex={-1}
                            {...discordToggle}
                        />
                    </Option>
            }
        </Section>
    </>;
});

export default General;
