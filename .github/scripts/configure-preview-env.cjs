const origins = require('../preview-config.json');

async function configurePreview(target, env = process.env, request = fetch) {
  if (!['client', 'server'].includes(target)) throw new Error('Expected client or server target');
  const { VERCEL_TOKEN: token, VERCEL_ORG_ID: orgId, VERCEL_PROJECT_ID: projectId } = env;
  if (!token || !orgId || !projectId) throw new Error('Missing Vercel deployment credentials');
  async function api(route, method = 'GET', body) {
    const response = await request(`https://api.vercel.com/${route}?teamId=${encodeURIComponent(orgId)}`, {
      method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Vercel environment configuration failed (HTTP ${response.status})`);
    return response.json();
  }
  const project = encodeURIComponent(projectId);
  const data = await api(`v10/projects/${project}/env`);
  const variables = Array.isArray(data) ? data : data.envs;
  if (!Array.isArray(variables)) throw new Error('Unexpected Vercel environment metadata');
  const shared = target === 'server'
    ? ['DATABASE_URL', 'DIRECT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'] : [];
  for (const key of shared) {
    if (variables.some(v => v.key === key && !v.gitBranch && v.target?.includes('preview'))) continue;
    const candidates = variables.filter(v => v.key === key && !v.gitBranch && v.target?.includes('production'));
    if (candidates.length !== 1) throw new Error(`Expected one Production variable for ${key}`);
    const variable = candidates[0];
    // Extend the existing encrypted variable's scope without decrypting or copying its value.
    const updated = await api(`v9/projects/${project}/env/${encodeURIComponent(variable.id)}`, 'PATCH', {
      target: [...new Set([...variable.target, 'preview'])],
    });
    if (!updated.target?.includes('preview')) throw new Error(`Preview scope was not applied for ${key}`);
    console.log(`Enabled existing ${key} for Preview.`);
  }
  const urls = target === 'server' ? { FRONTEND_URL: origins.client } : {
    NEXT_PUBLIC_API_BASE_URL: origins.server, EXPRESS_API_URL: origins.server, APP_ORIGIN: origins.client,
  };
  for (const [key, value] of Object.entries(urls)) {
    const existing = variables.filter(v => v.key === key && !v.gitBranch && v.target?.includes('preview'));
    if (existing.length > 1) throw new Error(`Ambiguous Preview configuration for ${key}`);
    // Keep Production URL variables separate from Preview aliases.
    const body = { key, value, target: ['preview'], type: 'encrypted' };
    if (existing.length) {
      if (existing[0].target.length !== 1) throw new Error(`Separate the Preview ${key} variable from Production before updating it`);
      await api(`v9/projects/${project}/env/${encodeURIComponent(existing[0].id)}`, 'PATCH', body);
    } else {
      await api(`v10/projects/${project}/env`, 'POST', body);
    }
    console.log(`Configured ${key} for the Preview alias.`);
  }
}
module.exports = { configurePreview };
if (require.main === module) {
  configurePreview(process.argv[2]).catch(error => {
    console.error(`::error::${error.message}`);
    process.exitCode = 1;
  });
}
