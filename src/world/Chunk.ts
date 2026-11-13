/**
 * Données d'un chunk chargé (thread principal).
 */
import { CHUNK_AREA, CHUNK_HEIGHT, CHUNK_VOLUME, chunkKey } from './Constants';

export class Chunk {
  readonly cx: number;
  readonly cz: number;
  readonly key: number;

  readonly blocks: Uint8Array;
  readonly meta: Uint8Array;
  /** (ciel << 4) | blocs ; calculée par le worker de maillage. Plein ciel tant que le chunk n'est pas maillé. */
  light: Uint8Array;
  readonly biomes: Uint8Array;
  /** Par colonne : y du plus haut bloc non vide + 1. */
  readonly heightmap: Uint8Array;
  readonly tints: Uint8Array;
  /** Majorant de la hauteur du plus haut bloc non vide (ne redescend jamais). */
  top = 0;

  /** Différent de la génération : doit être sauvegardé. */
  modified = false;
  /** Modifié depuis la dernière sauvegarde. */
  saveDirty = false;
  /** Le maillage ne reflète plus les données. */
  meshDirty = true;
  /** Une requête de maillage est en vol. */
  meshPending = false;
  /** Au moins un maillage a été reçu (la lumière est valide). */
  meshed = false;
  /** À remailler en priorité (modification par le joueur). */
  urgent = false;
  /** Incrémenté à chaque modification : détecte les maillages périmés. */
  version = 0;
  /** Version des données envoyées au dernier maillage demandé. */
  meshedVersion = -1;

  constructor(cx: number, cz: number, blocks: Uint8Array, meta: Uint8Array, biomes: Uint8Array, heightmap: Uint8Array, tints: Uint8Array) {
    this.cx = cx;
    this.cz = cz;
    this.key = chunkKey(cx, cz);
    this.blocks = blocks;
    this.meta = meta;
    this.biomes = biomes;
    this.heightmap = heightmap;
    this.tints = tints;
    this.light = new Uint8Array(CHUNK_VOLUME).fill(0xf0);
    let top = 0;
    for (let i = 0; i < CHUNK_AREA; i++) if (heightmap[i] > top) top = heightmap[i];
    this.top = top;
  }

  /** Écrit un bloc (coordonnées locales) et tient la carte des hauteurs à jour. */
  set(lx: number, y: number, lz: number, id: number, meta: number): void {
    const idx = (y << 8) | (lz << 4) | lx;
    this.blocks[idx] = id;
    this.meta[idx] = meta;
    const col = (lz << 4) | lx;
    const h = this.heightmap[col];
    if (id !== 0) {
      if (y + 1 > h) {
        this.heightmap[col] = y + 1;
        if (y + 1 > this.top) this.top = y + 1;
      }
    } else if (y + 1 === h) {
      let ny = y - 1;
      while (ny >= 0 && this.blocks[(ny << 8) | col] === 0) ny--;
      this.heightmap[col] = ny + 1;
    }
    this.version++;
    this.modified = true;
    this.saveDirty = true;
    this.meshDirty = true;
  }

  /** Hauteur à traiter par le mailleur pour ce chunk seul. */
  meshTop(): number {
    return Math.min(CHUNK_HEIGHT, this.top + 2);
  }
}
