// Run after building both packages: node scripts/production-smoke.cjs
// Uses dummy database settings and performs no database-backed mutations.
const { spawn } = require('node:child_process');
const assert = require('node:assert/strict');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const children = [];
const api = 'http://127.0.0.1:4311';
const web = 'http://127.0.0.1:4310';
const environment = {
  ...process.env, NODE_ENV: 'production', PORT: '4311',
  DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test',
  FRONTEND_URL: web, APP_ORIGIN: web, EXPRESS_API_URL: api,
  ENABLE_API_DOCS: 'false',
};
function start(directory, args) {
  const child = spawn(process.execPath, args, {
    cwd: path.join(root, directory), env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  });
  children.push(child);
  // Drain output without logging environment-specific diagnostics.
  child.stdout.resume();
  child.stderr.resume();
  return child;
}
async function ready(url, child) {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (child.exitCode !== null) throw new Error('Production process exited before becoming ready');
    try { await fetch(url, { signal: AbortSignal.timeout(1000) }); return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Production process readiness timed out');
}
async function check(base, route, status, options) {
  const response = await fetch(base + route, { ...options, signal: AbortSignal.timeout(5000) });
  assert.equal(response.status, status, `${options?.method ?? 'GET'} ${route}`);
  console.log(`${status} ${options?.method ?? 'GET'} ${route}`);
  return response;
}
async function main() {
  // Importing the app must neither listen nor create a second application instance.
  Object.assign(process.env, environment);
  const express = require(path.join(root, 'server/node_modules/express'));
  const originalListen = express.application.listen;
  express.application.listen = () => { throw new Error('App import started a listener'); };
  const exported = require(path.join(root, 'server/dist/app'));
  assert.equal(exported.default, exported.app);
  assert.equal(require(path.join(root, 'server/dist/app')).app, exported.app);
  express.application.listen = originalListen;
  await require(path.join(root, 'server/dist/config/prisma')).prisma.$disconnect();
  const backend = start('server', ['dist/server.js']);
  const frontend = start('client', ['node_modules/next/dist/bin/next', 'start', '--port', '4310', '--hostname', '127.0.0.1']);
  await Promise.all([ready(api + '/health', backend), ready(web + '/login', frontend)]);
  assert.deepEqual(await (await check(api, '/health', 200)).json(), { status: 'ok' });
  for (const route of ['/api/docs', '/api/docs.json']) await check(api, route, 404);
  for (const route of ['/api/users/me', '/api/orders', '/api/operator/assignments', '/api/rider/assignments']) {
    await check(api, route, 401);
  }
  const preflight = await check(api, '/api/auth/register', 204, {
    method: 'OPTIONS', headers: { Origin: web, 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type' },
  });
  assert.equal(preflight.headers.get('access-control-allow-origin'), web);
  for (const route of ['/', '/login', '/register', '/seller', '/operator', '/operator/assignments', '/rider']) {
    await check(web, route, 200);
  }
  await check(web, '/api/session/me', 401, {
    method: 'POST', headers: { Origin: web, 'Content-Type': 'application/json' }, body: '{}',
  });
  await check(web, '/api/session/login', 403, {
    method: 'POST', headers: { Origin: 'https://untrusted.example', 'Content-Type': 'application/json' }, body: '{}',
  });
  console.log('Production smoke checks passed. No database or SMTP operations performed.');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(async () => {
  await Promise.all(children.map(child => new Promise(resolve => {
    if (child.exitCode !== null) return resolve();
    child.once('exit', resolve);
    child.kill();
  })));
});