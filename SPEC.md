# AetherBricks 3D — Spécification Technique & Fonctionnelle

## 1. Vision du Projet
**AetherBricks 3D** est un jeu vidéo de construction architecturale en 3D inspiré de *Minecraft*, conçu avec un rendu graphique haute fidélité (PBR — *Physically Based Rendering*, ombres douces temps réel, éclairage atmosphérique dynamique, textures procédurales haute résolution avec joints de briques et normal maps).

L'expérience démarre sur un **vaste terrain plat architectural** épuré, mettant à disposition des **briques cubiques blanches** haute qualité pour bâtir des structures minimalistes, brutalistes ou néo-modernes avec un rendu réaliste de la lumière et des ombres.

---

## 2. Choix Technologiques (Outillage)
- **Moteur 3D** : **Three.js (WebGL2)** avec pipeline PBR (`MeshStandardMaterial` & `MeshPhysicalMaterial`), ACES Filmic Tone Mapping, et Shadow Mapping (`PCFSoftShadowMap` 4096×4096).
- **Post-Processing** : `EffectComposer` avec `RenderPass`, `UnrealBloomPass` subtil (éclat réaliste des surfaces blanches au soleil et blocs lumineux) et `OutputPass`.
- **Langage & Bundler** : **TypeScript 5** + **Vite** pour un démarrage instantané, un typage strict et d'excellentes performances.
- **Textures Procédurales HD** : Génération sur `HTMLCanvasElement` (1024×1024) de cartes d'albédo, de rugosité (*roughness map*) et de relief (*normal/bump map*) simulant le grain de la brique blanche, les chanfreins (bevels) et les joints de mortier.
- **Audio** : **Web Audio API** synthétique (aucun asset externe requis) générant des bruitages acoustiques réalistes pour la pose de brique, la destruction, le saut et les pas.
- **Persistance** : Sauvegarde automatique et manuelle dans `localStorage` + Export/Import de fichiers `.json` + Modèles pré-construits (Arche, Pavillon, Tour).

---

## 3. Fonctionnalités de Base (MVP+)

### 3.1. Environnement & Terrain Plat
1. **Terrain Plat Infini/Étendu** : Plateau architectural de 120×120 mètres avec grille métrique subtile gravée, surface mate antireflet et récevant les ombres portées.
2. **Éclairage Solaire & Cycle Jour/Heure** :
   - Soleil directionnel projetant des ombres douces haute résolution.
   - Contrôle de l'heure du jour (Aube, Midi, Golden Hour / Coucher de soleil, Nuit étoilée) pour admirer le jeu d'ombres sur les briques blanches.
   - Brouillard atmosphérique exponentiel calé sur la couleur du ciel.

### 3.2. Système de Construction (Voxel / Briques Blanches)
1. **Briques Cubiques Blanches (1×1×1m)** avec géométrie chanfreinée/texturée PBR :
   - **Brique Blanche Classique (Grout)** : Texture de brique architecturale peinte en blanc mat avec joints fins.
   - **Brique Blanche Lisse (Monolithe)** : Béton blanc poli ultra-minimaliste avec chanfrein subtil.
   - **Brique Marbre Blanc** : Finition satinée avec de légères veines minérales blanches/grises.
   - **Brique Ivoire Chaud** : Nuance blanc cassé / calcaire naturel.
   - **Brique Lumineuse Blanche (Néons/Lantern)** : Cube émissif blanc pur pour éclairer les créations la nuit.
   - **Brique Verre Architectural Blanc (Dépoli)** : Cube translucide givré pour les ouvertures.
2. **Raycasting & Aperçu Fantôme (Wireframe + Ghost Block)** :
   - Détection précise de la face visée (sol ou brique existante).
   - Affichage d'un cube fantôme semi-transparent avec arêtes lumineuses à l'emplacement exact où la prochaine brique sera posée.
3. **Actions de Construction** :
   - **Clic Gauche** : Poser une brique blanche sur la face ciblée.
   - **Clic Droit** (ou `Alt + Clic`) : Supprimer la brique ciblée (avec particules d'éclats blancs).
   - **Clic Molette** (ou touche `P`) : Pipette (sélectionner le type de brique visé).
   - **Outil Ligne / Mur rapide** : Maintenir `Maj (Shift)` ou activer le mode Pilier/Empilement pour bâtir plus rapidement.
   - **Annuler / Rétablir (Undo / Redo)** : `Ctrl+Z` / `Ctrl+Y` avec historique complet des actions.

### 3.3. Contrôles & Physique du Joueur
1. **Vue Première Personne (PointerLock)** :
   - Déplacements `ZQSD` / `WASD` + Flèches directionnelles.
   - Saut (`Espace`) avec gravité et détection de collision AABB (Axis-Aligned Bounding Box) sur le terrain et les briques posées.
   - **Mode Vol (Fly Mode — Touche `F`)** : Permet de voler librement (`Espace` pour monter, `Shift`/`C` pour descendre) afin de construire de grands bâtiments facilement.
   - **Sprint (`Shift`)** : Déplacement accéléré.

### 3.4. Interface Utilisateur (HUD Minimaliste & Moderne)
1. **Réticule central** adaptatif (change de forme lorsqu'une surface constructible est à portée).
2. **Barre d'outils (Hotbar 1–6)** en bas de l'écran présentant les 6 finitions de briques blanches.
3. **Panneau d'information temps réel** : Coordonnées `(X, Y, Z)`, nombre de briques posées, mode de déplacement (Marche / Vol), heure solaire, FPS.
4. **Menu Pause / Actions rapides (`Échap` ou boutons HUD)** :
   - Réglage de la lumière (Heure du jour, Ombres).
   - Génération de structures d'exemple en briques blanches (Temple Minimaliste, Arche Brutaliste, Tour Spirale).
   - Sauvegarder / Charger / Exporter en JSON / Tout effacer.
   - Aide des raccourcis clavier (touche `H`).

---

## 4. Architecture du Code
```text
AetherBricks/
├── index.html              # Point d'entrée HTML & UI Overlay (HUD, Menu, Crosshair)
├── package.json            # Dépendances (three, vite, typescript)
├── tsconfig.json           # Configuration TypeScript stricte
├── SPEC.md                 # Spécification complète du jeu
├── README.md               # Guide d'installation, contrôles et présentation
└── src/
    ├── main.ts             # Initialisation du jeu et boucle principale
    ├── style.css           # Design Glassmorphism du HUD et de l'interface
    ├── world/
    │   ├── VoxelWorld.ts   # Gestion de la grille 3D, raycasting, pose/suppression, Undo/Redo, particules
    │   ├── Materials.ts    # Générateur procédural de textures PBR (Normal, Roughness, Albedo) pour briques blanches
    │   └── Presets.ts      # Structures architecturales pré-construites en briques blanches
    ├── player/
    │   └── PlayerController.ts # Caméra FPS, PointerLock, collisions AABB, gravité et Mode Vol
    └── audio/
        └── SoundManager.ts # Synthétiseur Web Audio API (pose, casse, pas, UI)
```
