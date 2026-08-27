declare module '@stremio/stremio-core-web/bridge';

declare module '*.less' {
    const resource: Record<string, string>;
    export = resource;
}

declare module 'rukautv-router';
declare module 'rukautv/components/NavBar';
declare module 'rukautv/components/ModalDialog';
