/* Beacon ingest — the endpoint the payload talks to.
 *
 *   POST /r?part=<label>   with a JSON body   -> 200 + a 1x1 GIF
 *   GET  /r?part=<label>   (image beacons)    -> 200 + a 1x1 GIF
 *
 * It always answers 200 with a GIF, so the payload's transport never sees an error, and it is a
 * CORS-simple request (Content-Type: text/plain), so no preflight is involved.
 */

const { push } = require('../lib/store');

const GIF = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');

function rawBody(req) {
  return new Promise((resolve) => {
    let b = '';
    req.on('data', (c) => { b += c; });
    req.on('end', () => resolve(b));
    req.on('error', () => resolve(''));
  });
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') { res.statusCode = 204; return res.end(); }

  const q = req.query || {};
  const part = q.part || (req.method === 'POST' ? 'report' : 'get');

  let body = '';
  if (req.method === 'POST') {
    body = await rawBody(req);
  } else {
    body = JSON.stringify({ part, query: q });
  }

  let doc = null;
  try { doc = JSON.parse(body); } catch (e) { doc = null; }

  try {
    await push(JSON.stringify({
      t: Date.now(),
      part,
      body: doc !== null ? doc : body,
      ua: req.headers['user-agent'] || '',
    }));
  } catch (e) {
    /* never fail the beacon — the payload must always see a 200 */
  }

  res.setHeader('Content-Type', 'image/gif');
  res.statusCode = 200;
  res.end(GIF);
};
