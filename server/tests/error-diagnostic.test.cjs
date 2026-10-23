const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errorDiagnostic, errorDetails } = require('../dist/middleware/error-diagnostic');

test('records nested database codes without leaking error messages or request values', () => {
  const diagnostic = errorDiagnostic({
    name: 'PrismaClientKnownRequestError', code: 'P2022',
    message: 'postgresql://private:password@db.example account@example.com',
    meta: { modelName: 'Account', driverAdapterError: { cause: { originalCode: '42703', originalMessage: 'private database details' } } },
  });
  assert.equal(diagnostic.code, 'P2022');
  assert.equal(diagnostic.databaseCode, '42703');
  assert.doesNotMatch(JSON.stringify(diagnostic), /password|account@|private/);
});
test('detailed traces retain diagnostic context while redacting credentials and submitted data', () => {
  const cause = new Error('SMTP denied recipient@example.com using private-mail-password');
  const error = new Error('Database failed postgresql://user:private-db-password@db.example/test submitted-password', { cause });
  error.code = 'P2022';
  const details = errorDetails(error, {
    body: { email: 'recipient@example.com', password: 'submitted-password' }, query: {}, params: {}, headers: {},
  }, { DATABASE_URL: 'postgresql://user:private-db-password@db.example/test', SMTP_PASSWORD: 'private-mail-password' });
  const encoded = JSON.stringify(details);
  assert.match(encoded, /P2022/);
  assert.match(encoded, /Database failed/);
  assert.match(encoded, /SMTP denied/);
  assert.doesNotMatch(encoded, /private-db-password|private-mail-password|recipient@example.com|submitted-password/);
});
test('error responses include redacted details only when explicitly enabled', () => {
  const { errorHandler } = require('../dist/middleware/error-handler');
  const previous = process.env.API_ERROR_DETAILS;
  const originalLog = console.error;
  const request = { body: { password: 'private-request-password' }, headers: {}, query: {}, params: {} };
  const error = new Error('query failed with private-request-password');
  let payload;
  const response = { status(code) { assert.equal(code, 500); return this; }, json(body) { payload = body; } };
  console.error = () => {};
  try {
    process.env.API_ERROR_DETAILS = 'true';
    errorHandler(error, request, response, () => {});
    assert.match(payload.error.details.stack, /query failed/);
    assert.doesNotMatch(JSON.stringify(payload), /private-request-password/);
    delete process.env.API_ERROR_DETAILS;
    errorHandler(error, request, response, () => {});
    assert.equal(payload.error.details, undefined);
  } finally {
    console.error = originalLog;
    if (previous === undefined) delete process.env.API_ERROR_DETAILS;
    else process.env.API_ERROR_DETAILS = previous;
  }
});
