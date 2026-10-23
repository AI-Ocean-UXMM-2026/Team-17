const fs = require('node:fs');
try {
  const values = {};
  const environment = process.env.VERCEL_ENVIRONMENT ?? 'preview';
  if (!['preview', 'production'].includes(environment)) throw new Error('Unexpected environment');
  for (const line of fs.readFileSync(`.vercel/.env.${environment}.local`, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^(DATABASE_URL|DIRECT_URL)=(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    values[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw;
  }
  for (const key of ['DATABASE_URL', 'DIRECT_URL']) {
    const value = values[key] ?? '';
    let valid = false;
    try { const url = new URL(value); valid = ['postgres:', 'postgresql:'].includes(url.protocol); } catch {}
    const flag = value => value ? 'present' : 'absent';
    console.log(JSON.stringify({ key, postgresUrl: value === '[SENSITIVE]' ? 'withheld-by-vercel' : valid ? 'valid-format' : 'invalid-format',
      leadingQuote: flag(/^["']/.test(value)), trailingQuote: flag(/["']$/.test(value)),
      assignmentPrefix: flag(/^(DATABASE_URL|DIRECT_URL)=/.test(value)),
      whitespace: flag(/\s/.test(value)), postgresScheme: flag(/^postgres(?:ql)?:\/\//.test(value)),
    }));
  }
} catch {
  console.error('Cannot inspect database environment format.');
  process.exitCode = 1;
}
