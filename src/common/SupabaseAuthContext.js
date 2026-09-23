const React = require('react');
const supabase = require('rukautv/common/supabase');
const { useCore } = require('rukautv/core');
const { initSupabaseSync } = require('./supabaseLibrarySync');

const SupabaseAuthContext = React.createContext({
    user: null,
    session: null,
});

const SupabaseAuthProvider = ({ children }) => {
    const [user, setUser] = React.useState(null);
    const [session, setSession] = React.useState(null);
    const core = useCore();

    React.useEffect(() => {
        if (!supabase) {
            return;
        }

        const initSession = async () => {
            const { data: { session: currentSession } } = await supabase.auth.getSession();
            if (currentSession) {
                setSession(currentSession);
                setUser(currentSession.user);
            }
        };
        initSession();

        const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, currentSession) => {
            setSession(currentSession);
            setUser(currentSession ? currentSession.user : null);
        });

        return () => subscription.unsubscribe();
    }, []);

    React.useEffect(() => {
        if (!user || !user.id || !core) {
            return;
        }

        const cleanup = initSupabaseSync(user.id, core);
        return () => {
            if (cleanup) cleanup();
        };
    }, [user, core]);

    return (
        <SupabaseAuthContext.Provider value={{ user, session }}>
            {children}
        </SupabaseAuthContext.Provider>
    );
};

const useSupabaseAuthContext = () => React.useContext(SupabaseAuthContext);

module.exports = { SupabaseAuthProvider, useSupabaseAuthContext };
