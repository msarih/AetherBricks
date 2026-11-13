/**
 * Point d'entrée des textures procédurales : peint toutes les tuiles du registre.
 * Module pur (pas de DOM).
 */
import { TILE_COUNT, TILE_NAMES, TILE_SIZE, type TileName } from '../../world/Tiles';
import { hashString } from '../../world/gen/Noise';
import { BLOCK_PAINTERS, paintFireFrame, paintLavaFrame, paintWaterFrame } from './BlockTiles';
import { ITEM_PAINTERS } from './ItemTiles';
import { Px, type Painter } from './PixelCanvas';

const TILE_BYTES = TILE_SIZE * TILE_SIZE * 4;

function painterFor(name: TileName): Painter | undefined {
  return BLOCK_PAINTERS[name] ?? ITEM_PAINTERS[name];
}

/** Noms des tuiles du registre qui n'ont pas de peintre (doit rester vide). */
export function missingTilePainters(): TileName[] {
  return TILE_NAMES.filter((name) => !painterFor(name));
}

/** Peint une tuile isolée (RGBA, lignes du haut vers le bas). */
export function paintTile(name: TileName): Uint8ClampedArray {
  const p = new Px(hashString(name));
  const painter = painterFor(name);
  if (painter) {
    painter(p);
  } else {
    // damier magenta/noir : texture manquante bien visible
    p.each((x, y) => ((x >> 3) + (y >> 3)) % 2 === 0 ? 0xff00ff : 0x000000);
  }
  return p.d;
}

/**
 * Peint toutes les tuiles. Résultat : TILE_COUNT × 16 × 16 × 4 octets RGBA,
 * tuile i à l'offset i × 1024, lignes du haut vers le bas.
 */
export function paintAllTiles(): Uint8Array {
  const out = new Uint8Array(TILE_COUNT * TILE_BYTES);
  for (let i = 0; i < TILE_COUNT; i++) {
    out.set(paintTile(TILE_NAMES[i]), i * TILE_BYTES);
  }
  return out;
}

export const WATER_FRAMES = 32;
export const LAVA_FRAMES = 32;
export const FIRE_FRAMES = 16;

/** Images d'animation (RGBA, haut vers le bas) pour l'eau, la lave et le feu. */
export function paintAnimationFrames(): { water: Uint8ClampedArray[]; lava: Uint8ClampedArray[]; fire: Uint8ClampedArray[] } {
  const water: Uint8ClampedArray[] = [];
  const lava: Uint8ClampedArray[] = [];
  const fire: Uint8ClampedArray[] = [];
  for (let f = 0; f < WATER_FRAMES; f++) {
    const p = new Px(1);
    paintWaterFrame(p, f, WATER_FRAMES);
    water.push(p.d);
  }
  for (let f = 0; f < LAVA_FRAMES; f++) {
    const p = new Px(2);
    paintLavaFrame(p, f, LAVA_FRAMES);
    lava.push(p.d);
  }
  for (let f = 0; f < FIRE_FRAMES; f++) {
    const p = new Px(3);
    paintFireFrame(p, f);
    fire.push(p.d);
  }
  return { water, lava, fire };
}
