const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { configureProxy } = require('../dist/config/proxy');
const { clientIpKey } = require('../dist/middleware/client-ip');

async function fixture(t, environment) {
  const app = express();
  configureProxy(app, environment);
  app.use(rateLimit({ windowMs: 60000, limit: 1, keyGenerator: clientIpKey }));
  app.get('/', (req, res) => res.json({ ip: req.ip }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return forwarded => fetch(`http://127.0.0.1:${server.address().port}/`, { headers: {
    'X-Forwarded-For': forwarded, Forwarded: 'for=192.0.2.200',
  } });
}
test('Vercel clients get separate limits and cannot evade them with spoofed proxy prefixes', async t => {
  const request = await fixture(t, { VERCEL: '1' });
  const first = await request('192.0.2.1, 198.51.100.10');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ip, '198.51.100.10');
  assert.equal((await request('192.0.2.2, 198.51.100.11')).status, 200);
  assert.equal((await request('192.0.2.99, 198.51.100.10')).status, 429);
});
test('direct local requests cannot select their own address through forwarded headers', async t => {
  const request = await fixture(t, {});
  const first = await request('198.51.100.10');
  assert.equal(first.status, 200);
  assert.equal((await first.json()).ip, '127.0.0.1');
  assert.equal((await request('198.51.100.11')).status, 429);
});
