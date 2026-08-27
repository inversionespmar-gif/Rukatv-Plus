// RukaTv - Worker Initialization Script
// Intercepts fetch calls inside the Web Worker thread (where Stremio WebAssembly Core executes)

const { handleXtreamRequest, handleProxyRequest } = require('./routes/Addons/XtreamAddon/xtreamInterceptor');

if (typeof self !== 'undefined' && self.fetch) {
    const originalWorkerFetch = self.fetch;
    self.fetch = async function (resource, options) {
        const urlStr = typeof resource === 'string' ? resource : (resource && resource.url ? resource.url : '');

        if (urlStr.includes('xtream.internal')) {
            try {
                const response = await handleXtreamRequest(urlStr);
                return response;
            } catch (err) {
                console.error('[Worker] Error handling Xtream request:', err);
                return new Response(JSON.stringify({ err: err.message }), {
                    status: 500,
                    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
                });
            }
        }

        if (urlStr.includes('/proxy/http') || urlStr.includes('/proxy/https')) {
            try {
                const response = await handleProxyRequest(urlStr);
                return response;
            } catch (err) {
                console.error('[Worker] Error handling Xtream proxy request:', err);
            }
        }

        return originalWorkerFetch.call(this, resource, options);
    };
}
