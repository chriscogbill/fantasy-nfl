// For UNAUTHENTICATED requests, strip email-bearing fields from JSON
// responses. Team/league views are public-by-design (spectator profiles),
// but must not expose players' email addresses to anonymous callers —
// which was allowing full email enumeration across the app. Logged-in
// requests are untouched (the frontend keys player identity on
// user_email, so authenticated users still receive it).
//
// Applied at the router level, so it covers every current and future
// read route in one place.

const EMAIL_KEY = /email$/i; // user_email, admin_email, league_admin_email, …
const EXTRA_KEYS = new Set(['created_by', 'createdBy']); // hold raw emails here

function scrub(value) {
  if (Array.isArray(value)) {
    for (const item of value) scrub(item);
  } else if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (EMAIL_KEY.test(key) || EXTRA_KEYS.has(key)) {
        delete value[key];
      } else {
        scrub(value[key]);
      }
    }
  }
  return value;
}

function stripPiiForAnon(req, res, next) {
  // Authenticated (has a session email) → leave the response as-is.
  if (req.session && req.session.email) return next();

  const originalJson = res.json.bind(res);
  res.json = (body) => originalJson(scrub(body));
  next();
}

module.exports = { stripPiiForAnon };
