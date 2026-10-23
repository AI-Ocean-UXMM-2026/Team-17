const config = require('../public-api-config.json');

async function checkClient(request = fetch) {
  const response = await request(config.frontendOrigin, { redirect: 'manual', signal: AbortSignal.timeout(60000) });
  if (response.status !== 200) throw new Error(`Public frontend returned HTTP ${response.status}`);
  if (!(await response.text()).includes('<html')) throw new Error('Public frontend did not return HTML');
  const login = await request(`${config.frontendOrigin}/api/session/login`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(60000),
    headers: { Origin: config.frontendOrigin, 'Content-Type': 'application/json', 'Sec-Fetch-Site': 'same-origin' },
    body: JSON.stringify({ email: 'deployment-probe-noaccount@example.invalid', password: 'Deployment-Probe-Only-2026' }),
  });
  if (login.status !== 401 || (await login.json()).error?.code !== 'LOGIN_FAILED') {
    throw new Error(`Frontend-to-backend login check failed (HTTP ${login.status})`);
  }
  console.log(`Public frontend is available at ${config.frontendOrigin}.`);
}
module.exports = { checkClient };
if (require.main === module) checkClient().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
