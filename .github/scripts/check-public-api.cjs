const assert = require('node:assert/strict');
const config = require('../public-api-config.json');

async function checkPublicApi(request = fetch) {
  const base = `https://${config.alias}`;
  const options = { redirect: 'manual', signal: AbortSignal.timeout(60000) };
  const response = await request(`${base}/api/auth/register`, {
    ...options, method: 'OPTIONS', headers: {
      Origin: config.frontendOrigin,
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'content-type',
    },
  });
  assert.equal(response.status, 204, 'Public registration preflight must return 204 without a sign-in redirect');
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
  assert.equal(response.headers.get('access-control-allow-credentials'), null);
  assert.ok(response.headers.get('access-control-allow-methods')?.split(',').map(v => v.trim()).includes('POST'));
  assert.ok(response.headers.get('access-control-allow-headers')?.toLowerCase().split(',').map(v => v.trim()).includes('content-type'));
  const health = await request(`${base}/health`, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  assert.equal(health.status, 200, 'Public health check must succeed');
  assert.equal((await health.json()).status, 'ok');
  const login = await request(`${base}/api/auth/login`, {
    ...options, method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'deployment-probe-noaccount@example.invalid', password: 'Deployment-Probe-Only-2026' }),
  });
  assert.equal(login.status, 401, 'Database-backed login probe must reject nonexistent credentials without a server error');
  assert.equal((await login.json()).error.code, 'LOGIN_FAILED');
  console.log(`Public API health and CORS preflight passed for ${config.frontendOrigin}.`);
}
module.exports = { checkPublicApi };
if (require.main === module) checkPublicApi().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
