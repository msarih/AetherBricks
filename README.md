# SarihBricks 3D 🧱✨

Un jeu de blocs en 3D dans le navigateur, au plus près de *Minecraft* : monde infini généré par graine, survie et créatif, minage, fabrication, créatures, cycle jour/nuit et météo. Écrit en TypeScript avec Three.js, sans aucune ressource externe (textures et sons sont générés par le code).

## 🚀 Installation & Lancement

```bash
npm install
npm run dev      # puis ouvrir http://localhost:5173/
npm run build    # version de production dans dist/
```

## 🌍 Le jeu

- **Monde** : chunks de 16×128×16 générés à la demande dans des *workers* (biomes, reliefs, grottes, minerais, arbres, rivières et océans), monde normal ou plat, graine au choix.
- **Lumière** : lumière du ciel et des blocs propagée bloc par bloc (torches, lave…), occlusion ambiante, cycle jour/nuit, soleil, lune, étoiles, nuages, pluie et orage.
- **Survie** : santé, faim, air sous l'eau, dégâts de chute, mort et réapparition, lit pour passer la nuit et fixer son point d'apparition.
- **Blocs et objets** : casser et poser, outils et vitesses de minage, butins, eau et lave qui s'écoulent, TNT, portes, échelles, cultures, coffres, établi et fourneau.
- **Inventaire et fabrication** : inventaire à la souris, grille 2×2, établi 3×3, cuisson au fourneau, inventaire créatif avec recherche.
- **Créatures** : vaches, cochons, moutons, poules et loups ; zombies, squelettes, creepers et araignées la nuit ; dans le Nether, cochons-zombies, ghasts, cubes de magma, blazes et squelettes wither. S'y ajoutent :
  - le **slime**, dans les marais la nuit et en profondeur : tué, un gros se divise en plus petits, qui lâchent des boules de slime (piston collant, laisse) ;
  - l'**enderman** : paisible tant qu'on ne le regarde pas dans les yeux, il se téléporte, craint l'eau, esquive les flèches et déplace des blocs ; il lâche des perles de l'Ender ;
  - la **sorcière**, qui jette des potions : poison (cœurs verts, ne tue pas), lenteur, faiblesse, dégâts. Un seau de lait dissipe tout ;
  - le **cheval**, en troupeaux dans les plaines et la savane. On l'apprivoise en le montant à mains nues (il désarçonne plusieurs fois ; sucre, blé et pommes aident). Une fois apprivoisé, un clic droit avec une selle le selle : il va alors où l'on regarde, `Espace` le fait sauter, `Maj` fait descendre. Vie, vitesse et détente varient d'un cheval à l'autre ;
  - le **calamar**, en mer et en rivière, qui lâche de l'encre (colorant noir) ;
  - le **golem de fer** : chaque village a le sien, qui s'en prend aux monstres. On en construit un avec quatre blocs de fer en T et une citrouille posée dessus ;
  - l'**ocelot** des jungles : farouche, il s'approche si l'on tient du poisson cru, et peut s'apprivoiser en chat. Le chat suit son maître, s'assoit d'un clic droit, et les creepers l'évitent ;
  - la **laisse** (4 ficelles + 1 boule de slime) : clic droit sur un animal pour le promener, puis sur une barrière pour l'y attacher ; un clic droit sur l'animal le détache. L'**étiquette** donne un nom à une créature (clic droit, puis saisie du nom) : il s'affiche au-dessus d'elle et elle ne disparaît plus. Selle et étiquette se trouvent dans les coffres et à la pêche.
- **Pêche** : canne à pêche (3 bâtons + 2 ficelles) ; un clic droit lance la ligne, un second la remonte. Quand le flotteur s'enfonce, un poisson mord : poisson cru (à cuire au fourneau), parfois un objet sans valeur ou une trouvaille.
- **S'y retrouver** : la boussole (4 lingots de fer + 1 redstone) pointe vers le point d'apparition du monde ; l'horloge (4 lingots d'or + 1 redstone) montre le soleil ou la lune ; la carte vierge (8 papiers + 1 boussole) devient, d'un clic droit, la carte de la zone de 128 × 128 blocs où l'on se tient, et se dessine tant qu'on la tient en main ; les panneaux (6 planches + 1 bâton) portent 4 lignes de texte. Le menu de pause donne les statistiques du joueur (distances, blocs minés, objets fabriqués, créatures vaincues).
- **Lieux à découvrir** (dans les mondes créés à partir de cette version ; les mondes plus anciens gardent leur terrain tel quel) :
  - **Donjons** : petite salle de pierres moussues ouverte sur une grotte, avec une cage qui fait apparaître des monstres tant qu'il fait noir, et un ou deux coffres.
  - **Coffres à butin** : leur contenu est tiré à la première ouverture, à partir de la graine du monde.
  - **Villages** (plaine, savane, désert) : puits, chemins, maisons, bibliothèque, église, forge avec son coffre, boucherie, champs, lampadaires.
  - **Villageois** : cinq métiers reconnaissables à la robe. Un clic droit ouvre leurs échanges : on leur vend des denrées contre des émeraudes, on leur achète des objets. Un premier échange débloque le palier d'offres suivant. Ils rentrent chez eux la nuit et ouvrent les portes.
  - **Pyramide du désert** : quatre coffres sous le bloc bleu du sol… et une plaque de pression posée sur de la TNT.
  - **Temple de la jungle** : un coffre au sous-sol, un second caché derrière un bloc que retient un piston ; relever le levier l'ouvre.
  - **Mines abandonnées** : galeries étayées, rails, toiles d'araignée, coffres et cages à araignées.
  - **Badlands** : plateaux de terre cuite en strates colorées et sable rouge. La terre cuite se fabrique aussi (argile cuite au fourneau), en 16 couleurs (8 terres cuites autour d'une teinture).
  - **Forteresse du Nether** : ponts et couloirs de briques du Nether, cages à blazes, salle où poussent les verrues du Nether, coffres. On y croise le **blaze** (salves de boules de feu, lâche un bâton de blaze) et le **squelette wither** (ses coups flétrissent : la vie baisse encore 10 secondes).
  - `/locate <village|temple|jungle|mine|forteresse|fort>` donne la position du lieu le plus proche.
- **L'End, la fin du jeu** :
  - La **perle de l'Ender** se lance (clic droit) : elle téléporte là où elle tombe, au prix de 2 cœurs et demi. Une seconde d'attente entre deux lancers.
  - L'**œil de l'Ender** (1 perle + 1 poudre de blaze ; un bâton de blaze donne 2 poudres) montre le chemin : lancé, il s'élève et file vers le fort le plus proche, puis retombe (une fois sur cinq, il se brise). Là où il plonge vers le sol, il faut creuser.
  - Le **fort** est enfoui sous terre (mondes créés à partir de cette version) : un escalier en colimaçon, des couloirs de briques de pierre, une bibliothèque, une prison, une fontaine, une réserve, et la **salle du portail**. Douze cadres y entourent un bassin de lave, gardés par une cage à poissons d'argent. Un œil de l'Ender posé sur chaque cadre (clic droit) ouvre le portail ; il n'y a plus qu'à sauter dedans.
  - L'**End** est une île de pierre pâle dans le vide, sous un ciel noir. On arrive sur une dalle d'obsidienne au bord de l'île. Dix piliers d'obsidienne portent chacun un **cristal** qui soigne le dragon quand il passe près de lui : un coup ou une flèche le fait exploser (deux sont protégés par une cage de barreaux).
  - Le **dragon de l'Ender** (100 cœurs, barre de vie en haut de l'écran) tourne autour des piliers, crache des boules qui laissent un nuage brûlant, fonce sur le joueur, et vient par moments se poser sur la fontaine centrale : c'est là que l'épée l'atteint (posé, ses écailles renvoient les flèches).
  - À sa mort, la fontaine devient le **portail de sortie**, un œuf de dragon apparaît à son sommet et le joueur reçoit une montagne d'expérience. Le portail ramène à la surface, au point de réapparition, avec un écran de fin la première fois. Le portail du fort reste ouvert : on peut retourner dans l'End.
  - Mourir dans le Nether ou dans l'End fait réapparaître à la surface.
  - En survie sur un monde normal, les objectifs guidés mènent jusqu'au dragon (bâton de blaze, œil de l'Ender, entrée dans l'End, victoire) ; ils sont masqués en monde plat et filtrés selon la dimension et les lieux présents dans le monde.
- **Modes** : survie et créatif (vol par double appui sur Espace, casse instantanée).
- **Mondes** : plusieurs mondes sauvegardés dans le navigateur (IndexedDB) — créer, renommer, supprimer ; sauvegarde automatique et à la fermeture. Un monde s'exporte dans un fichier `.aetherworld` et s'importe depuis ce fichier (sauvegarde externe, passage d'un navigateur ou d'un appareil à l'autre).
- **Commandes** (touche `/`) : `/help`, `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/kill`, `/seed`, `/difficulty`, `/summon`, `/clear`, `/spawnpoint`, `/locate`, `/gamerule`, `/setblock`, `/fill`.
- **Équipement** : seconde main (touche `F`, case dédiée dans l'inventaire, clic droit secondaire), bouclier (parade frontale après 5 ticks, flèches renvoyées, enclume), chaudron (3 niveaux d'eau, seau, fiole, pluie, extinction), gâteau (7 parts), alambic et potions (fiole, distillation en 400 ticks à la poudre de blaze, soin, rapidité, vision nocturne réelle, force, résistance au feu, poison, régénération, versions allongées/niveau II et jetables, effets affichés à l'écran).
- **Transport** : bateau en chêne (pose sur l'eau, conduite ZQSD, flotte et glisse peu sur terre, capture les créatures qui le touchent), rails à raccordement automatique (lignes droites, virages, montées d'un bloc), rail propulseur (accélère allumé, freine éteint), rail détecteur (émet un signal redstone) et wagonnet (pose sur rail, conduite Z, poussée à pied, embarquement des créatures, utilisable sur les rails des mines abandonnées).
- **Redstone avancée** : répéteur (délai de 1 à 4 ticks au clic droit, verrouillage latéral), comparateur (modes comparaison et soustraction, lecture du remplissage 0..15 des conteneurs), entonnoir (transfert automatique à 5 cases, verrouillage sous signal), distributeur et dropper (9 cases, déclenchement sur front de signal), capteur de lumière du jour (0..15 selon la lumière du ciel, inversion au clic droit) et bloc musical (25 notes, instrument selon le bloc dessous, déclenchement sur front).
- **Construction et décoration** : verre teinté (16 couleurs), terre cuite colorée (16 couleurs), tapis de laine (16 couleurs, franchissables sans bloquer ni le joueur ni les créatures), portes, barrières et portillons dans les six essences (chêne, sapin, bouleau, acajou, acacia, chêne noir), tableaux muraux (10 motifs de 1×1 à 2×2), cadres à accrocher (exposition et rotation de tout objet au clic droit) et jukebox avec 6 disques de musique synthétisés (`13` et `cat` trouvés dans les coffres des donjons).
- **Ferme et règles du monde** : graines de citrouille et de pastèque (tiges de stades 0 à 7 s'inclinant vers le fruit apparu à côté, poudre d'os), cacao en 3 stades sur les bûches d'acajou et recette des cookies, `/gamerule` (`keepInventory`, `doDaylightCycle`, `doMobSpawning`, `mobGriefing`, `doFireTick`, `naturalRegeneration` sauvegardées avec le monde), modes de jeu `adventure` (aucune casse ni pose de blocs, portes/coffres/leviers et combat actifs), `spectator` (vol libre sans collision ni dégâts, invisible aux créatures) et `Extrême` (hardcore : survie difficile verrouillée, passage en spectateur à la mort), plus `/setblock` et `/fill` (`replace`, `hollow`, `outline`, `destroy`, `keep` jusqu'à 32 768 blocs).

## 📱 Plateforme (tactile, manette et application hors ligne)

- **Téléphone et tablette (commandes tactiles)** :
  - Détection automatique dès le premier contact tactile ou sur un écran `pointer: coarse`, avec un réglage dans **Options → Commandes tactiles** (`auto` / `activé` / `désactivé`).
  - **Déplacement** : joystick virtuel en bas à gauche.
  - **Regard** : glisser le doigt sur le reste de l'écran.
  - **Sauter et voler** : bouton **▲** à droite (en créatif, un double appui active ou coupe le vol).
  - **S'accroupir** : bouton **▼** à droite (maintient l'accroupissement ou fait descendre en vol).
  - **Casser / poser / attaquer** : un **appui long** maintenu casse le bloc visé (avec la même progression de casse qu'à la souris) ; un **appui court** pose le bloc tenu, active le bloc visé (porte, coffre, établi…) ou attaque la créature visée.
  - **Barre d'objets et inventaire** : toucher une case de la barre la sélectionne ; le bouton **⋯** à droite de la barre ouvre l'inventaire. Dans tous les écrans de cases (inventaire, coffre, établi, fourneau…), toucher une case prend la pile, toucher une autre la dépose, et le bouton **✕** referme la fenêtre.
  - **Barre supérieure** : boutons **⏸** (pause), **💬** (discussion / commandes pré-remplies avec `/`) et **👁** (vue 1re / 3e personne).
  - L'interface s'adapte en mode **portrait** (téléphone) et **paysage** (téléphone et tablette), sans zoom ni défilement parasite.
- **Manette de jeu (Xbox / PlayStation, API Gamepad standard)** :
  - **Stick gauche** : se déplacer ; **clic du stick gauche (L3)** : courir (sprint).
  - **Stick droit** : tourner le regard (sensibilité dédiée dans **Options → Sensibilité manette**, avec zone morte).
  - **Gâchette droite (RT / R2)** : casser / attaquer ; **gâchette gauche (LT / L2)** : poser / utiliser.
  - **A / Croix** : sauter (double appui : voler en créatif) ; **B / Rond** : s'accroupir ; **X / Carré** : jeter l'objet tenu ; **Y / Triangle** : ouvrir l'inventaire.
  - **Gâchettes hautes (LB / RB ou L1 / R1)** : case précédente / suivante dans la barre d'objets.
  - **Start / Options** : mettre en pause.
  - **Dans les menus et inventaires** : croix directionnelle ou stick gauche pour déplacer le curseur jaune d'un bouton ou d'une case à l'autre, **A / Croix** pour valider, **B / Rond** pour revenir ou fermer.
  - Branchement et débranchement à chaud signalés à l'écran.
- **Installation comme application et jeu hors ligne (PWA)** :
  - Le jeu fournit un manifeste Web (`manifest.webmanifest`), des icônes 192×192 et 512×512 et un *service worker* (`sw.js`).
  - Sur ordinateur (Chrome / Edge : icône « Installer SarihBricks » dans la barre d'adresse) ou sur téléphone/tablette (« Ajouter à l'écran d'accueil »), le jeu s'installe comme une application plein écran autonome (`display: standalone`).
  - Une fois ouvert une première fois en ligne, **le jeu démarre et se joue entièrement hors ligne** (création de mondes, génération et maillage dans les *workers*, sauvegarde IndexedDB et rechargement). Lorsqu'une nouvelle version est déployée, le cache est mis à jour et un message prévient si une mise à jour attend un rechargement.

## 🤖 Application Android (.apk, hors Play Store)

Le jeu peut être emballé dans une vraie application Android autonome (via **Capacitor**), qui embarque la version de production (`dist/`), fonctionne **100 % hors ligne** sans serveur, s'affiche en plein écran (portrait ou paysage, écran maintenu allumé en jeu) et prend en charge les commandes tactiles, la manette et le bouton **Retour** d'Android (ouvre la pause en jeu ou revient en arrière dans un menu).

### Fabriquer le fichier `.apk`

Prérequis sur la machine de build : Node.js, le SDK Android (`ANDROID_HOME`, par défaut `~/Library/Android/sdk`) et Java 21 (`JAVA_HOME`, par défaut le JDK inclus dans Android Studio).

```bash
npm run android:apk
```

Cette commande construit le jeu (`npm run build`), synchronise le projet Android (`npx cap sync android`), incrémente automatiquement le `versionCode` (stocké dans `android/.version-code`, non commité), assemble et signe l'APK, puis place le fichier final dans `release/SarihBricks.apk` (non commité).

Pour forcer un numéro de version précis :

```bash
SARIHBRICKS_VERSION_CODE=10 SARIHBRICKS_VERSION_NAME=1.0.1 npm run android:apk
```

### Clé de signature locale et sauvegarde

La signature de l'APK repose sur deux fichiers locaux **non commités** (ignorés par Git) :

- `android/sarihbricks-release.keystore` : la clé de signature (créée au premier lancement si absente).
- `android/keystore.properties` : le fichier contenant `storePassword`, `keyAlias` et `keyPassword` (les variables d'environnement `SARIHBRICKS_KEYSTORE_PASSWORD`, `SARIHBRICKS_KEY_ALIAS` et `SARIHBRICKS_KEY_PASSWORD` restent prioritaires si définies).

**Sauvegardez ces deux fichiers hors du Mac** (coffre-fort de mots de passe, disque externe chiffré, etc.) : tant que les nouvelles versions sont signées avec la même clé, elles s'installent par-dessus l'application existante **sans perdre vos mondes**. Si la clé est perdue, il faudra désinstaller l'application avant d'installer un nouvel APK (ce qui efface les mondes non exportés).

Pour reconstruire l'APK sur une autre machine, copiez `sarihbricks-release.keystore` et `keystore.properties` dans `android/` avant de lancer `npm run android:apk`.

### Installer sur un téléphone Android

1. Copiez `release/SarihBricks.apk` sur votre téléphone (câble USB, AirDrop/Nearby Share, email, Google Drive, etc.).
2. Ouvrez l'application **Fichiers** (ou **Mes fichiers**) sur le téléphone et appuyez sur `SarihBricks.apk`.
3. Si Android demande l'autorisation d'installer des applications inconnues depuis cette source, ouvrez **Paramètres** et activez **Autoriser cette source**, puis revenez en arrière.
4. Appuyez sur **Installer**, puis sur **Ouvrir** (l'icône **SarihBricks** apparaît ensuite sur votre écran d'accueil).

### Mettre à jour l'application

Fabriquez un nouvel APK avec `npm run android:apk` (en utilisant la même clé `android/sarihbricks-release.keystore`), copiez-le sur le téléphone et ouvrez-le : Android propose **Mettre à jour** et conserve tous vos mondes et réglages.

### Limites de l'application Android

- Installation manuelle par fichier `.apk` (pas de mise à jour automatique via Google Play).
- Les mondes sont stockés dans le stockage interne de l'application (IndexedDB) : utilisez l'export `.aetherworld` si vous voulez une sauvegarde externe ou transférer un monde vers un autre appareil.
- Les mêmes limites de jouabilité que la version navigateur (pas de vibrations manette, limites du multijoueur jalon 1).

## 🌐 Multijoueur (Wi-Fi local et Tailscale — Jalon 2)

Un joueur lance un serveur Node.js autoritaire sur son ordinateur ; ses amis le rejoignent depuis un navigateur (ordinateur ou téléphone) ou depuis l'application Android.

### Ouvrir un monde solo aux amis (par code)

1. Lancez le serveur sur votre Mac : `npm run serveur` (ou ouvrez directement le jeu à l'adresse du serveur, par défaut `http://localhost:8080`).
2. En jeu solo, ouvrez le menu de pause (`Échap`) et cliquez sur **Ouvrir aux amis**. Le monde est envoyé au serveur et un **code d'invitation** (ex. `SB-XXXXX-XXXXX-XXXXX-XXXXX`) s'affiche avec un bouton **Copier le code**.
3. Vos amis ouvrent **Multijoueur**, saisissent leur pseudo et **uniquement ce code** (insensible à la casse et aux tirets) : l'adresse et le port du serveur sont encodés dans le code.
4. Cliquez sur **Fermer aux amis** (ou quittez la partie) pour invalider le code, renvoyer les amis au menu et récupérer toutes les modifications effectuées à plusieurs dans votre monde solo.

### Lancer un serveur dédié

```bash
npm run serveur -- --password monsecret
```

Options utiles :
- `--port 8080` : port HTTP et WebSocket (8080 par défaut) ;
- `--import chemin/monde.aetherworld` : importe un monde exporté comme monde actif du serveur ;
- `--flat` : monde plat (normal par défaut) ;
- `--seed 1337` : graine du monde ;
- `--gamemode creative` : mode de jeu par défaut (`survival` par défaut) ;
- ou un fichier `server-data/config.json` (non commité) contenant `{ "password": "monsecret" }`.

Au démarrage, le serveur affiche les adresses à partager :
- **Wi-Fi local** : `http://192.168.x.x:8080`
- **Tailscale** (si actif) : `http://100.x.x.x:8080`

### Ce qui est partagé et sauvegardé (Jalon 2)

- **Blocs et simulation** : casse et pose validées par le serveur (portée, mode de jeu, objet présent dans l'inventaire en survie) et diffusées aux joueurs à portée ; chute du sable/gravier, écoulement de l'eau et de la lave, feu et cultures simulés sur le serveur.
- **Inventaire, temps et météo** : inventaire géré par le serveur (en survie, casser un bloc place directement l'objet dans l'inventaire) ; temps et météo synchronisés.
- **Droits de l'hôte** : seul l'hôte (celui qui a ouvert le monde ou connaît le mot de passe) peut utiliser `/gamemode`, `/tp`, `/time` et fermer le monde.
- **Sauvegarde serveur** : chunks modifiés et un fichier par joueur (`server-data/worlds/default/players/`) enregistrés toutes les 30 secondes et à l'arrêt du serveur.

### Limites du jalon 2

- Les objets au sol arrivent au jalon 3 : en attendant, casser un bloc en survie place directement le butin dans l'inventaire.
- Pas encore de créatures, de coffres/fourneaux synchronisés, de combat ni de changement de dimension en multijoueur ; un seul monde actif par serveur.

## 🎮 Contrôles

Les touches sont repérées par leur position sur le clavier : sur un clavier QWERTY, `Z Q S D` se lisent `W A S D` et « A » est la touche `Q`.

| Touche / Souris | Action |
| :--- | :--- |
| **Z Q S D** | Avancer, aller à gauche, reculer, aller à droite |
| **Espace** | Sauter (double appui : voler en créatif) |
| **Maj** | S'accroupir (descendre en vol) |
| **Ctrl** | Courir |
| **Clic gauche** | Casser, attaquer |
| **Clic droit** | Poser, utiliser, manger ; monter à cheval, nourrir, attacher |
| **Clic milieu** | Choisir le bloc visé |
| **Molette, 1 à 9** | Changer de case |
| **E** | Inventaire |
| **F** | Échanger main principale et seconde main |
| **A** | Lâcher l'objet |
| **T** / **/** | Chat / commande |
| **F1** / **F3** / **F5** | Cacher l'interface / écran de débogage / vue à la 3ᵉ personne |
| **Échap** | Pause |

## 🧭 Organisation du code

| Dossier | Contenu |
| :--- | :--- |
| `src/world/` | blocs, objets, recettes, chunks, génération (`gen/`), maillage (`mesh/`), fluides, sauvegarde |
| `src/render/` | atlas de textures, rendu des chunks, ciel, météo, particules, modèles |
| `src/entity/`, `src/player/` | physique, créatures, joueur, entrées clavier/souris |
| `src/game/` | boucle de jeu, interactions (casser, poser, utiliser), menus de conteneurs |
| `src/ui/` | menu principal, HUD, inventaires, options, chat |
| `dev-tests/` | pages d'essai isolées utilisées pendant le développement |

## ⚠️ Limites connues

- Multijoueur (jalon 2) : « Ouvrir aux amis » par code secret, blocs partagés, inventaire survie direct (les objets au sol arrivent au jalon 3), temps/météo synchronisés, sauvegarde serveur ; les créatures, les conteneurs, le combat et les dimensions arriveront aux jalons suivants.
- L'End : les forts n'existent que dans les mondes créés à partir de cette version (un monde plus ancien garde son terrain ; en créatif, 12 cadres garnis d'yeux y ouvrent quand même un portail). Écarts avec Minecraft : un fort par case de 768 blocs, au moins à 320 blocs de l'origine, au lieu des anneaux autour de l'origine ; fort sur un seul niveau, sans portes ni blocs infestés ; l'orientation des cadres posés à la main n'est pas vérifiée ; pas d'îles extérieures ni de cités de l'End ; le pourtour de l'île est aplani pour qu'on la rejoigne à pied depuis la dalle d'arrivée ; le dragon n'a qu'une zone de touche (pas de dégâts doublés à la tête) et sa ronde est un cercle ; on ne peut pas le faire revenir avec des cristaux ; l'œuf se ramasse à la pioche ; l'écran de fin tient en trois lignes ; ni le dragon ni le poisson d'argent n'ont de cri propre.
- Lieux à découvrir : uniquement dans les mondes créés à partir de cette version. Écarts avec Minecraft : l'échange avec un villageois se fait en cliquant sur une offre (pas de cases à remplir) ; les zombies n'attaquent pas les villageois ; le temple de la jungle n'a pas de piège à flèches ; dans les mines, les coffres sont posés au sol et les cages donnent des araignées ordinaires ; la forteresse a un plan plus simple, sans escaliers.
- Transport, écarts avec Minecraft : une seule essence de bateau (chêne) ; pas de wagonnet à coffre, à fourneau ni à TNT ; un seul passager à la fois dans un bateau.
- Redstone avancée, écarts avec Minecraft : les délais de répéteur sont exprimés en ticks de jeu (1 à 4 ticks) plutôt qu'en ticks redstone doubles (2 à 8) ; la portée des distributeurs/droppers exclut les quasi-connexions et les seaux/briquets ne réagissent qu'aux cas principaux (eau, lave, feu, flèche, boule de neige, œuf, perle, potion jetable, TNT, poudre d'os) ; les instruments du bloc musical sont synthétisés par Web Audio sans banque d'échantillons externe.
- Créatures, écarts avec Minecraft : l'étiquette se remplit au moment de l'utiliser (pas d'enclume) ; la selle se pose d'un clic droit (le cheval n'a pas d'inventaire) et le saut ne se dose pas ; pas d'âne, de mule ni d'armure de cheval ; pas de cabane de sorcière dans les marais (elle apparaît dans le noir, rarement) ; les slimes ne dépendent pas de la lune ; la sorcière ne lâche pas de fiole ; les nouvelles créatures n'ont pas de cri propre.
- La boussole indique le point d'apparition du monde, pas le lit ; les cartes ne s'agrandissent pas et restent vierges dans le Nether et dans l'End.
- Équipement, écarts avec Minecraft : le bouclier n'a pas de motif de bannière ni d'étourdissement par hache ; l'alambic n'affiche pas les fioles en 3D sur ses bras ; les potions disponibles sont eau, étrange, soin (I/II), rapidité (I/II/allongée), vision nocturne (normale/allongée), force (I/II/allongée), résistance au feu (normale/allongée), poison (I/II/allongé), régénération (I/II/allongée) et jetables (pas d'œil d'araignée fermenté, de respiration aquatique, d'invisibilité ni de potion persistante) et partagent une icône de fiole bleue (le type est indiqué dans l'infobulle et la barre) ; la vision nocturne ne clignote pas en fin d'effet ; le chaudron ne teint pas les armures en cuir.
- Construction et décoration, écarts avec Minecraft : le chêne noir (`dark_oak_log`, `dark_oak_planks`) n'est pas encore présent dans la génération naturelle du terrain (accessible par `/give` ou en créatif pour fabriquer les variantes en chêne noir) ; 10 tableaux sont inclus (formats 1×1, 2×1, 1×2 et 2×2) ; 6 disques de musique sur les 12 de la 1.12 (`13`, `cat`, `blocks`, `chirp`, `far`, `wait`, joués par synthèse Web Audio sans banque d'échantillons externe) ; les vitres teintées, les dalles/escaliers en chêne noir et la terre cuite émaillée ne sont pas inclus.
- Ferme et règles du monde, écarts avec Minecraft : le cacao ne se génère pas à l'état naturel dans la jungle (teinture brune accessible via `/give` ou le menu créatif) ; les règles `/gamerule` portent sur les 6 règles booléennes principales (`keepInventory`, `doDaylightCycle`, `doMobSpawning`, `mobGriefing`, `doFireTick`, `naturalRegeneration`) ; en mode `adventure`, les balises d'exception NBT (`CanDestroy`/`CanPlaceOn`) ne sont pas prises en charge ; `/fill` accepte la syntaxe simple par bloc et mode (sans filtre `replace <blocFiltre>`).
- Plateforme (tactile, manette, hors ligne), écarts avec Minecraft : en tactile, la visée reste au réticule central (comme le mode « réticule divisé / split controls » de l'édition Bedrock, sans casse déportée sous le doigt hors du centre) et le déplacement utilise un joystick virtuel plutôt qu'une croix directionnelle à 5 touches ; dans l'inventaire au doigt ou à la manette, un appui prend ou pose toute la pile d'un coup (pas de jauge d'appui long pour diviser une pile au doigt, ni de raccourci de transfert rapide par bouton Y/Triangle dans les conteneurs) ; les boutons de la manette suivent la disposition standard du navigateur sans écran de remappage individuel des boutons de manette ni vibrations.
- Testé sur Chrome uniquement.

