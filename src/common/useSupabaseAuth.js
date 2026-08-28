const React = require('react');
const { useCore } = require('rukautv/core');
const supabase = require('rukautv/common/supabase');

const useSupabaseAuth = () => {
    const core = useCore();
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');

    const dispatchAuthToCore = React.useCallback((session) => {
        if (session && session.user) {
            core.transport.dispatch({
                action: 'Ctx',
                args: {
                    action: 'Login',
                    args: {
                        email: session.user.email,
                        key: session.access_token,
                    }
                }
            });
        }
    }, [core]);

    const login = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (authError) throw authError;
            dispatchAuthToCore(data.session);
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [dispatchAuthToCore]);

    const signup = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const { data, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });
            if (authError) throw authError;
            if (data.session) {
                dispatchAuthToCore(data.session);
            }
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [dispatchAuthToCore]);

    const logout = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { error: authError } = await supabase.auth.signOut();
            if (authError) throw authError;
            core.transport.dispatch({
                action: 'Ctx',
                args: { action: 'Logout' }
            });
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [core]);

    const resetPassword = React.useCallback(async (email) => {
        setLoading(true);
        setError('');
        try {
            const { error: authError } = await supabase.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (authError) throw authError;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    React.useEffect(() => {
        const restoreSession = async () => {
            const { data: { session } } = await supabase.auth.getSession();
            if (session) {
                dispatchAuthToCore(session);
            }
        };
        restoreSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
            if (session) {
                dispatchAuthToCore(session);
            }
        });

        return () => subscription.unsubscribe();
    }, [dispatchAuthToCore]);

    return { login, signup, logout, resetPassword, loading, error };
};

module.exports = useSupabaseAuth;
