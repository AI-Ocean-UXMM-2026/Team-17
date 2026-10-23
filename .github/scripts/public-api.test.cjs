const { test } = require('node:test');
const assert = require('node:assert/strict');
const { configurePublicApi } = require('./configure-public-api.cjs');
const { checkPublicApi } = require('./check-public-api.cjs');
const config = require('../public-api-config.json');
const { configureProduction } = require('./configure-production.cjs');
const { checkClient } = require('./check-production-client.cjs');
const env = { VERCEL_TOKEN: 'fixture', VERCEL_ORG_ID: 'team_fixture', VERCEL_PROJECT_ID: 'prj_fixture' };

for (const target of ['server', 'client']) {
  test(`${target} Production setup preserves service secrets and configures public Production URLs`, async () => {
    const writes = [];
    const secrets = ['DATABASE_URL', 'DIRECT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
    await configureProduction(target, env, async (url, options) => {
      if (options.method === 'GET') return { ok: true, json: async () => url.includes('/env?')
        ? { envs: secrets.map(key => ({ key, id: key, type: 'sensitive', target: ['production'] })) }
        : { id: env.VERCEL_PROJECT_ID, accountId: env.VERCEL_ORG_ID, name: target === 'server' ? config.project : 'surfertrack', rootDirectory: target } };
      const body = JSON.parse(options.body);
      writes.push(body);
      return { ok: true, json: async () => body };
    });
    const settings = writes.filter(body => body.key);
    assert.ok(settings.every(body => body.target.length === 1 && body.target[0] === 'production'));
    assert.ok(settings.every(body => !secrets.includes(body.key)));
    assert.equal(settings.find(body => body.key === 'NODE_ENV').value, 'production');
    if (target === 'server') assert.equal(settings.find(body => body.key === 'FRONTEND_URL').value, config.frontendOrigin);
    else assert.equal(settings.find(body => body.key === 'EXPRESS_API_URL').value, `https://${config.alias}`);
    assert.deepEqual(writes.at(-1), { ssoProtection: null });
  });
}
test('frontend Production check rejects authentication redirects and accepts public HTML', async () => {
  await assert.rejects(checkClient(async () => new Response(null, { status: 302 })), /HTTP 302/);
  await checkClient(async url => url.endsWith('/api/session/login')
    ? Response.json({ error: { code: 'LOGIN_FAILED' } }, { status: 401 })
    : new Response('<html><body>ok</body></html>'));
});

test('refuses to modify the wrong project', async () => {
  let calls = 0;
  await assert.rejects(configurePublicApi(env, async () => {
    calls++;
    return { ok: true, json: async () => ({ id: 'other' }) };
  }), /identity/);
  assert.equal(calls, 1);
});

test('makes the API public and splits Preview origin without overwriting Production', async () => {
  const writes = [];
  await configurePublicApi(env, async (url, options) => {
    let data;
    if (options.method === 'GET') data = url.includes('/env?')
      ? { envs: [{ id: 'shared', key: 'FRONTEND_URL', target: ['production', 'preview'] }] }
      : { id: env.VERCEL_PROJECT_ID, accountId: env.VERCEL_ORG_ID, name: 'surferapi', rootDirectory: 'server' };
    else {
      const body = JSON.parse(options.body);
      writes.push({ url, method: options.method, body });
      data = body;
    }
    return { ok: true, json: async () => data };
  });
  assert.equal(writes.length, 3);
  assert.deepEqual(writes[0].body, { target: ['production'] });
  assert.equal(writes[1].method, 'POST');
  assert.deepEqual(writes[1].body.target, ['preview']);
  assert.equal(writes[1].body.value, config.frontendOrigin);
  assert.deepEqual(writes[2].body, { ssoProtection: null });
});

test('public check rejects Vercel sign-in redirects', async () => {
  await assert.rejects(checkPublicApi(async () => new Response(null, { status: 302 })), /without a sign-in redirect/);
});

test('public check validates CORS headers and health without credentials', async () => {
  await checkPublicApi(async (url, options) => {
    assert.equal(options.redirect, 'manual');
    if (url.endsWith('/api/auth/login')) {
      return Response.json({ success: false, error: { code: 'LOGIN_FAILED' } }, { status: 401 });
    }
    if (options.method === 'OPTIONS') {
      assert.equal(options.headers.Origin, config.frontendOrigin);
      return new Response(null, { status: 204, headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET,POST,OPTIONS',
        'access-control-allow-headers': 'Content-Type,Authorization',
      } });
    }
    return Response.json({ status: 'ok' });
  });
});
