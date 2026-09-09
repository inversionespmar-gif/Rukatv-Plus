// Install the same addon-only interceptor before Stremio's WebAssembly worker starts.
const { setupXtreamInterceptor } = require('./routes/Addons/XtreamAddon/xtreamInterceptor');

setupXtreamInterceptor();
