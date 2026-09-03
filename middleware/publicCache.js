/**
 * Edge-cache headers for genuinely public GET responses.
 *
 * Repeat visitors to the store, exercise library and transformations should not
 * pay for a round trip and a cold start every time, so these responses are
 * cacheable — but in the BROWSER, not in a shared cache. See below for why.
 *
 * The other catch it avoids: an admin who has just edited a product must not be
 * shown a stale copy. So the cache is offered ONLY to requests with no
 * Authorization header, signed-in requests are marked no-store, and
 * `Vary: Authorization` keeps the two apart.
 */
/**
 * Why this is `private` and not a shared-cache directive:
 *
 * The response carries Access-Control-Allow-Origin, which is computed from the
 * request's Origin. A shared cache (Vercel's edge) that keys on the URL alone
 * stores whichever copy arrived first. If that first request had no Origin —
 * a health check, a curl, a crawler — the stored copy has no CORS header, and
 * every browser is then served it and blocked. The site reported "cannot reach
 * the server" while the API answered curl perfectly, and it recurred on every
 * deploy because a deploy empties the cache and re-runs the race.
 *
 * `Vary: Origin` is the textbook answer, and it is set here too, but not every
 * edge cache keys on Vary beyond Accept-Encoding, so it cannot be the only
 * guard. `private` removes shared caches from the picture entirely; the
 * browser still caches for max-age, and the in-process cache in utils/cache
 * is what actually absorbs repeat load.
 */
function publicCache(seconds = 60) {
  return (req, res, next) => {
    // Append, never replace: cors() has already put Origin here, and losing
    // it is exactly the bug described above.
    res.vary('Origin');
    res.vary('Authorization');
    if (req.headers.authorization) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', `private, max-age=${Math.min(seconds, 60)}, stale-while-revalidate=300`);
      // A failure must never be cached — otherwise one bad minute is served
      // from the edge to everyone for the next `seconds`.
      const json = res.json.bind(res);
      res.json = (body) => {
        if (res.statusCode >= 400) res.set('Cache-Control', 'no-store');
        return json(body);
      };
    }
    next();
  };
}

module.exports = { publicCache };
