const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const URL = process.env.GAME_URL || 'http://localhost:5173/';

function checkServer(url) {
  return new Promise((resolve) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(1000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function runScript(scriptPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath], { stdio: 'inherit' });
    child.on('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${path.basename(scriptPath)} a échoué avec le code ${code}`));
    });
  });
}

(async () => {
  let server = null;
  const alreadyUp = await checkServer(URL);
  if (!alreadyUp) {
    console.log('Démarrage du serveur Vite sur le port 5173...');
    server = spawn('npx', ['vite', '--port', '5173', '--strictPort'], {
      cwd: path.resolve(__dirname, '../..'),
      stdio: 'ignore',
    });
    let ready = false;
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 300));
      if (await checkServer(URL)) {
        ready = true;
        break;
      }
    }
    if (!ready) {
      if (server) server.kill();
      console.error('Impossible de démarrer le serveur Vite sur http://localhost:5173/');
      process.exit(1);
    }
  }

  try {
    console.log('\n=== Exécution de t2.cjs (Monde plat en survie) ===');
    await runScript(path.join(__dirname, 't2.cjs'));
    console.log('\n=== Exécution de t3.cjs (Monde normal, créatif, menus) ===');
    await runScript(path.join(__dirname, 't3.cjs'));
    console.log('\n=== Exécution de t4.cjs (Boussole, horloge, carte, panneaux, statistiques) ===');
    await runScript(path.join(__dirname, 't4.cjs'));
    console.log('\n=== Exécution de t5.cjs (Lieux à découvrir : donjons, villages, villageois, badlands, temples, mines) ===');
    await runScript(path.join(__dirname, 't5.cjs'));
    console.log('\n=== Exécution de t6.cjs (Forteresse du Nether : blaze, squelette wither, verrues) ===');
    await runScript(path.join(__dirname, 't6.cjs'));
    console.log('\n=== Exécution de t7.cjs (Créatures : slime, enderman, sorcière, cheval, calamar, golem, chat, laisse, étiquette) ===');
    await runScript(path.join(__dirname, 't7.cjs'));
    console.log('\n=== Exécution de t8.cjs (L’End : perle, œil, fort, portail, cristaux, dragon, retour) ===');
    await runScript(path.join(__dirname, 't8.cjs'));
    console.log('\n=== Exécution de t9.cjs (Équipement : seconde main, bouclier, chaudron, gâteau, alambic, potions) ===');
    await runScript(path.join(__dirname, 't9.cjs'));
    console.log('\n=== Exécution de t10.cjs (Transport : bateau, rails, propulseur, détecteur, wagonnet) ===');
    await runScript(path.join(__dirname, 't10.cjs'));
    console.log('\n=== Exécution de t11.cjs (Redstone avancée : répéteur, comparateur, entonnoir, distributeur, dropper, capteur, bloc musical) ===');
    await runScript(path.join(__dirname, 't11.cjs'));
    console.log('\n=== Exécution de t12.cjs (Construction et décoration : verre teinté, terre cuite, tapis, bois, tableaux, cadres, jukebox) ===');
    await runScript(path.join(__dirname, 't12.cjs'));
    console.log('\n=== Exécution de t13.cjs (Ferme et règles du monde : tiges, cacao, /gamerule, modes, /setblock, /fill) ===');
    await runScript(path.join(__dirname, 't13.cjs'));
    console.log('\n=== Exécution de t14.cjs (Progression guidée : monde plat, monde normal, genVersion, dimensions, chêne noir) ===');
    await runScript(path.join(__dirname, 't14.cjs'));
    console.log('\n=== Exécution de t15.cjs (Plateforme : commandes tactiles, PWA hors ligne, manette) ===');
    await runScript(path.join(__dirname, 't15.cjs'));
    console.log('\n=== Exécution de t16.cjs (Multijoueur : jalon 1, Wi-Fi local) ===');
    await runScript(path.join(__dirname, 't16.cjs'));
    console.log('\nTous les tests E2E sont passés avec succès.');
  } catch (err) {
    console.error('\nÉchec des tests E2E :', err.message);
    process.exitCode = 1;
  } finally {
    if (server) server.kill();
  }
})();
