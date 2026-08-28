const React = require('react');
const supabase = require('rukautv/common/supabase');

const useSupabaseAuth = () => {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');

    const login = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const { data, error: authError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (authError) throw authError;
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const signup = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const { data, error: authError } = await supabase.auth.signUp({
                email,
                password,
            });
            if (authError) throw authError;
            return data;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

    const logout = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const { error: authError } = await supabase.auth.signOut();
            if (authError) throw authError;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, []);

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

    return { login, signup, logout, resetPassword, loading, error };
};

module.exports = useSupabaseAuth;
