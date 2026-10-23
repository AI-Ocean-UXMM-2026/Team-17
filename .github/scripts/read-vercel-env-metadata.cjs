const fs = require('node:fs');

async function readMetadata(env = process.env, request = fetch) {
  const environment = env.VERCEL_ENVIRONMENT ?? 'preview';
  if (!['preview', 'production'].includes(environment)) throw new Error('Expected preview or production environment');
  const response = await request(`https://api.vercel.com/v10/projects/${encodeURIComponent(env.VERCEL_PROJECT_ID)}/env?teamId=${encodeURIComponent(env.VERCEL_ORG_ID)}`, {
    headers: { Authorization: `Bearer ${env.VERCEL_TOKEN}` }, signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`Cannot read Vercel environment metadata (HTTP ${response.status})`);
  const data = await response.json();
  const variables = Array.isArray(data) ? data : data.envs;
  if (!Array.isArray(variables)) throw new Error('Unexpected Vercel environment metadata');
  return variables.filter(v => v.target?.includes(environment) && (!v.gitBranch || (environment === 'preview' && v.gitBranch === env.GITHUB_REF_NAME)))
    .map(v => ({ key: v.key, type: v.type }));
}
module.exports = { readMetadata };
if (require.main === module) readMetadata().then(metadata => {
  const environment = process.env.VERCEL_ENVIRONMENT ?? 'preview';
  fs.writeFileSync(`.vercel/${environment}-env-metadata.json`, JSON.stringify(metadata));
  console.log(`Configured ${environment} variable names: ${metadata.map(v => v.key).join(', ')}`);
}).catch(error => {
  console.error(`::error::${error.message}`);
  process.exitCode = 1;
});
