import fs from 'node:fs';
import path from 'node:path';

const file = path.resolve(process.cwd(), '.env');
const env = {};
if (fs.existsSync(file)) {
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    env[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
}

function value(name) {
  const fromProcess = process.env[name];
  if (fromProcess != null && fromProcess !== '') return fromProcess;
  return env[name] || '';
}

const missing = [];
for (const name of ['JWT_SECRET', 'RELIX_WORKER_API_KEY', 'ADMIN_EMAIL', 'DATABASE_URL']) {
  if (!value(name)) missing.push(name);
}
if (value('ADMIN_PASSWORD').length <= 6) missing.push('ADMIN_PASSWORD (must be more than 6 characters)');

const optional = [
  ['OPENAI_API_KEY', 'Ask Relix and image generation stay quiet until this is set'],
  ['SMTP_HOST', 'Lead and approval email is skipped until SMTP_HOST, SMTP_USER, SMTP_PASS, and SMTP_FROM are set'],
  ['SMTP_USER', 'SMTP login'],
  ['SMTP_PASS', 'SMTP password or app password'],
  ['SMTP_FROM', 'From address on outbound mail'],
];
if (value('SOCIAL_PROVIDER') === 'zernio' && !value('ZERNIO_API_KEY')) {
  optional.unshift(['ZERNIO_API_KEY', 'Required only when SOCIAL_PROVIDER=zernio']);
}
if (value('SOCIAL_PROVIDER') === 'ayrshare' && !value('AYRSHARE_API_KEY')) {
  optional.unshift(['AYRSHARE_API_KEY', 'Required only when SOCIAL_PROVIDER=ayrshare']);
}

if (missing.length) {
  console.error('Missing required settings in .env:');
  for (const name of missing) console.error(`  - ${name}`);
  console.error('Copy .env.example to .env and fill these in. See docs/SETUP.md.');
  process.exit(1);
}

console.log('Required settings are present.');
const quiet = optional.filter(([name]) => !value(name));
if (quiet.length) {
  console.log('Optional settings still empty (the app still starts; those jobs skip):');
  for (const [name, why] of quiet) console.log(`  - ${name}: ${why}`);
}
if (value('WORKER_PUBLISH_ENABLED') !== 'true') {
  console.log('WORKER_PUBLISH_ENABLED is not true, so approved posts are not sent.');
}
if (value('WORKER_IMAGEGEN_ENABLED') !== 'true') {
  console.log('WORKER_IMAGEGEN_ENABLED is not true, so images are not generated.');
}
