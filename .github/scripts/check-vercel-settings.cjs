const fs = require('node:fs');
function fail(message) { throw new Error(message); }
function mask(value) {
  if (value) console.log(`::add-mask::${value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')}`);
}
try {
  const target = process.argv[2];
  const remoteBuild = process.argv.includes('--remote-build');
  const environment = process.env.VERCEL_ENVIRONMENT ?? 'preview';
  if (!['preview', 'production'].includes(environment)) fail('Expected preview or production environment');
  if (!['client', 'server'].includes(target)) fail('Expected client or server target');
  const remoteNames = remoteBuild
    ? new Set(JSON.parse(fs.readFileSync(`.vercel/${environment}-env-metadata.json`, 'utf8')).map(v => v.key))
    : new Set();
  const project = JSON.parse(fs.readFileSync('.vercel/project.json', 'utf8'));
  if (project.projectId !== process.env.VERCEL_PROJECT_ID || project.orgId !== process.env.VERCEL_ORG_ID) {
    fail('Pulled Vercel project does not match the configured GitHub secrets');
  }
  if (!project.settings || project.settings.rootDirectory !== target) fail(`Set Vercel Root Directory to ${target}`);
  // Vercel applies vercel.json from the project's Root Directory over dashboard settings.
  const configPath = `${target}/vercel.json`;
  const config = fs.existsSync(configPath) ? JSON.parse(fs.readFileSync(configPath, 'utf8')) : {};
  const settings = { ...project.settings, ...config };
  if (settings.framework !== (target === 'client' ? 'nextjs' : 'express')) fail('Unexpected Vercel framework preset');
  if (!['npm ci', 'npm ci --include=dev'].includes(settings.installCommand)) fail('Set Vercel Install Command to npm ci --include=dev');
  if (settings.buildCommand !== 'npm run build') fail('Set Vercel Build Command to npm run build');
  if (settings.outputDirectory && !(target === 'client' && settings.outputDirectory === '.next')) {
    fail('Clear the Vercel Output Directory override');
  }
  // Parse CLI dotenv output without executing or sourcing it as shell code.
  const values = {};
  for (const line of fs.readFileSync(`.vercel/.env.${environment}.local`, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    mask(raw);
    let value = raw;
    if (raw.startsWith('"') && raw.endsWith('"')) {
      try { value = JSON.parse(raw); } catch { fail(`Invalid dotenv value for ${match[1]}`); }
    } else if (raw.startsWith("'") && raw.endsWith("'")) value = raw.slice(1, -1);
    mask(value);
    values[match[1]] = value;
  }
  const required = target === 'client'
    ? ['NEXT_PUBLIC_API_BASE_URL', 'EXPRESS_API_URL', 'APP_ORIGIN']
    : ['DATABASE_URL', 'DIRECT_URL', 'FRONTEND_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];
  let missing = false;
  for (const name of required) {
    if (!values[name] && !remoteNames.has(name)) { console.error(`::error::Missing Vercel ${environment === 'preview' ? 'Preview' : 'Production'} variable: ${name}`); missing = true; }
  }
  if (missing) fail(`Configure the missing ${environment} environment variables before deployment`);
  if (target === 'server') {
    for (const name of ['DATABASE_URL', 'DIRECT_URL']) {
      // Sensitive values cannot leave Vercel. Its CLI downloads this marker instead.
      // Only a remote Vercel build can safely use the underlying secret.
      if (values[name] === '[SENSITIVE]' || (!values[name] && remoteNames.has(name))) {
        if (!remoteBuild) fail(`${name} is withheld by Vercel; use a remote build instead of prebuilt deployment`);
        if (!remoteNames.has(name)) fail(`Missing Vercel ${environment} variable: ${name}`);
        console.log(`${name} is stored as Sensitive and will be resolved inside Vercel.`);
        continue;
      }
      let url;
      try { url = new URL(values[name]); } catch { fail(`${name} must be a complete PostgreSQL connection URL`); }
      if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.username || url.pathname === '/') {
        fail(`${name} must be a complete PostgreSQL connection URL`);
      }
    }
  }
  for (const name of target === 'client' ? ['NEXT_PUBLIC_API_BASE_URL', 'EXPRESS_API_URL', 'APP_ORIGIN'] : ['FRONTEND_URL']) {
    if (remoteBuild && remoteNames.has(name) && (!values[name] || values[name] === '[SENSITIVE]')) continue;
    let url;
    try { url = new URL(values[name]); } catch { fail(`Invalid URL in ${name}`); }
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
      fail(`${name} must be an HTTPS origin without credentials, path, query, or fragment`);
    }
  }
  for (const name of new Set([...Object.keys(values), ...remoteNames])) {
    if (/^NEXT_PUBLIC_.*(SECRET|TOKEN|PASSWORD|DATABASE|SMTP|DIRECT_URL)/i.test(name)) fail(`Unsafe public variable name: ${name}`);
    if (target === 'client' && /^(DATABASE_URL|DIRECT_URL|SMTP_.*)$/.test(name)) fail(`Remove backend-only variable from frontend project: ${name}`);
  }
  if (values.NODE_ENV && values.NODE_ENV !== 'production' && !(remoteBuild && values.NODE_ENV === '[SENSITIVE]')) fail('Remove the NODE_ENV override; deployment builds require production mode');
  if (values.ENABLE_API_DOCS && !['true', 'false'].includes(values.ENABLE_API_DOCS)) fail('ENABLE_API_DOCS must be true or false');
  console.log(`Verified ${target} ${environment} project settings and required environment names.`);
} catch (error) {
  // Do not print parser errors that could embed file contents or credentials.
  const safe = error instanceof SyntaxError || error.code ? 'Cannot read Vercel settings or Preview environment file' : error.message;
  console.error(`::error::${safe}`);
  process.exitCode = 1;
}
