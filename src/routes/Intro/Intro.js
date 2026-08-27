// Copyright (C) 2017-2023 Smart code 203358507

const React = require('react');
const { useTranslation } = require('react-i18next');
const { useSearchParams, useNavigate } = require('react-router-dom');
const classnames = require('classnames');
const { default: Icon } = require('@stremio/stremio-icons/react');
const Modal = require('rukautv/router/Modal');
const { useCore } = require('rukautv/core');
const { useBinaryState } = require('rukautv/common');
const { default: useRouteFocused } = require('rukautv/common/useRouteFocused');
const { Button, Image, Checkbox } = require('rukautv/components');
const CredentialsTextInput = require('./CredentialsTextInput');
const PasswordResetModal = require('./PasswordResetModal');

const styles = require('./styles');

const SIGNUP_FORM = 'signup';
const LOGIN_FORM = 'login';

const Intro = () => {
    const [queryParams, setQueryParams] = useSearchParams();
    const navigate = useNavigate();
    const core = useCore();
    const { t } = useTranslation();
    const routeFocused = useRouteFocused();
    const emailRef = React.useRef(null);
    const passwordRef = React.useRef(null);
    const confirmPasswordRef = React.useRef(null);
    const termsRef = React.useRef(null);
    const privacyPolicyRef = React.useRef(null);
    const marketingRef = React.useRef(null);
    const errorRef = React.useRef(null);
    const [passwordRestModalOpen, openPasswordRestModal, closePasswordResetModal] = useBinaryState(false);
    const [loaderModalOpen, openLoaderModal, closeLoaderModal] = useBinaryState(false);
    const [state, dispatch] = React.useReducer(
        (state, action) => {
            switch (action.type) {
                case 'set-form':
                    if (state.form !== action.form) {
                        return {
                            form: action.form,
                            email: '',
                            password: '',
                            confirmPassword: '',
                            termsAccepted: false,
                            privacyPolicyAccepted: false,
                            marketingAccepted: false,
                            error: ''
                        };
                    }
                    return state;
                case 'change-credentials':
                    return {
                        ...state,
                        error: '',
                        [action.name]: action.value
                    };
                case 'toggle-checkbox':
                    return {
                        ...state,
                        error: '',
                        [action.name]: !state[action.name]
                    };
                case 'error':
                    return {
                        ...state,
                        error: action.error
                    };
                default:
                    return state;
            }
        },
        {
            form: [LOGIN_FORM, SIGNUP_FORM].includes(queryParams.get('form')) ? queryParams.get('form') : SIGNUP_FORM,
            email: '',
            password: '',
            confirmPassword: '',
            termsAccepted: false,
            privacyPolicyAccepted: false,
            marketingAccepted: false,
            error: ''
        }
    );
    const loginWithFacebook = React.useCallback(() => {
        // Facebook login disabled for privacy
    }, []);
    const cancelLoginWithFacebook = React.useCallback(() => {
        // Facebook login disabled for privacy
    }, []);
    const loginWithApple = React.useCallback(() => {
        // Apple login disabled for privacy
    }, []);
    const cancelLoginWithApple = React.useCallback(() => {
        // Apple login disabled for privacy
    }, []);
    const loginWithEmail = React.useCallback(() => {
        // Login disabled for privacy - credentials would be sent to RukaTv API
        dispatch({ type: 'error', error: 'Login disabled for privacy' });
    }, []);
    const loginAsGuest = React.useCallback(() => {
        if (!state.termsAccepted) {
            dispatch({ type: 'error', error: t('MUST_ACCEPT_TERMS') });
            return;
        }
        navigate('/');
    }, [state.termsAccepted]);
    const signup = React.useCallback(() => {
        // Signup disabled for privacy - credentials would be sent to RukaTv API
        dispatch({ type: 'error', error: 'Signup disabled for privacy' });
    }, []);
    const emailOnChange = React.useCallback((event) => {
        dispatch({
            type: 'change-credentials',
            name: 'email',
            value: event.currentTarget.value
        });
    }, []);
    const emailOnSubmit = React.useCallback(() => {
        passwordRef.current.focus();
    }, []);
    const passwordOnChange = React.useCallback((event) => {
        dispatch({
            type: 'change-credentials',
            name: 'password',
            value: event.currentTarget.value
        });
    }, []);
    const passwordOnSubmit = React.useCallback(() => {
        if (state.form === SIGNUP_FORM) {
            confirmPasswordRef.current.focus();
        } else {
            loginWithEmail();
        }
    }, [state.form, loginWithEmail]);
    const confirmPasswordOnChange = React.useCallback((event) => {
        dispatch({
            type: 'change-credentials',
            name: 'confirmPassword',
            value: event.currentTarget.value
        });
    }, []);
    const confirmPasswordOnSubmit = React.useCallback(() => {
        termsRef.current.focus();
    }, []);
    const toggleTermsAccepted = React.useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'termsAccepted' });
    }, []);
    const togglePrivacyPolicyAccepted = React.useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'privacyPolicyAccepted' });
    }, []);
    const toggleMarketingAccepted = React.useCallback(() => {
        dispatch({ type: 'toggle-checkbox', name: 'marketingAccepted' });
    }, []);
    const switchFormOnClick = React.useCallback(() => {
        const queryParams = new URLSearchParams([['form', state.form === SIGNUP_FORM ? LOGIN_FORM : SIGNUP_FORM]]);
        setQueryParams(queryParams);
    }, [state.form]);
    React.useEffect(() => {
        if ([LOGIN_FORM, SIGNUP_FORM].includes(queryParams.get('form'))) {
            dispatch({ type: 'set-form', form: queryParams.get('form') });
        }
    }, [queryParams]);
    React.useEffect(() => {
        if (routeFocused && typeof state.error === 'string' && state.error.length > 0) {
            errorRef.current.scrollIntoView();
        }
    }, [state.error]);
    React.useEffect(() => {
        if (routeFocused) {
            emailRef.current.focus();
        }
    }, [state.form, routeFocused]);
    React.useEffect(() => {
        const onCoreEvent = (name) => {
            if (name === 'UserAuthenticated') {
                closeLoaderModal();
                if (routeFocused) {
                    navigate('/');
                }
            }
        };
        const onCoreError = (source) => {
            if (source.event === 'UserAuthenticated') {
                closeLoaderModal();
            }
        };
        core.on('event', onCoreEvent);
        core.on('error', onCoreError);
        return () => {
            core.off('event', onCoreEvent);
            core.off('error', onCoreError);
        };
    }, [routeFocused]);
    return (
        <div className={styles['intro-container']}>
            <div className={styles['background-container']} />
            <div className={styles['heading-container']}>
                <div className={styles['logo-container']}>
                    <Image className={styles['logo']} src={require('/assets/images/rukautv_logo.svg')} alt={'RukaTv'} />
                </div>
                <div className={styles['title-container']}>
                    {t('WEBSITE_SLOGAN_NEW_NEW')}
                </div>
                <div className={styles['slogan-container']}>
                    {t('WEBSITE_SLOGAN_ALL')}
                </div>
            </div>
            <div className={styles['content-container']}>
                <div className={styles['form-container']}>
                    <CredentialsTextInput
                        ref={emailRef}
                        className={styles['credentials-text-input']}
                        type={'email'}
                        placeholder={t('EMAIL')}
                        value={state.email}
                        onChange={emailOnChange}
                        onSubmit={emailOnSubmit}
                    />
                    <CredentialsTextInput
                        ref={passwordRef}
                        className={styles['credentials-text-input']}
                        type={'password'}
                        placeholder={t('PASSWORD')}
                        value={state.password}
                        onChange={passwordOnChange}
                        onSubmit={passwordOnSubmit}
                    />
                    {
                        state.form === SIGNUP_FORM ?
                            <React.Fragment>
                                <CredentialsTextInput
                                    ref={confirmPasswordRef}
                                    className={styles['credentials-text-input']}
                                    type={'password'}
                                    placeholder={t('PASSWORD_CONFIRM')}
                                    value={state.confirmPassword}
                                    onChange={confirmPasswordOnChange}
                                    onSubmit={confirmPasswordOnSubmit}
                                />
                                <Checkbox
                                    ref={termsRef}
                                    label={t('READ_AND_AGREE')}
                                    link={t('TOS')}
                                    href={'https://rukatv.com/tos'}
                                    checked={state.termsAccepted}
                                    onChange={toggleTermsAccepted}
                                />
                                <Checkbox
                                    ref={privacyPolicyRef}
                                    label={t('READ_AND_AGREE')}
                                    link={t('PRIVACY_POLICY')}
                                    href={'https://rukatv.com/privacy'}
                                    checked={state.privacyPolicyAccepted}
                                    onChange={togglePrivacyPolicyAccepted}
                                />
                                <Checkbox
                                    ref={marketingRef}
                                    label={t('MARKETING_AGREE')}
                                    checked={state.marketingAccepted}
                                    onChange={toggleMarketingAccepted}
                                />
                            </React.Fragment>
                            :
                            <div className={styles['forgot-password-link-container']}>
                                <Button className={styles['forgot-password-link']} onClick={openPasswordRestModal}>{t('FORGOT_PASSWORD')}</Button>
                            </div>
                    }
                    {
                        state.error && state.error.length > 0 ?
                            <div ref={errorRef} className={styles['error-message']}>{state.error}</div>
                            :
                            null
                    }
                    <Button className={classnames(styles['form-button'], styles['submit-button'])} onClick={state.form === SIGNUP_FORM ? signup : loginWithEmail}>
                        <div className={styles['label']}>{state.form === SIGNUP_FORM ? t('SIGN_UP') : t('LOG_IN')}</div>
                    </Button>
                </div>
                <div className={styles['options-container']}>
                    {
                        state.form === SIGNUP_FORM ?
                            <Button className={classnames(styles['form-button'], styles['login-form-button'])} onClick={switchFormOnClick}>
                                <div className={styles['label']}>{t('LOG_IN')}</div>
                            </Button>
                            :
                            null
                    }
                    {
                        state.form === LOGIN_FORM ?
                            <Button className={classnames(styles['form-button'], styles['signup-form-button'])} onClick={switchFormOnClick}>
                                <div className={styles['label']}>{t('SIGN_UP_EMAIL')}</div>
                            </Button>
                            :
                            null
                    }
                    {
                        state.form === SIGNUP_FORM ?
                            <Button className={classnames(styles['form-button'], styles['guest-login-button'])} onClick={loginAsGuest}>
                                <div className={styles['label']}>{t('GUEST_LOGIN')}</div>
                            </Button>
                            :
                            null
                    }
                </div>
            </div>
            {
                passwordRestModalOpen ?
                    <PasswordResetModal email={state.email} onCloseRequest={closePasswordResetModal} />
                    :
                    null
            }
            {
                loaderModalOpen ?
                    <Modal className={styles['loading-modal-container']}>
                        <div className={styles['loader-container']}>
                            <Icon className={styles['icon']} name={'person'} />
                            <div className={styles['label']}>{t('AUTHENTICATING')}</div>
                            <Button className={styles['button']} onClick={cancelLoginWithFacebook && cancelLoginWithApple}>
                                {t('BUTTON_CANCEL')}
                            </Button>
                        </div>
                    </Modal>
                    :
                    null
            }
        </div>
    );
};

module.exports = Intro;
