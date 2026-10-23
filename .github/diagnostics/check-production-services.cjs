const fs = require('node:fs');
const { Pool } = require('../../server/node_modules/pg');
const nodemailer = require('../../server/node_modules/nodemailer');
const { randomUUID, randomBytes } = require('node:crypto');

function describe(error) {
  const code = typeof error?.code === 'string' && /^[A-Z0-9_]+$/i.test(error.code) ? error.code : 'UNKNOWN';
  const nested = error?.meta?.driverAdapterError?.cause;
  const message = String(error?.message ?? '') + ' ' + String(nested?.originalMessage ?? '');
  const reason = /certificate|self.signed|ssl|tls/i.test(message) ? 'TLS_CERTIFICATE_ERROR'
    : /password authentication|tenant or user not found|authentication failed/i.test(message) ? 'AUTHENTICATION_FAILED'
    : /timeout|timed out/i.test(message) ? 'CONNECTION_TIMEOUT'
    : /does not exist/i.test(message) ? 'SCHEMA_OBJECT_MISSING'
    : /null value|not.null/i.test(message) ? 'REQUIRED_DATABASE_COLUMN_MISSING'
    : /permission denied/i.test(message) ? 'DATABASE_PERMISSION_DENIED'
    : /check.constraint|violates.*constraint/i.test(message) ? 'DATABASE_CHECK_CONSTRAINT_FAILED'
    : 'REQUEST_FAILED';
  const column = message.match(/column ["']([A-Za-z0-9_]+)["']/i)?.[1];
  const constraint = message.match(/constraint ["']([A-Za-z0-9_]+)["']/i)?.[1];
  const databaseCode = /^[A-Z0-9_]{2,20}$/i.test(nested?.originalCode ?? '') ? nested.originalCode : undefined;
  return { code, reason, column, databaseCode, constraint };
}
async function main() {
  const values = {};
  for (const line of fs.readFileSync('.vercel/.env.production.local', 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!match) continue;
    const raw = match[2].trim();
    values[match[1]] = raw.startsWith('"') && raw.endsWith('"') ? JSON.parse(raw) : raw;
  }
  if (!values.DATABASE_URL || values.DATABASE_URL === '[SENSITIVE]') {
    console.log('Database diagnostic unavailable: Vercel withheld the connection value.');
  } else {
    const pool = new Pool({ connectionString: values.DATABASE_URL, connectionTimeoutMillis: 15000, query_timeout: 15000 });
    try {
      await pool.query('SELECT 1');
      console.log('Database connection and SELECT succeeded.');
      const result = await pool.query("SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('accounts', 'profiles', 'email_verification_tokens', 'password_reset_tokens', 'auth_sessions')");
      console.log(`Available authentication tables: ${result.rows.map(row => row.table_name).join(', ')}`);
      const constraints = await pool.query("SELECT c.relname AS table_name, con.conname AS constraint_name, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid = con.conrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND c.relname IN ('accounts', 'profiles') AND con.contype = 'c'");
      for (const constraint of constraints.rows) console.log(JSON.stringify({ service: 'database-check-constraint', ...constraint }));
      const defaults = await pool.query("SELECT column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'profiles' AND column_name = 'provider_id'");
      console.log(`Profile provider default: ${defaults.rows[0]?.column_default ? 'configured-in-database' : 'unset'}`);
      const { PrismaClient } = require('../../server/dist/generated/prisma/client');
      const { PrismaPg } = require('../../server/node_modules/@prisma/adapter-pg');
      const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: values.DATABASE_URL }) });
      try {
        for (const model of ['account', 'profile', 'emailVerificationToken']) {
          try { await prisma[model].findFirst(); console.log(`Prisma ${model} query succeeded.`); }
          catch (error) {
            console.log(JSON.stringify({ service: 'prisma', model, ...describe(error),
              databaseCode: /^[A-Z0-9_]{2,20}$/i.test(error?.meta?.driverAdapterError?.cause?.originalCode ?? '')
                ? error.meta.driverAdapterError.cause.originalCode : undefined,
            }));
          }
        }
        const rollback = new Error('REGISTRATION_PROBE_ROLLBACK');
        let stage = 'account-and-profile';
        try {
          const { hashPassword } = require('../../server/dist/modules/auth/auth.password');
          const passwordHash = await hashPassword(randomBytes(24).toString('base64url'));
          await prisma.$transaction(async tx => {
            const account = await tx.account.create({ data: {
              email: `deployment-probe-${randomUUID()}@example.invalid`, passwordHash,
              profile: { create: { id: randomUUID(), role: 'SME', providerId: null } },
            }, include: { profile: true } });
            if (account.profile.role !== 'SME' || account.profile.providerId !== null) throw new Error('Unexpected public registration role or provider membership');
            stage = 'verification-token';
            await tx.emailVerificationToken.create({ data: {
              accountId: account.id, tokenHash: randomBytes(32).toString('hex'), expiresAt: new Date(Date.now() + 60000),
            } });
            throw rollback;
          }, { timeout: 15000, maxWait: 10000 });
        } catch (error) {
          if (error === rollback) console.log('Registration database writes succeeded and were rolled back; no account retained and no email sent.');
          else console.log(JSON.stringify({ service: 'registration-database', stage, ...describe(error) }));
        }
      } finally { await prisma.$disconnect(); }
    } catch (error) {
      console.log(JSON.stringify({ service: 'database', ...describe(error) }));
    } finally { await pool.end(); }
  }
  if (!values.SMTP_PASSWORD || values.SMTP_PASSWORD === '[SENSITIVE]') {
    console.log('SMTP diagnostic unavailable: Vercel withheld the password.');
  } else {
    const port = Number(values.SMTP_PORT || 587);
    const transport = nodemailer.createTransport({
      host: values.SMTP_HOST, port, secure: port === 465, requireTLS: port !== 465,
      auth: { user: values.SMTP_USER, pass: values.SMTP_PASSWORD },
      connectionTimeout: 10000, greetingTimeout: 10000, socketTimeout: 15000,
      logger: false, debug: false,
    });
    try { await transport.verify(); console.log('SMTP connection and authentication succeeded; no email sent.'); }
    catch (error) { console.log(JSON.stringify({ service: 'smtp', ...describe(error) })); }
    finally { transport.close(); }
  }
}
main().catch(() => { console.error('Cannot run service diagnostics.'); process.exitCode = 1; });
