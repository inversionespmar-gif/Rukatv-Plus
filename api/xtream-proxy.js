export default async function handler(req, res) {
  const target = req.query?.url;
  if (!target || !/^https?:\/\//i.test(target)) return res.status(400).send('Missing url');
  try {
    const upstream = await fetch(target, { headers: { Range: req.headers.range || '' } });
    const type = upstream.headers.get('content-type') || '';
    let body = Buffer.from(await upstream.arrayBuffer());
    if (type.includes('mpegurl') || /\.m3u8(?:$|\?)/i.test(target)) {
      const text = body.toString('utf8');
      const base = new URL(target);
      const rewritten = text.split(/\r?\n/).map(line => {
        if (!line || line.startsWith('#')) return line;
        const absolute = new URL(line, base).href;
        return '/api/xtream-proxy?url=' + encodeURIComponent(absolute);
      }).join('\n');
      body = Buffer.from(rewritten);
      res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
    } else if (type) res.setHeader('Content-Type', type);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Cache-Control', 'no-store');
    res.status(upstream.status).send(body);
  } catch (_) { res.status(502).send('Upstream unavailable'); }
}
