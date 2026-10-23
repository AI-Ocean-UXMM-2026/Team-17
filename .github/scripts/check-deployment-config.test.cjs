const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const verifier = path.join(__dirname, 'check-vercel-settings.cjs');
const { readMetadata } = require('./read-vercel-env-metadata.cjs');
const { enablePreviewSecrets } = require('./enable-preview-secrets.cjs');

test('shares approved Production secrets by target only, without reading or replacing their values', async () => {
  const keys = ['DATABASE_URL', 'DIRECT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  const writes = [];
  await enablePreviewSecrets({}, async (_url, options) => {
    if (options.method === 'GET') return { ok: true, json: async () => ({ envs: keys.map(key => ({ id: key, key, target: ['production'] })) }) };
    const body = JSON.parse(options.body);
    writes.push(body);
    return { ok: true, json: async () => body };
  });
  assert.equal(writes.length, 7);
  assert.ok(writes.every(body => Object.keys(body).length === 1));
  assert.deepEqual(writes[0], { target: ['production', 'preview'] });
});

test('remote metadata includes only applicable Preview names and never values', async () => {
  const metadata = await readMetadata({ GITHUB_REF_NAME: 'main' }, async () => ({
    ok: true, json: async () => ({ envs: [
      { key: 'DATABASE_URL', type: 'sensitive', target: ['preview'], value: 'fixture-only' },
      { key: 'WRONG_BRANCH', target: ['preview'], gitBranch: 'other' },
      { key: 'PRODUCTION_ONLY', target: ['production'] },
    ] }),
  }));
  assert.deepEqual(metadata, [{ key: 'DATABASE_URL', type: 'sensitive' }]);
});

function fixture(t, target, change = () => {}, config, args = []) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'surfertrack-ci-test-'));
  t.after(() => {
    assert.ok(directory.startsWith(path.join(os.tmpdir(), 'surfertrack-ci-test-')));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const project = { orgId: 'test-org', projectId: 'test-project', settings: {
    rootDirectory: target, framework: target === 'client' ? 'nextjs' : 'express',
    installCommand: 'npm ci', buildCommand: 'npm run build', outputDirectory: null,
  } };
  const values = target === 'client' ? {
    NEXT_PUBLIC_API_BASE_URL: 'https://api.example.test', EXPRESS_API_URL: 'https://api.example.test', APP_ORIGIN: 'https://web.example.test',
  } : {
    DATABASE_URL: 'postgresql://test:test@127.0.0.1:1/test', DIRECT_URL: 'postgresql://test:test@127.0.0.1:1/test',
    FRONTEND_URL: 'https://web.example.test', SMTP_HOST: 'smtp.example.test', SMTP_PORT: '587',
    SMTP_USER: 'test', SMTP_PASSWORD: 'fixture-only', SMTP_FROM: 'test@example.test',
  };
  change(project, values);
  if (config !== undefined) {
    fs.mkdirSync(path.join(directory, target));
    fs.writeFileSync(path.join(directory, target, 'vercel.json'), JSON.stringify(config));
  }
  fs.mkdirSync(path.join(directory, '.vercel'));
  const metadata = (target === 'client' ? ['NEXT_PUBLIC_API_BASE_URL', 'EXPRESS_API_URL', 'APP_ORIGIN']
    : ['DATABASE_URL', 'DIRECT_URL', 'FRONTEND_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']).map(key => ({ key, type: 'sensitive' }));
  for (const environment of ['preview', 'production']) {
    fs.writeFileSync(path.join(directory, `.vercel/${environment}-env-metadata.json`), JSON.stringify(metadata));
    fs.writeFileSync(path.join(directory, `.vercel/.env.${environment}.local`), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  }
  fs.writeFileSync(path.join(directory, '.vercel/project.json'), JSON.stringify(project));
  fs.writeFileSync(path.join(directory, '.vercel/.env.preview.local'), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  return spawnSync(process.execPath, [verifier, target, ...args], {
    cwd: directory, env: { ...process.env, VERCEL_ENVIRONMENT: args.includes('--production') ? 'production' : 'preview', VERCEL_ORG_ID: 'test-org', VERCEL_PROJECT_ID: 'test-project' }, encoding: 'utf8',
  });
}
test('server repository commands override stale dashboard commands', t => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '../../server/vercel.json'), 'utf8'));
  const result = fixture(t, 'server', p => {
    p.settings.installCommand = null;
    p.settings.buildCommand = 'npm run old-build';
  }, config);
  assert.equal(result.status, 0, result.stderr);
});
for (const [name, config, diagnostic] of [
  ['install command', { installCommand: 'npm install' }, 'Install Command'],
  ['build command', { buildCommand: 'npm run db:migrate' }, 'Build Command'],
]) {
  test(`rejects unsafe repository ${name} despite valid dashboard settings`, t => {
    const result = fixture(t, 'server', () => {}, config);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(diagnostic));
  });
}
test('repository configuration cannot bypass the dashboard root mapping check', t => {
  const result = fixture(t, 'server', p => { p.settings.rootDirectory = 'client'; }, { rootDirectory: 'server' });
  assert.equal(result.status, 1);
  assert.ok(result.stderr.includes('Root Directory'));
});
for (const target of ['client', 'server']) {
  test(`${target} validates Production settings for a remote build`, t => {
    const result = fixture(t, target, () => {}, undefined, ['--remote-build', '--production']);
    assert.equal(result.status, 0, result.stderr);
    assert.ok(result.stdout.includes('production project settings'));
  });
  test(`${target} accepts matching settings and complete Preview configuration`, t => {
    assert.equal(fixture(t, target).status, 0);
  });
}
for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
  test(`accepts withheld ${key} only when Preview metadata confirms it exists`, t => {
    const remote = fixture(t, 'server', (_p, values) => { delete values[key]; }, undefined, ['--remote-build']);
    assert.equal(remote.status, 0, remote.stderr);
  });
  test(`allows Vercel's Sensitive ${key} placeholder only for remote builds`, t => {
    const change = (_p, values) => { values[key] = '[SENSITIVE]'; };
    const local = fixture(t, 'server', change);
    assert.equal(local.status, 1);
    assert.ok(local.stderr.includes('withheld by Vercel'));
    const remote = fixture(t, 'server', change, undefined, ['--remote-build']);
    assert.equal(remote.status, 0, remote.stderr);
  });
  test(`rejects an invalid ${key} before publishing a broken server`, t => {
    const result = fixture(t, 'server', (_p, values) => { values[key] = 'not-a-connection-url'; });
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(`${key} must be a complete PostgreSQL connection URL`));
    const remote = fixture(t, 'server', (_p, values) => { values[key] = 'not-a-connection-url'; }, undefined, ['--remote-build']);
    assert.equal(remote.status, 1);
  });
}
for (const [name, mutate, diagnostic] of [
  ['wrong project', p => { p.projectId = 'wrong'; }, 'does not match'],
  ['wrong root', p => { p.settings.rootDirectory = 'server'; }, 'Root Directory'],
  ['wrong framework', p => { p.settings.framework = 'other'; }, 'framework'],
  ['unsafe install command', p => { p.settings.installCommand = 'npm install'; }, 'Install Command'],
  ['unsafe build command', p => { p.settings.buildCommand = 'npm run db:migrate'; }, 'Build Command'],
  ['missing environment', (_p, v) => { delete v.APP_ORIGIN; }, 'Missing Vercel Preview variable: APP_ORIGIN'],
  ['localhost origin', (_p, v) => { v.APP_ORIGIN = 'http://localhost:3000'; }, 'HTTPS origin'],
  ['public secret', (_p, v) => { v.NEXT_PUBLIC_SMTP_PASSWORD = 'fixture-only'; }, 'Unsafe public variable'],
  ['backend secret on frontend', (_p, v) => { v.DATABASE_URL = 'fixture-only'; }, 'backend-only variable'],
  ['development override', (_p, v) => { v.NODE_ENV = 'development'; }, 'NODE_ENV override'],
]) {
  test(`rejects ${name} before build or deploy`, t => {
    const result = fixture(t, 'client', mutate);
    assert.equal(result.status, 1);
    assert.ok(result.stderr.includes(diagnostic));
  });
}
