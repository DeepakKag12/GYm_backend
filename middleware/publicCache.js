/**
 * Edge-cache headers for genuinely public GET responses.
 *
 * On Vercel, `s-maxage` lets the CDN answer repeat requests without waking the
 * function at all — which removes both the round trip and the cold start for
 * anonymous visitors browsing the store, exercise library and transformations.
 *
 * The catch it avoids: an admin who has just edited a product must not be shown
 * a stale copy. So the cache is offered ONLY to requests with no Authorization
 * header, signed-in requests are marked no-store, and `Vary: Authorization`
 * tells every cache in between to keep the two apart.
 */
function publicCache(seconds = 60) {
  return (req, res, next) => {
    res.set('Vary', 'Authorization');
    if (req.headers.authorization) {
      res.set('Cache-Control', 'no-store');
    } else {
      res.set('Cache-Control', `public, max-age=30, s-maxage=${seconds}, stale-while-revalidate=300`);
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
