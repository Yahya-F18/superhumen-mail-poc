/* Shared beacon store.
 *
 * Vercel KV when it is enabled (Vercel injects KV_REST_API_URL / KV_REST_API_TOKEN as soon as you
 * create a KV database in the dashboard). Otherwise the beacons live in the function's memory, which
 * is fine for a live demo but is lost on a cold start — /api/data reports which mode is in use.
 */

const KEY = 'shx_beacons';
const MAX_MEM = 500;

const KV_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const KV_TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

const useKV = !!(KV_URL && KV_TOKEN);

let MEM = [];

async function kvCmd(cmd, ...args) {
  const url = KV_URL + '/' + cmd + '/' + args.map((a) => encodeURIComponent(a)).join('/');
  const r = await fetch(url, { headers: { Authorization: 'Bearer ' + KV_TOKEN } });
  const j = await r.json();
  return j.result;
}

async function push(value) {
  if (useKV) {
    await kvCmd('rpush', KEY, value);
    await kvCmd('ltrim', KEY, '-' + MAX_MEM, '-1');
  } else {
    MEM.push(value);
    if (MEM.length > MAX_MEM) MEM = MEM.slice(-MAX_MEM);
  }
}

async function readAll() {
  if (useKV) return (await kvCmd('lrange', KEY, '0', '-1')) || [];
  return MEM.slice();
}

async function clearAll() {
  if (useKV) await kvCmd('del', KEY);
  MEM = [];
}

module.exports = { push, readAll, clearAll, useKV };
