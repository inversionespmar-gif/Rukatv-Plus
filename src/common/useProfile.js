// Copyright (C) 2017-2023 Smart code 203358507

const useModelState = require('rukautv/common/useModelState');
const { useSupabaseAuthContext } = require('rukautv/common/SupabaseAuthContext');

const map = (ctx) => ({
    ...ctx.profile,
    settings: {
        ...ctx.profile.settings,
        streamingServerWarningDismissed: new Date(
            typeof ctx.profile.settings.streamingServerWarningDismissed === 'string' ?
                ctx.profile.settings.streamingServerWarningDismissed
                :
                NaN
        )
    }
});

const useProfile = () => {
    const coreProfile = useModelState({ model: 'ctx', map });
    const { user } = useSupabaseAuthContext();

    if (user) {
        return {
            ...coreProfile,
            auth: {
                key: user.id,
                user: {
                    _id: user.id,
                    avatar: user.user_metadata?.avatar_url || '',
                    email: user.email || '',
                    trakt: {
                        access_token: '',
                        created_at: 0,
                        expires_in: 0,
                    },
                    isNewUser: false,
                },
            },
        };
    }

    return coreProfile;
};

module.exports = useProfile;
