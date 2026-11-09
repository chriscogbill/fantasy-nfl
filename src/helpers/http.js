// 500 responses: details go to the server log (routes already console.error
// them); clients only see raw Postgres/driver messages outside production.
function publicError(error) {
  return process.env.NODE_ENV === 'production'
    ? 'Internal server error'
    : (error && error.message) || 'Internal server error';
}

module.exports = { publicError };
