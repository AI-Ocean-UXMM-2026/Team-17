const keys = ['DATABASE_URL', 'DIRECT_URL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'SMTP_FROM'];

async function enablePreviewSecrets(env = process.env, request = fetch) {
  const project = encodeURIComponent(env.VERCEL_PROJECT_ID);
  async function api(route, method = 'GET', body) {
    const response = await request(`https://api.vercel.com/${route}?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`, {
      method, headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}`, 'Content-Type': 'application/json' },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000),
    });
    if (!response.ok) throw new Error(`Cannot configure Preview secret scopes (HTTP ${response.status})`);
    return response.json();
  }
  const data = await api(`v10/projects/${project}/env`);
  const variables = Array.isArray(data) ? data : data.envs;
  if (!Array.isArray(variables)) throw new Error('Unexpected environment metadata');
  // The project owner approved reusing the Production database and SMTP account for Preview.
  for (const key of keys) {
    if (variables.some(v => v.key === key && !v.gitBranch && v.target?.includes('preview'))) continue;
    const candidates = variables.filter(v => v.key === key && !v.gitBranch && v.target?.includes('production'));
    if (candidates.length !== 1) throw new Error(`Configure ${key} for Preview; no unique Production value is available to share`);
    const variable = candidates[0];
    const updated = await api(`v9/projects/${project}/env/${encodeURIComponent(variable.id)}`, 'PATCH', {
      target: [...new Set([...variable.target, 'preview'])],
    });
    if (!updated.target?.includes('preview')) throw new Error(`Preview scope was not applied for ${key}`);
    console.log(`Enabled existing ${key} for Preview without reading its value.`);
  }
}
module.exports = { enablePreviewSecrets };
if (require.main === module) enablePreviewSecrets().catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
