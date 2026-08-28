const React = require('react');
const supabase = require('rukautv/common/supabase');

const SupabaseAuthContext = React.createContext({
    user: null,
    session: null,
});

const SupabaseAuthProvider = ({ children }) => {
    const [user, setUser] = React.useState(null);
    const [session, setSession] = React.useState(null);

    React.useEffect(() => {
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

    return (
        <SupabaseAuthContext.Provider value={{ user, session }}>
            {children}
        </SupabaseAuthContext.Provider>
    );
};

const useSupabaseAuthContext = () => React.useContext(SupabaseAuthContext);

module.exports = { SupabaseAuthProvider, useSupabaseAuthContext };
