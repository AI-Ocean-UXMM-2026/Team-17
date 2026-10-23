const config = require('../public-api-config.json');

async function configureProduction(target, env = process.env, request = fetch) {
  if (!['client', 'server'].includes(target)) throw new Error('Expected client or server target');
  const { VERCEL_TOKEN: token, VERCEL_ORG_ID: org, VERCEL_PROJECT_ID: id } = env;
  if (!token || !org || !id) throw new Error('Missing Vercel deployment credentials');
  const projectPath = `projects/${encodeURIComponent(id)}`;
  async function api(version, route, method = 'GET', body) {
    const response = await request(`https://api.vercel.com/${version}/${route}?teamId=${encodeURIComponent(org)}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Production configuration failed (HTTP ${response.status})`);
    return response.json();
  }
  const project = await api('v9', projectPath);
  if (project.id !== id || project.accountId !== org || project.name !== (target === 'server' ? config.project : 'surfertrack') || project.rootDirectory !== target) {
    throw new Error('Production project identity does not match the deployment target');
  }
  const data = await api('v10', `${projectPath}/env`);
  const variables = Array.isArray(data) ? data : data.envs;
  if (!Array.isArray(variables)) throw new Error('Unexpected environment metadata');
  if (target === 'server') {
    for (const key of ['DATABASE_URL', 'DIRECT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM']) {
      if (!variables.some(v => v.key === key && !v.gitBranch && v.target?.includes('production'))) {
        throw new Error(`Configure ${key} in the server Production environment`);
      }
    }
  }
  const values = target === 'server' ? { FRONTEND_URL: config.frontendOrigin, NODE_ENV: 'production', API_ERROR_DETAILS: 'true' } : {
    NEXT_PUBLIC_API_BASE_URL: `https://${config.alias}`, EXPRESS_API_URL: `https://${config.alias}`,
    APP_ORIGIN: config.frontendOrigin, NODE_ENV: 'production',
  };
  for (const [key, value] of Object.entries(values)) {
    const matches = variables.filter(v => v.key === key && !v.gitBranch && v.target?.includes('production'));
    if (matches.length > 1) throw new Error(`Ambiguous Production variable: ${key}`);
    const existing = matches[0];
    const body = { key, value, type: 'encrypted', target: ['production'] };
    if (existing?.target.length === 1) {
      await api('v9', `${projectPath}/env/${encodeURIComponent(existing.id)}`, 'PATCH', body);
    } else {
      if (existing) await api('v9', `${projectPath}/env/${encodeURIComponent(existing.id)}`, 'PATCH', {
        target: existing.target.filter(t => t !== 'production'),
      });
      await api('v10', `${projectPath}/env`, 'POST', body);
    }
  }
  const updated = await api('v9', projectPath, 'PATCH', { ssoProtection: null });
  if (updated.ssoProtection != null) throw new Error('Production deployment is still protected by Vercel Authentication');
  console.log(`Configured public ${target} Production settings and service URLs.`);
}
module.exports = { configureProduction };
if (require.main === module) configureProduction(process.argv[2]).catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
