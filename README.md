# AetherBricks 3D 🧱✨

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
