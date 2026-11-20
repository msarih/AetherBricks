/**
 * Lanceur multiplateforme (macOS, Windows, Linux) pour `npm run serveur`.
 * Construit `dist/` si absent, compile `server/index.ts` avec rolldown, puis lance le serveur.
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { rolldown } from 'rolldown';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distIndex = path.join(rootDir, 'dist', 'index.html');
const outFile = path.join(rootDir, 'dist-server', 'index.mjs');

if (!fs.existsSync(distIndex)) {
  console.log('Compilation du client (dist/) en cours…');
  const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  execFileSync(npmCmd, ['run', 'build'], { cwd: rootDir, stdio: 'inherit' });
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
const bundle = await rolldown({
  input: path.join(rootDir, 'server', 'index.ts'),
  platform: 'node',
  external: ['ws', /^node:/],
});
await bundle.write({
  file: outFile,
  format: 'esm',
});
await bundle.close();

await import(pathToFileURL(outFile).href);
