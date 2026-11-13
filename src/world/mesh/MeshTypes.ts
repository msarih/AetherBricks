/**
 * Protocole d'échange avec le worker de maillage.
 * Module pur : partagé entre le thread principal et les workers.
 */

/** Géométrie d'une passe de rendu d'un chunk (tableaux prêts pour le GPU). */
export interface PassData {
  /** xyz par sommet, en coordonnées locales au chunk. */
  positions: Float32Array;
  /** u, v, couche de la tuile, couche d'overlay (-1 = aucune) par sommet. */
  uvs: Float32Array;
  /** Teinte RVB + ombrage (face × occlusion ambiante), octets normalisés. */
  colors: Uint8Array;
  /** Lumière du ciel, lumière des blocs, drapeau « sans mipmap », inutilisé ; octets normalisés. */
  lights: Uint8Array;
  indices: Uint32Array;
}

export interface MeshRequest {
  id: number;
  cx: number;
  cz: number;
  /** Blocs des 9 chunks du voisinage, index (dz + 1) * 3 + (dx + 1), tronqués à la hauteur `top`. */
  blocks: Array<Uint8Array | null>;
  metas: Array<Uint8Array | null>;
  /** Teintes par colonne du chunk central (herbe, feuillage, eau : 9 octets). */
  tints: Uint8Array;
  /** Hauteur traitée : plus haut bloc non vide du voisinage + 2 (au plus 128). */
  top: number;
  /** Feuillages détaillés (toutes les faces) ou rapides. */
  fancy: boolean;
}

export interface MeshResult {
  id: number;
  cx: number;
  cz: number;
  /** Lumière du chunk central : (ciel << 4) | blocs, index (y << 8) | (z << 4) | x. */
  light: Uint8Array;
  opaque: PassData | null;
  translucent: PassData | null;
}

/** Liste des tampons à transférer avec un résultat. */
export function meshResultTransfers(r: MeshResult): ArrayBuffer[] {
  const out: ArrayBuffer[] = [r.light.buffer as ArrayBuffer];
  for (const p of [r.opaque, r.translucent]) {
    if (!p) continue;
    out.push(
      p.positions.buffer as ArrayBuffer,
      p.uvs.buffer as ArrayBuffer,
      p.colors.buffer as ArrayBuffer,
      p.lights.buffer as ArrayBuffer,
      p.indices.buffer as ArrayBuffer,
    );
  }
  return out;
}
