const React = require('react');
const supabase = require('rukautv/common/supabase');

const useSupabaseAuth = () => {
    const [loading, setLoading] = React.useState(false);
    const [error, setError] = React.useState('');

    const requireSupabase = React.useCallback(() => {
        if (!supabase) {
            const err = new Error('Supabase is not configured.');
            setError(err.message);
            throw err;
        }
        return supabase;
    }, []);

    const login = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const client = requireSupabase();
            const { data, error: authError } = await client.auth.signInWithPassword({
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
    }, [requireSupabase]);

    const signup = React.useCallback(async (email, password) => {
        setLoading(true);
        setError('');
        try {
            const client = requireSupabase();
            const { data, error: authError } = await client.auth.signUp({
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
    }, [requireSupabase]);

    const logout = React.useCallback(async () => {
        setLoading(true);
        setError('');
        try {
            const client = requireSupabase();
            const { error: authError } = await client.auth.signOut();
            if (authError) throw authError;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [requireSupabase]);

    const resetPassword = React.useCallback(async (email) => {
        setLoading(true);
        setError('');
        try {
            const client = requireSupabase();
            const { error: authError } = await client.auth.resetPasswordForEmail(email, {
                redirectTo: window.location.origin,
            });
            if (authError) throw authError;
        } catch (err) {
            setError(err.message);
            throw err;
        } finally {
            setLoading(false);
        }
    }, [requireSupabase]);

    return { login, signup, logout, resetPassword, loading, error };
};

module.exports = useSupabaseAuth;
