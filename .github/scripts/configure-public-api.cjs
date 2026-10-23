const config = require('../public-api-config.json');

async function configurePublicApi(env = process.env, request = fetch) {
  const { VERCEL_TOKEN: token, VERCEL_ORG_ID: org, VERCEL_PROJECT_ID: id } = env;
  if (!token || !org || !id) throw new Error('Missing Vercel deployment credentials');
  const projectPath = `projects/${encodeURIComponent(id)}`;
  async function api(version, path, method = 'GET', body) {
    const response = await request(`https://api.vercel.com/${version}/${path}?teamId=${encodeURIComponent(org)}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Public API configuration failed (HTTP ${response.status})`);
    return response.json();
  }
  const project = await api('v9', projectPath);
  if (project.id !== id || project.accountId !== org || project.name !== config.project || project.rootDirectory !== 'server') {
    throw new Error('Public API project identity does not match the expected server project');
  }
  const data = await api('v10', `${projectPath}/env`);
  const variables = Array.isArray(data) ? data : data.envs;
  if (!Array.isArray(variables)) throw new Error('Unexpected environment metadata');
  const origins = variables.filter(v => v.key === 'FRONTEND_URL' && !v.gitBranch && v.target?.includes('preview'));
  if (origins.length > 1) throw new Error('Ambiguous Preview FRONTEND_URL');
  const existing = origins[0];
  const body = { key: 'FRONTEND_URL', value: config.frontendOrigin, type: 'encrypted', target: ['preview'] };
  if (existing?.target.length === 1) {
    await api('v9', `${projectPath}/env/${encodeURIComponent(existing.id)}`, 'PATCH', body);
  } else {
    // Preserve any Production/Development value while splitting off Preview.
    if (existing) await api('v9', `${projectPath}/env/${encodeURIComponent(existing.id)}`, 'PATCH', {
      target: existing.target.filter(target => target !== 'preview'),
    });
    await api('v10', `${projectPath}/env`, 'POST', body);
  }
  // Public browser clients cannot follow Vercel's sign-in redirect during CORS preflight.
  // Application authentication and role checks continue to protect private API routes.
  const updated = await api('v9', projectPath, 'PATCH', { ssoProtection: null });
  if (updated.ssoProtection != null) throw new Error('Vercel Authentication is still enabled');
  console.log('Configured public surferapi access and the Preview frontend origin.');
}
module.exports = { configurePublicApi };
if (require.main === module) configurePublicApi().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
