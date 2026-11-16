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
- **Créatures** : vaches, cochons, moutons, poules ; zombies, squelettes, creepers et araignées la nuit.
- **Pêche** : canne à pêche (3 bâtons + 2 ficelles) ; un clic droit lance la ligne, un second la remonte. Quand le flotteur s'enfonce, un poisson mord : poisson cru (à cuire au fourneau), parfois un objet sans valeur ou une trouvaille.
- **Modes** : survie et créatif (vol par double appui sur Espace, casse instantanée).
- **Mondes** : plusieurs mondes sauvegardés dans le navigateur (IndexedDB) — créer, renommer, supprimer ; sauvegarde automatique et à la fermeture. Un monde s'exporte dans un fichier `.aetherworld` et s'importe depuis ce fichier (sauvegarde externe, passage d'un navigateur ou d'un appareil à l'autre).
- **Commandes** (touche `/`) : `/help`, `/gamemode`, `/time`, `/weather`, `/give`, `/tp`, `/kill`, `/seed`, `/difficulty`, `/summon`, `/clear`, `/spawnpoint`.

## 🎮 Contrôles

Les touches sont repérées par leur position sur le clavier : sur un clavier QWERTY, `Z Q S D` se lisent `W A S D` et « A » est la touche `Q`.

| Touche / Souris | Action |
| :--- | :--- |
| **Z Q S D** | Avancer, aller à gauche, reculer, aller à droite |
| **Espace** | Sauter (double appui : voler en créatif) |
| **Maj** | S'accroupir (descendre en vol) |
| **Ctrl** | Courir |
| **Clic gauche** | Casser, attaquer |
| **Clic droit** | Poser, utiliser, manger |
| **Clic milieu** | Choisir le bloc visé |
| **Molette, 1 à 9** | Changer de case |
| **E** | Inventaire |
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

- Pas de Nether, d'enchantements, de redstone, de villages ni de multijoueur.
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

