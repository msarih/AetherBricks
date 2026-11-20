# SarihBricks 3D — Spécification Technique & Fonctionnelle

## 1. Vision du Projet
**SarihBricks 3D** est un jeu de blocs en 3D dans le navigateur, inspiré de *Minecraft* (édition Java 1.12) : monde infini en chunks généré par graine, survie et créatif, minage, fabrication, créatures, cycle jour/nuit, météo, redstone et dimensions (Surface, Nether, End).

---

## 2. Choix Technologiques (Outillage)
- **Moteur 3D** : **Three.js (WebGL2)** avec rendu de chunks maillés en *web workers*, lumière propagée (ciel et blocs) et occlusion ambiante.
- **Langage & Bundler** : **TypeScript 5** (mode strict) + **Vite** pour un démarrage instantané et un typage strict.
- **Textures Procédurales** : Génération sur `HTMLCanvasElement` (tuiles 16×16 assemblées dans un atlas de textures), sans aucune ressource externe.
- **Audio** : **Web Audio API** synthétique (aucun asset externe requis) générant les bruitages et la musique.
- **Persistance** : Sauvegarde automatique et manuelle dans IndexedDB (base `aetherbricks-voxel`, conservée pour compatibilité) et `localStorage` (`aetherbricks.settings`), plus export/import de mondes en fichiers `.aetherworld`.

---

## 3. Contrôles & Physique du Joueur
- **Vue Première Personne (PointerLock)** (et 3ᵉ personne via `F5`) :
  - Déplacements `ZQSD` / `WASD` (repérés par position physique).
  - Saut (`Espace`) avec gravité et détection de collision AABB sur les blocs.
  - **Mode Vol** (double appui sur `Espace` en créatif ou spectateur) et **Course (`Ctrl`)**.
- Voir [README.md](./README.md) pour la liste complète des fonctionnalités, commandes et raccourcis.

---

## 4. Architecture du Code
```text
AetherBricks/
├── index.html              # Point d'entrée HTML (canvas WebGL + conteneur UI)
├── package.json            # Dépendances (three, vite, typescript)
├── tsconfig.json           # Configuration TypeScript stricte
├── SPEC.md                 # Spécification technique du jeu
├── README.md               # Guide d'installation, fonctionnalités et contrôles
└── src/
    ├── main.ts             # Point d'entrée (menu principal, mondes, réglages)
    ├── world/              # Blocs, objets, recettes, chunks, génération (gen/), maillage (mesh/), sauvegarde
    ├── render/             # Atlas de textures, rendu des chunks, ciel, météo, particules, modèles
    ├── entity/             # Physique, créatures, objets, véhicules
    ├── player/             # Joueur et entrées clavier/souris
    ├── game/               # Boucle de jeu (20 ticks/s), interactions, inventaire, conteneurs
    ├── ui/                 # Interface DOM + CSS (menu principal, HUD, inventaires, options, chat)
    └── audio/
        └── Sfx.ts          # Synthétiseur Web Audio API (effets sonores et musique)
```
