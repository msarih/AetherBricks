# AetherBricks 3D 🧱✨

Un jeu de blocs en 3D dans le navigateur, au plus près de *Minecraft* : monde infini généré par graine, survie et créatif, minage, fabrication, créatures, cycle jour/nuit et météo. Écrit en TypeScript avec Three.js, sans aucune ressource externe (textures et sons sont générés par le code).

> La première version du projet — le constructeur architectural en briques blanches — est conservée telle quelle : elle s'ouvre par le bouton « Ancienne version » du menu principal, ou directement sur `/legacy.html` (code dans `src/legacy-main.ts`). Sa description d'origine figure plus bas.

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
  - En survie, les objectifs guidés mènent jusqu'au dragon (bâton de blaze, œil de l'Ender, entrée dans l'End, victoire).
- **Modes** : survie et créatif (vol par double appui sur Espace, casse instantanée).
- **Mondes** : plusieurs mondes sauvegardés dans le navigateur (IndexedDB) — créer, renommer, supprimer ; sauvegarde automatique et à la fermeture. Un monde s'exporte dans un fichier `.aetherworld` et s'importe depuis ce fichier (sauvegarde externe, passage d'un navigateur ou d'un appareil à l'autre).
- **Commandes** (touche `/`) : `/help`, `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/kill`, `/seed`, `/difficulty`, `/summon`, `/clear`, `/spawnpoint`, `/locate`.
- **Équipement** : seconde main (touche `F`, case dédiée dans l'inventaire, clic droit secondaire), bouclier (parade frontale après 5 ticks, flèches renvoyées, enclume), chaudron (3 niveaux d'eau, seau, fiole, pluie, extinction), gâteau (7 parts), alambic et potions (fiole, distillation en 400 ticks à la poudre de blaze, soin, rapidité, vision nocturne réelle, force, résistance au feu, poison, régénération, versions allongées/niveau II et jetables, effets affichés à l'écran).

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

- Pas de multijoueur.
- L'End : les forts n'existent que dans les mondes créés à partir de cette version (un monde plus ancien garde son terrain ; en créatif, 12 cadres garnis d'yeux y ouvrent quand même un portail). Écarts avec Minecraft : un fort par case de 768 blocs, au moins à 320 blocs de l'origine, au lieu des anneaux autour de l'origine ; fort sur un seul niveau, sans portes ni blocs infestés ; l'orientation des cadres posés à la main n'est pas vérifiée ; pas d'îles extérieures ni de cités de l'End ; le pourtour de l'île est aplani pour qu'on la rejoigne à pied depuis la dalle d'arrivée ; le dragon n'a qu'une zone de touche (pas de dégâts doublés à la tête) et sa ronde est un cercle ; on ne peut pas le faire revenir avec des cristaux ; l'œuf se ramasse à la pioche ; l'écran de fin tient en trois lignes ; ni le dragon ni le poisson d'argent n'ont de cri propre.
- Lieux à découvrir : uniquement dans les mondes créés à partir de cette version. Écarts avec Minecraft : l'échange avec un villageois se fait en cliquant sur une offre (pas de cases à remplir) ; les zombies n'attaquent pas les villageois ; le temple de la jungle n'a pas de piège à flèches ; dans les mines, les coffres sont posés au sol et les cages donnent des araignées ordinaires ; les rails sont un décor (pas de wagonnet) ; la forteresse a un plan plus simple, sans escaliers.
- Créatures, écarts avec Minecraft : l'étiquette se remplit au moment de l'utiliser (pas d'enclume) ; la selle se pose d'un clic droit (le cheval n'a pas d'inventaire) et le saut ne se dose pas ; pas d'âne, de mule ni d'armure de cheval ; pas de cabane de sorcière dans les marais (elle apparaît dans le noir, rarement) ; les slimes ne dépendent pas de la lune ; la sorcière ne lâche pas de fiole ; les nouvelles créatures n'ont pas de cri propre.
- La boussole indique le point d'apparition du monde, pas le lit ; les cartes ne s'agrandissent pas et restent vierges dans le Nether et dans l'End.
- Équipement, écarts avec Minecraft : le bouclier n'a pas de motif de bannière ni d'étourdissement par hache ; l'alambic n'affiche pas les fioles en 3D sur ses bras ; les potions disponibles sont eau, étrange, soin (I/II), rapidité (I/II/allongée), vision nocturne (normale/allongée), force (I/II/allongée), résistance au feu (normale/allongée), poison (I/II/allongé), régénération (I/II/allongée) et jetables (pas d'œil d'araignée fermenté, de respiration aquatique, d'invisibilité ni de potion persistante) et partagent une icône de fiole bleue (le type est indiqué dans l'infobulle et la barre) ; la vision nocturne ne clignote pas en fin d'effet ; le chaudron ne teint pas les armures en cuir.
- Testé sur Chrome uniquement.

---

# Version d'origine : le constructeur en briques blanches (`/legacy.html`)

Un jeu vidéo 3D de construction architecturale inspiré de *Minecraft*, avec un rendu graphique haute qualité (**PBR**, **ombres douces 4K**, **ACES Filmic Tone Mapping**, **Bloom**, et **briques cubiques chanfreinées à textures procédurales HD**).

On démarre sur un grand **terrain plat** épuré avec des **briques cubiques de couleur blanche** (maçonnerie blanche mate, béton blanc lisse, marbre de Carrare, blanc albâtre, brique lumineuse blanche et verre dépoli blanc).

---

## ✨ Fonctionnalités Principales

- **Rendu 3D Haute Fidélité (Three.js + Post-Processing)** :
  - Cubes avec chanfreins subtils (`RoundedBoxGeometry`) qui accrochent la lumière et dessinent les joints entre chaque brique blanche.
  - Textures PBR générées procéduralement en haute définition (Albédo, Normal/Bump map, Roughness map).
  - Ombres portées temps réel 4096×4096 (`PCFSoftShadowMap`) et 4 ambiances solaires (*Matin Pur*, *Zénith*, *Golden Hour*, *Nuit Claire*).
- **Gameplay & Physique** :
  - Vue à la première personne fluide avec collisions AABB sur le terrain plat et sur les briques posées.
  - **Mode Marche** (avec gravité, saut et sprint) et **Mode Vol Libre (`F`)** pour bâtir en hauteur sans limite.
  - Aperçu fantôme (Ghost Cube) temps réel sur la face visée + particules d'éclats lors de la pose et de la destruction.
  - Synthétiseur audio **Web Audio API** intégré (bruitages de pose en céramique/pierre, destruction, pas).
- **Outils de Studio** :
  - **Undo / Redo** (`Ctrl+Z` / `Ctrl+Y`).
  - **Sauvegarde automatique** (`localStorage`) + **Export / Import JSON**.
  - **Scènes pré-construites** : Terrain Plat Vierge, Socle Initial, Pavillon Minimaliste Blanc, Arche Brutaliste.

---

## 🎮 Contrôles

| Touche / Souris | Action |
| :--- | :--- |
| **Clic Gauche** | Poser une brique blanche sur la face visée |
| **Clic Droit** *(ou Alt + Clic)* | Supprimer la brique visée |
| **Clic Molette** *(ou `P`)* | Pipette (sélectionner la finition de la brique visée) |
| **ZQSD / WASD / Flèches** | Se déplacer |
| **Espace** | Sauter (Marche) / Monter (Mode Vol) |
| **Shift / C** | Sprinter (Marche) / Descendre (Mode Vol) |
| **F** | Activer / Désactiver le **Mode Vol** |
| **T** | Changer l'heure du soleil & l'ambiance lumineuse |
| **1 – 6** *(ou Molette)* | Choisir la finition de brique blanche |
| **Ctrl + Z / Ctrl + Y** | Annuler / Rétablir |
| **Échap** | Ouvrir le Menu Studio |

---

## 🚀 Installation & Lancement

```bash
npm install
npm run dev
```

Pour compiler la version de production :
```bash
npm run build
```

Consultez [SPEC.md](./SPEC.md) pour la spécification fonctionnelle et technique détaillée.

