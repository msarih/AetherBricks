/**
 * Obtient un certificat HTTPS Tailscale (`tailscale cert`) pour cette machine
 * et le range dans `server-data/` (non commité).
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.join(rootDir, 'server-data');
const certFile = path.join(dataDir, 'tailscale-cert.pem');
const keyFile = path.join(dataDir, 'tailscale-key.pem');
const domainFile = path.join(dataDir, 'tailscale-domain.txt');

function runTailscale(args) {
  return execFileSync('tailscale', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

let statusJson;
try {
  statusJson = JSON.parse(runTailscale(['status', '--json']));
} catch (err) {
  console.error('Impossible d’exécuter `tailscale status --json`.');
  console.error('Vérifiez que Tailscale est installé, lancé et connecté sur cette machine.');
  if (err && err.stderr) console.error(String(err.stderr).trim());
  process.exit(1);
}

const rawDns = statusJson?.Self?.DNSName ?? '';
const domain = String(rawDns).replace(/\.+$/, '');
if (!domain || !domain.includes('.')) {
  console.error('Nom DNS Tailscale introuvable (MagicDNS désactivé ?).');
  console.error('Activez MagicDNS dans la console Tailscale : https://login.tailscale.com/admin/dns');
  process.exit(1);
}

fs.mkdirSync(dataDir, { recursive: true });
console.log(`Demande de certificat HTTPS Tailscale pour : ${domain}`);

try {
  execFileSync('tailscale', ['cert', '--cert-file', certFile, '--key-file', keyFile, domain], {
    stdio: 'inherit',
  });
} catch (err) {
  console.error('\nÉchec de `tailscale cert`.');
  console.error('Si les certificats HTTPS ne sont pas activés sur votre compte Tailscale :');
  console.error('  1. Ouvrez https://login.tailscale.com/admin/dns');
  console.error('  2. Activez « MagicDNS » puis cliquez sur « Enable HTTPS » dans la section « HTTPS Certificates ».');
  console.error('  3. Relancez ensuite `npm run serveur:tailscale-cert`.');
  process.exit(1);
}

fs.writeFileSync(domainFile, `${domain}\n`, 'utf8');
console.log(`\nCertificat enregistré dans :`);
console.log(`  - ${certFile}`);
console.log(`  - ${keyFile}`);
console.log(`  - ${domainFile}`);
console.log(`\nLancez maintenant le serveur avec : npm run serveur -- --https`);
