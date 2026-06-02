// Conditional-cache marker for read endpoints.
//
// Express already attaches a (weak) ETag to every res.json() response and turns
// a matching `If-None-Match` request into a bodyless 304. The catch: a browser
// only sends `If-None-Match` if it actually stored the previous response — and
// it won't store anything without a Cache-Control header telling it to.
//
// `no-cache` = "store it, but always revalidate before reuse" → the browser
// re-asks with `If-None-Match` every time and gets a tiny 304 when nothing
// changed (instead of refetching the full JSON), while still seeing fresh data
// the instant it changes.
//
// `private` = only the user's own browser may cache this; shared caches
// (Cloudflare, proxies) must not — these responses are per-user and authed.
//
// GET-only: mutations (POST/PATCH/DELETE) must never be cached.
export function revalidate(req, res, next) {
  if (req.method === 'GET') {
    res.set('Cache-Control', 'private, no-cache');
  }
  next();
}

export default revalidate;
