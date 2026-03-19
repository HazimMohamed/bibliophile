const http = require('http');
const https = require('https');

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 8787);
const args = process.argv.slice(2);

function getArgValue(flag) {
  const index = args.indexOf(flag);
  if (index === -1) {
    return '';
  }
  return args[index + 1] || '';
}

const rawTargetBase = (getArgValue('--target-base') || process.env.TARGET_BASE || '').trim();
const targetBase = rawTargetBase.replace(/\/+$/, '');
const targetOrigin = targetBase ? new URL(targetBase) : null;

function withCors(headers = {}) {
  return {
    ...headers,
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': '*',
    'Access-Control-Expose-Headers': '*',
    'Cache-Control': headers['Cache-Control'] || headers['cache-control'] || 'no-store',
  };
}

function writeJson(res, statusCode, body) {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(statusCode, withCors({
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(json),
  }));
  res.end(json);
}

function writeText(res, statusCode, body) {
  res.writeHead(statusCode, withCors({
    'Content-Type': 'text/plain; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  }));
  res.end(body);
}

function getUpstreamUrl(url) {
  if (!targetOrigin) {
    return null;
  }

  const upstreamPath = url.pathname.startsWith('/api')
    ? url.pathname.slice(4) || '/'
    : url.pathname;
  const query = url.search || '';
  return new URL(`${targetBase}${upstreamPath}${query}`);
}

function proxyRequest(req, res, url) {
  const upstreamUrl = getUpstreamUrl(url);
  if (!upstreamUrl) {
    writeJson(res, 503, {
      ok: false,
      error: 'Dev proxy target is not configured.',
      hint: 'Restart the proxy with a target base URL.',
    });
    return;
  }

  const transport = upstreamUrl.protocol === 'https:' ? https : http;
  const headers = { ...req.headers };
  delete headers.host;
  delete headers.origin;
  delete headers.referer;

  const upstreamReq = transport.request(
    upstreamUrl,
    {
      method: req.method,
      headers,
    },
    (upstreamRes) => {
      const responseHeaders = { ...upstreamRes.headers };
      delete responseHeaders['content-length'];
      res.writeHead(upstreamRes.statusCode || 502, withCors(responseHeaders));
      upstreamRes.pipe(res);
    }
  );

  upstreamReq.on('error', (err) => {
    writeJson(res, 502, {
      ok: false,
      error: 'Upstream request failed.',
      message: err.message,
      upstream: upstreamUrl.toString(),
    });
  });

  req.pipe(upstreamReq);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, withCors({
      'Access-Control-Max-Age': '86400',
    }));
    res.end();
    return;
  }

  if (url.pathname === '/' || url.pathname === '/ping') {
    writeJson(res, 200, {
      ok: true,
      message: 'pong from Bibliophile dev proxy',
      method: req.method,
      path: url.pathname,
      query: Object.fromEntries(url.searchParams.entries()),
      hostHeader: req.headers.host || null,
      targetBase: targetBase || null,
      time: new Date().toISOString(),
    });
    return;
  }

  if (!url.pathname.startsWith('/api')) {
    writeText(res, 404, 'Bibliophile dev proxy expects /ping or /api/*');
    return;
  }

  proxyRequest(req, res, url);
});

server.listen(port, host, () => {
  console.log(`Bibliophile dev proxy listening on http://${host}:${port}`);
  console.log(`Proxy target: ${targetBase || '(not configured)'}`);
  console.log('Try GET /ping or forward the app to http://10.0.2.2:8787/api');
});

server.on('error', (err) => {
  console.error('Bibliophile dev proxy failed:', err);
  process.exit(1);
});
