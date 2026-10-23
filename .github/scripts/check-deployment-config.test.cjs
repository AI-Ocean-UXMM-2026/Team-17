const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const verifier = path.join(__dirname, 'check-vercel-settings.cjs');

function fixture(t, target, change = () => {}) {
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
  fs.mkdirSync(path.join(directory, '.vercel'));
  fs.writeFileSync(path.join(directory, '.vercel/project.json'), JSON.stringify(project));
  fs.writeFileSync(path.join(directory, '.vercel/.env.preview.local'), Object.entries(values).map(([key, value]) => `${key}=${JSON.stringify(value)}`).join('\n'));
  return spawnSync(process.execPath, [verifier, target], {
    cwd: directory, env: { ...process.env, VERCEL_ORG_ID: 'test-org', VERCEL_PROJECT_ID: 'test-project' }, encoding: 'utf8',
  });
}
for (const target of ['client', 'server']) {
  test(`${target} accepts matching settings and complete Preview configuration`, t => {
    assert.equal(fixture(t, target).status, 0);
  });
}
for (const [name, mutate, diagnostic] of [
  ['wrong project', p => { p.projectId = 'wrong'; }, 'does not match'],
  ['wrong root', p => { p.settings.rootDirectory = 'server'; }, 'Root Directory'],
  ['wrong framework', p => { p.settings.framework = 'other'; }, 'framework'],
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
