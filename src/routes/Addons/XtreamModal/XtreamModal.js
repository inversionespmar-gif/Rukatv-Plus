// Copyright (C) RukaTv - Xtream Codes Modal Component

const React = require('react');
const PropTypes = require('prop-types');
const { ModalDialog, TextInput } = require('rukautv/components');
const { useCore } = require('rukautv/core');
const { connectAndInstall, syncXtreamAddonsToCore } = require('../XtreamAddon/xtreamAddon');
const styles = require('./XtreamModal.less');

const XtreamModal = ({ onClose, onInstallSuccess }) => {
    const core = useCore();
    const serverRef = React.useRef(null);
    const usernameRef = React.useRef(null);
    const passwordRef = React.useRef(null);

    const [status, setStatus] = React.useState('idle'); // idle | loading | error | success
    const [errorMsg, setErrorMsg] = React.useState('');
    const [progress, setProgress] = React.useState('');

    const handleConnect = React.useCallback(async () => {
        const server = serverRef.current ? serverRef.current.value.trim() : '';
        const username = usernameRef.current ? usernameRef.current.value.trim() : '';
        const password = passwordRef.current ? passwordRef.current.value : '';

        if (!server) {
            setErrorMsg('Ingresa la URL del servidor.');
            setStatus('error');
            return;
        }
        if (!username) {
            setErrorMsg('Ingresa el nombre de usuario.');
            setStatus('error');
            return;
        }
        if (!password) {
            setErrorMsg('Ingresa la contraseña.');
            setStatus('error');
            return;
        }

        setStatus('loading');
        setErrorMsg('');
        setProgress('Conectando al servidor...');

        try {
            const result = await connectAndInstall(server, username, password, (msg) => {
                setProgress(msg);
            });

            await syncXtreamAddonsToCore(core);

            setStatus('success');
            if (onInstallSuccess) {
                onInstallSuccess(result);
            }
        } catch (e) {
            setStatus('error');
            setErrorMsg(e.message || 'Error de conexión. Verifica los datos e intenta de nuevo.');
        }
    }, [core, onInstallSuccess]);

    const handleServerSubmit = React.useCallback(() => {
        if (usernameRef.current) usernameRef.current.focus();
    }, []);

    const handleUsernameSubmit = React.useCallback(() => {
        if (passwordRef.current) passwordRef.current.focus();
    }, []);

    const handlePasswordSubmit = React.useCallback(() => {
        handleConnect();
    }, [handleConnect]);

    const modalButtons = React.useMemo(() => {
        if (status === 'success') {
            return [
                {
                    label: 'Cerrar',
                    props: { onClick: onClose }
                }
            ];
        }
        return [
            {
                className: styles['cancel-button'],
                label: 'Cancelar',
                props: { onClick: onClose, disabled: status === 'loading' }
            },
            {
                className: styles['connect-button'],
                label: status === 'loading' ? 'Conectando...' : 'Conectar',
                props: { onClick: handleConnect, disabled: status === 'loading' }
            }
        ];
    }, [status, onClose, handleConnect]);

    return (
        <ModalDialog
            className={styles['xtream-modal-container']}
            title={'Agregar IPTV Xtream Codes'}
            buttons={modalButtons}
            onCloseRequest={status !== 'loading' ? onClose : null}
        >
            {status === 'success' ? (
                <div className={styles['success-container']}>
                    <div className={styles['success-icon']}>✓</div>
                    <div className={styles['success-title']}>¡Conectado exitosamente!</div>
                    <div className={styles['success-desc']}>
                        Tu servidor IPTV fue agregado. Los canales en vivo, películas y series estarán disponibles en tu catálogo.
                    </div>
                </div>
            ) : (
                <div className={styles['form-container']}>
                    <div className={styles['form-description']}>
                        Ingresa las credenciales de tu proveedor IPTV con protocolo Xtream Codes para agregar canales en vivo, películas y series.
                    </div>

                    <div className={styles['field-group']}>
                        <label className={styles['field-label']}>URL del Servidor</label>
                        <TextInput
                            ref={serverRef}
                            className={styles['text-input']}
                            type={'url'}
                            placeholder={'http://servidor.com:8080'}
                            autoFocus={true}
                            disabled={status === 'loading'}
                            onSubmit={handleServerSubmit}
                        />
                    </div>

                    <div className={styles['field-group']}>
                        <label className={styles['field-label']}>Usuario</label>
                        <TextInput
                            ref={usernameRef}
                            className={styles['text-input']}
                            type={'text'}
                            placeholder={'usuario123'}
                            disabled={status === 'loading'}
                            onSubmit={handleUsernameSubmit}
                        />
                    </div>

                    <div className={styles['field-group']}>
                        <label className={styles['field-label']}>Contraseña</label>
                        <TextInput
                            ref={passwordRef}
                            className={styles['text-input']}
                            type={'password'}
                            placeholder={'••••••••'}
                            disabled={status === 'loading'}
                            onSubmit={handlePasswordSubmit}
                        />
                    </div>

                    {status === 'loading' && (
                        <div className={styles['loading-container']}>
                            <div className={styles['spinner']} />
                            <div className={styles['loading-text']}>{progress}</div>
                        </div>
                    )}

                    {status === 'error' && errorMsg && (
                        <div className={styles['error-container']}>
                            <span className={styles['error-icon']}>⚠</span>
                            <span className={styles['error-text']}>{errorMsg}</span>
                        </div>
                    )}

                    <div className={styles['info-container']}>
                        <span className={styles['info-icon']}>ℹ</span>
                        <span className={styles['info-text']}>
                            Tus credenciales se guardan localmente en este dispositivo y nunca se envían a servidores de RukaTv.
                        </span>
                    </div>
                </div>
            )}
        </ModalDialog>
    );
};

XtreamModal.propTypes = {
    onClose: PropTypes.func.isRequired,
    onInstallSuccess: PropTypes.func
};

module.exports = XtreamModal;

