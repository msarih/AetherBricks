/**
 * Générateur de monde : relief, grottes, surfaces par biome, minerais, arbres, plantes,
 * neige et teintes par colonne.
 *
 * Module pur (ni DOM ni THREE) : il tourne dans les workers. Tout est déterministe et
 * indépendant de l'ordre de génération des chunks : ce qui déborde d'un chunk voisin
 * (veines de minerai, feuillages) est recalculé à l'identique de chaque côté de la frontière.
 */
import { CHUNK_AREA, CHUNK_HEIGHT, CHUNK_SIZE, CHUNK_VOLUME, SEA_LEVEL, type WorldType } from '../Constants';
import { B } from '../Ids';
import { foliageColor, grassColor } from '../Blocks';
import { BIOME, BIOMES, TREE, isWaterBiome } from './Biomes';
import { Simplex, clamp, hash2, hash3, lerp, mulberry32, rand2, rand3, smoothstep } from './Noise';

/** Marge de colonnes dont on calcule les paramètres autour du chunk. */
const PAD = 5;
const PW = CHUNK_SIZE + 2 * PAD;
/** Anneau de colonnes entièrement générées autour du chunk (emprise maximale d'un arbre). */
const RING = 4;
const RW = CHUNK_SIZE + 2 * RING;
/** Treillis des champs 3D : un point tous les 4 blocs, interpolation trilinéaire. */
const LAT_STEP = 4;
const LXZ = RW / LAT_STEP + 1;
const LY = CHUNK_HEIGHT / LAT_STEP + 1;
const FIELDS = 4;
const F_TERRAIN = 0;
const F_CAVE_A = 1;
const F_CAVE_B = 2;
const F_CHEESE = 3;

/** Hauteur maximale du relief nominal (le bruit 3D peut ajouter jusqu'à `amp`). */
const MAX_HEIGHT = 110;
const LAVA_LEVEL = 10;
const SWAMP_TINT = 0x6a7039;

/** Hauteur du sol en fonction de la continentalité (interpolation linéaire par morceaux). */
const SPLINE_X = [-1, -0.45, -0.2, -0.08, -0.04, 0, 0.25, 0.5, 1];
const SPLINE_Y = [30, 38, 50, 60, 63.5, 66, 70, 76, 84];

function continentHeight(c: number): number {
  if (c <= SPLINE_X[0]) return SPLINE_Y[0];
  for (let i = 1; i < SPLINE_X.length; i++) {
    if (c <= SPLINE_X[i]) {
      const t = (c - SPLINE_X[i - 1]) / (SPLINE_X[i] - SPLINE_X[i - 1]);
      return SPLINE_Y[i - 1] + (SPLINE_Y[i] - SPLINE_Y[i - 1]) * t;
    }
  }
  return SPLINE_Y[SPLINE_Y.length - 1];
}

function mixColor(a: number, b: number, t: number): number {
  const r = Math.round(lerp((a >> 16) & 255, (b >> 16) & 255, t));
  const g = Math.round(lerp((a >> 8) & 255, (b >> 8) & 255, t));
  const bl = Math.round(lerp(a & 255, b & 255, t));
  return (r << 16) | (g << 8) | bl;
}

/** Altitude à partir de laquelle il neige, selon la température de la colonne. */
export function snowLine(temp: number): number {
  return 64 + (temp - 0.2) / 0.006;
}

/** Veines : [bloc, veines par chunk, taille, y min, y max, remplace aussi les roches variées]. */
const VEINS: Array<[number, number, number, number, number, boolean]> = [
  [B.DIRT, 10, 33, 0, 128, false],
  [B.GRAVEL, 8, 33, 0, 128, false],
  [B.GRANITE, 10, 33, 0, 80, false],
  [B.DIORITE, 10, 33, 0, 80, false],
  [B.ANDESITE, 10, 33, 0, 80, false],
  [B.COAL_ORE, 20, 17, 0, 128, true],
  [B.IRON_ORE, 20, 9, 0, 64, true],
  [B.GOLD_ORE, 2, 9, 0, 32, true],
  [B.REDSTONE_ORE, 8, 8, 0, 16, true],
  [B.DIAMOND_ORE, 1, 8, 0, 16, true],
  [B.LAPIS_ORE, 1, 7, 0, 32, true],
];

/** Paramètres d'une colonne du monde (climat, relief nominal, biome). */
export interface ColumnSample {
  cont: number;
  ero: number;
  ridge: number;
  temp: number;
  humid: number;
  /** Présence d'une rivière (0..1). */
  river: number;
  /** Facteur « marais » (0..1). */
  swamp: number;
  /** Facteur « montagne » (0..1). */
  mount: number;
  /** Hauteur nominale du sol (flottante). */
  height: number;
  /** Amplitude du bruit 3D ajouté au relief. */
  amp: number;
  biome: number;
}

export function newColumnSample(): ColumnSample {
  return { cont: 0, ero: 0, ridge: 0, temp: 0, humid: 0, river: 0, swamp: 0, mount: 0, height: 0, amp: 0, biome: 0 };
}

export interface GeneratedChunk {
  cx: number;
  cz: number;
  blocks: Uint8Array;
  meta: Uint8Array;
  /** Biome par colonne (index z * 16 + x). */
  biomes: Uint8Array;
  /** Par colonne : y du plus haut bloc non vide + 1 (0 si la colonne est vide). */
  heightmap: Uint8Array;
  /** Par colonne : couleur de l'herbe, du feuillage et de l'eau (9 octets RVB). */
  tints: Uint8Array;
}

export class WorldGen {
  readonly seed: number;
  readonly type: WorldType;

  private nCont: Simplex;
  private nEro: Simplex;
  private nPv: Simplex;
  private nTemp: Simplex;
  private nHumid: Simplex;
  private nHill: Simplex;
  private nRiver: Simplex;
  private nDetail: Simplex;
  private nPatch: Simplex;
  private nFlower: Simplex;
  private nTerrain: Simplex;
  private nCaveA: Simplex;
  private nCaveB: Simplex;
  private nCheese: Simplex;

  private sBedrock: number;
  private sOre: number;
  private sTree: number;
  private sPlant: number;
  private sSurface: number;

  // paramètres de colonne sur la grille PW × PW
  private pH = new Float32Array(PW * PW);
  private pAmp = new Float32Array(PW * PW);
  private pTemp = new Float32Array(PW * PW);
  private pHumid = new Float32Array(PW * PW);
  private pSwamp = new Float32Array(PW * PW);
  private pBiome = new Uint8Array(PW * PW);

  // résultat des colonnes sur l'anneau RW × RW
  private ringTop = new Int16Array(RW * RW);
  private ringTopBlock = new Uint8Array(RW * RW);
  private ringWater = new Uint8Array(RW * RW);

  private lat = new Float32Array(LXZ * LXZ * LY * FIELDS);
  private colLat = new Float32Array(LY * FIELDS);
  private col = new Uint8Array(CHUNK_HEIGHT);
  private sample = newColumnSample();

  // chunk en cours d'écriture
  private blocks!: Uint8Array;
  private meta!: Uint8Array;

  // règle de surface courante
  private sTop = 0;
  private sFill = 0;
  private sFillDepth = 0;
  private sUnder = 0;
  private sUnderDepth = 0;

  constructor(seed: number, type: WorldType = 'default') {
    this.seed = seed >>> 0;
    this.type = type;
    const rng = mulberry32(this.seed ^ 0x5eed1234);
    const next = (): number => (rng() * 4294967296) >>> 0;
    this.nCont = new Simplex(next());
    this.nEro = new Simplex(next());
    this.nPv = new Simplex(next());
    this.nTemp = new Simplex(next());
    this.nHumid = new Simplex(next());
    this.nHill = new Simplex(next());
    this.nRiver = new Simplex(next());
    this.nDetail = new Simplex(next());
    this.nPatch = new Simplex(next());
    this.nFlower = new Simplex(next());
    this.nTerrain = new Simplex(next());
    this.nCaveA = new Simplex(next());
    this.nCaveB = new Simplex(next());
    this.nCheese = new Simplex(next());
    this.sBedrock = next();
    this.sOre = next();
    this.sTree = next();
    this.sPlant = next();
    this.sSurface = next();
  }

  // ------------------------------------------------------------------ colonnes

  /** Climat, relief nominal et biome d'une colonne du monde. */
  sampleColumn(x: number, z: number, out: ColumnSample = newColumnSample()): ColumnSample {
    if (this.type === 'flat') {
      out.cont = 0.2;
      out.ero = 0;
      out.ridge = 0;
      out.temp = 0.8;
      out.humid = 0.4;
      out.river = 0;
      out.swamp = 0;
      out.mount = 0;
      out.height = 4;
      out.amp = 0;
      out.biome = BIOME.PLAINS;
      return out;
    }
    const cont = this.nCont.fbm2(x / 1300, z / 1300, 5) * 1.7 + 0.2;
    const ero = this.nEro.fbm2(x / 800, z / 800, 4) * 1.5;
    const pv = this.nPv.fbm2(x / 210, z / 210, 4);
    const ridge = clamp(1 - Math.abs(pv) * 2.4, 0, 1);
    const jitter = this.nDetail.noise2(x / 23 + 91.7, z / 23 - 40.3) * 0.022;
    const temp = clamp(0.5 + this.nTemp.fbm2(x / 1700, z / 1700, 4) * 0.8 + jitter, 0, 1);
    const humid = clamp(0.5 + this.nHumid.fbm2(x / 1200, z / 1200, 4) * 0.85 - jitter, 0, 1);

    const land = smoothstep(-0.08, 0.02, cont);
    const mount = smoothstep(0.12, 0.5, cont) * smoothstep(-0.18, -0.58, ero);
    const rough = smoothstep(0.35, -0.25, ero);
    const hillAmp = (2.5 + 6.5 * rough) * (0.35 + 0.65 * land);
    let h = continentHeight(cont);
    h += this.nHill.fbm2(x / 110, z / 110, 4) * hillAmp;
    h += this.nDetail.noise2(x / 21, z / 21) * 0.8;
    h += mount * (15 + 41 * ridge * ridge);

    const swamp =
      smoothstep(0.56, 0.68, humid) * smoothstep(0.4, 0.5, temp) * smoothstep(0.84, 0.74, temp) *
      smoothstep(0.3, 0.12, cont) * land * (1 - mount);
    if (swamp > 0) h = lerp(h, 61.7 + this.nDetail.noise2(x / 13 - 7.7, z / 13 + 3.1) * 1.7, swamp * 0.92);

    // rivières : ligne de niveau zéro d'un bruit ; diviser par la pente du bruit donne la
    // distance (en blocs) à l'axe, donc un lit de largeur régulière
    const rn = this.nRiver.fbm2(x / 420, z / 420, 3);
    const rgx = this.nRiver.fbm2((x + 1) / 420, z / 420, 3) - rn;
    const rgz = this.nRiver.fbm2(x / 420, (z + 1) / 420, 3) - rn;
    const rdist = Math.abs(rn) / Math.max(Math.sqrt(rgx * rgx + rgz * rgz), 0.0008);
    const rhalf = 2.5 + 2 * (0.5 + 0.5 * this.nDetail.noise2(x / 170 + 55.5, z / 170 - 12.5));
    // les rivières entaillent les contreforts et prennent leur source dans la haute montagne
    const river = smoothstep(rhalf + 8, rhalf, rdist) * smoothstep(0.9, 0.55, mount) * land;
    if (river > 0) h = lerp(h, 58.5, river);

    if (h > 96) h = 96 + (h - 96) * 0.45;
    if (h > MAX_HEIGHT) h = MAX_HEIGHT;

    out.cont = cont;
    out.ero = ero;
    out.ridge = ridge;
    out.temp = temp;
    out.humid = humid;
    out.river = river;
    out.swamp = swamp;
    out.mount = mount;
    out.height = h;
    out.amp = (1.2 + mount * 9 + rough * land * 2.5) * (1 - 0.7 * river) * (1 - 0.8 * swamp);
    out.biome = pickBiome(out);
    return out;
  }

  /** Point d'apparition : colonne de terre ferme tempérée la plus proche de l'origine. */
  findSpawn(): { x: number; y: number; z: number } {
    if (this.type === 'flat') return { x: 0.5, y: 4, z: 0.5 };
    const s = newColumnSample();
    let best = { x: 0.5, y: 80, z: 0.5 };
    let bestScore = -Infinity;
    for (let ring = 0; ring <= 80; ring++) {
      const r = ring * 24;
      const steps = ring === 0 ? 1 : ring * 8;
      for (let i = 0; i < steps; i++) {
        const a = (i / steps) * Math.PI * 2;
        const x = Math.round(Math.cos(a) * r);
        const z = Math.round(Math.sin(a) * r);
        this.sampleColumn(x, z, s);
        if (isWaterBiome(s.biome) || s.height < 63.5) continue;
        let score = -r / 600;
        if (s.biome === BIOME.PLAINS || s.biome === BIOME.FOREST || s.biome === BIOME.BIRCH_FOREST) score += 3;
        else if (s.biome === BIOME.TAIGA || s.biome === BIOME.SAVANNA || s.biome === BIOME.DARK_FOREST) score += 2;
        else if (s.biome === BIOME.MOUNTAINS || s.biome === BIOME.SNOWY_MOUNTAINS || s.biome === BIOME.SWAMP) score -= 1;
        if (s.height > 80) score -= 2;
        if (score > bestScore) {
          bestScore = score;
          best = { x: x + 0.5, y: Math.ceil(s.height) + 1, z: z + 0.5 };
        }
      }
      if (bestScore >= 3 - r / 600 - 0.5 && ring >= 1) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ chunk

  generateChunk(cx: number, cz: number): GeneratedChunk {
    const blocks = new Uint8Array(CHUNK_VOLUME);
    const meta = new Uint8Array(CHUNK_VOLUME);
    const biomes = new Uint8Array(CHUNK_AREA);
    const heightmap = new Uint8Array(CHUNK_AREA);
    const tints = new Uint8Array(CHUNK_AREA * 9);
    const out: GeneratedChunk = { cx, cz, blocks, meta, biomes, heightmap, tints };
    this.blocks = blocks;
    this.meta = meta;

    if (this.type === 'flat') {
      this.generateFlat(out);
      return out;
    }

    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;

    // 1. paramètres de colonne
    const s = this.sample;
    let maxSolid = 0;
    for (let pz = 0; pz < PW; pz++) {
      for (let px = 0; px < PW; px++) {
        this.sampleColumn(bx + px - PAD, bz + pz - PAD, s);
        const pi = pz * PW + px;
        this.pH[pi] = s.height;
        this.pAmp[pi] = s.amp;
        this.pTemp[pi] = s.temp;
        this.pHumid[pi] = s.humid;
        this.pSwamp[pi] = s.swamp;
        this.pBiome[pi] = s.biome;
        if (s.height + s.amp > maxSolid) maxSolid = s.height + s.amp;
      }
    }

    // 2. treillis des champs 3D
    this.fillLattice(bx - RING, bz - RING, maxSolid);

    // 3. colonnes (anneau compris), copiées dans le chunk pour les 16 × 16 du centre
    for (let rz = 0; rz < RW; rz++) {
      for (let rx = 0; rx < RW; rx++) {
        this.buildColumn(rx, rz, bx, bz);
        const lx = rx - RING;
        const lz = rz - RING;
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
          const col = this.col;
          const base = (lz << 4) | lx;
          for (let y = 0; y < CHUNK_HEIGHT; y++) blocks[(y << 8) | base] = col[y];
        }
      }
    }

    // 4. minerais, 5. arbres, 6. plantes, 7. neige et glace
    this.placeVeins(cx, cz);
    this.placeEmeralds(cx, cz);
    this.placeTrees(bx, bz);
    this.placePlants(bx, bz);
    this.placeSnow();

    // 8. biomes, teintes, carte des hauteurs
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const i = (lz << 4) | lx;
        const pi = (lz + PAD) * PW + lx + PAD;
        biomes[i] = this.pBiome[pi];
        const temp = this.pTemp[pi];
        const humid = this.pHumid[pi];
        const sw = this.pSwamp[pi];
        let grass = grassColor(temp, humid);
        let foliage = foliageColor(temp, humid);
        if (sw > 0) {
          grass = mixColor(grass, SWAMP_TINT, sw * 0.85);
          foliage = mixColor(foliage, SWAMP_TINT, sw * 0.85);
        }
        // eau : moyenne 5 × 5 des couleurs de biome pour adoucir les frontières
        let wr = 0;
        let wg = 0;
        let wb = 0;
        for (let dz = -2; dz <= 2; dz++) {
          for (let dx = -2; dx <= 2; dx++) {
            const c = BIOMES[this.pBiome[pi + dz * PW + dx]].waterColor;
            wr += (c >> 16) & 255;
            wg += (c >> 8) & 255;
            wb += c & 255;
          }
        }
        const t = i * 9;
        tints[t] = (grass >> 16) & 255;
        tints[t + 1] = (grass >> 8) & 255;
        tints[t + 2] = grass & 255;
        tints[t + 3] = (foliage >> 16) & 255;
        tints[t + 4] = (foliage >> 8) & 255;
        tints[t + 5] = foliage & 255;
        tints[t + 6] = Math.round(wr / 25);
        tints[t + 7] = Math.round(wg / 25);
        tints[t + 8] = Math.round(wb / 25);
      }
    }
    computeHeightmap(blocks, heightmap);
    return out;
  }

  private generateFlat(out: GeneratedChunk): void {
    const { blocks, biomes, heightmap, tints } = out;
    const grass = grassColor(0.8, 0.4);
    const foliage = foliageColor(0.8, 0.4);
    const water = BIOMES[BIOME.PLAINS].waterColor;
    for (let i = 0; i < CHUNK_AREA; i++) {
      blocks[i] = B.BEDROCK;
      blocks[(1 << 8) | i] = B.DIRT;
      blocks[(2 << 8) | i] = B.DIRT;
      blocks[(3 << 8) | i] = B.GRASS;
      biomes[i] = BIOME.PLAINS;
      heightmap[i] = 4;
      const t = i * 9;
      tints[t] = (grass >> 16) & 255;
      tints[t + 1] = (grass >> 8) & 255;
      tints[t + 2] = grass & 255;
      tints[t + 3] = (foliage >> 16) & 255;
      tints[t + 4] = (foliage >> 8) & 255;
      tints[t + 5] = foliage & 255;
      tints[t + 6] = (water >> 16) & 255;
      tints[t + 7] = (water >> 8) & 255;
      tints[t + 8] = water & 255;
    }
  }

  /** Échantillonne les 4 champs 3D aux points du treillis (coordonnées monde multiples de 4). */
  private fillLattice(ox: number, oz: number, maxSolid: number): void {
    const lat = this.lat;
    // au-dessus du plus haut bloc solide possible, les champs ne sont jamais lus
    const lyTop = Math.min(LY - 1, Math.ceil((maxSolid + 2) / LAT_STEP) + 1);
    for (let lz = 0; lz < LXZ; lz++) {
      const wz = oz + lz * LAT_STEP;
      for (let lx = 0; lx < LXZ; lx++) {
        const wx = ox + lx * LAT_STEP;
        let i = (lz * LXZ + lx) * LY * FIELDS;
        for (let ly = 0; ly < LY; ly++, i += FIELDS) {
          if (ly > lyTop) {
            lat[i + F_TERRAIN] = 0;
            lat[i + F_CAVE_A] = 1;
            lat[i + F_CAVE_B] = 1;
            lat[i + F_CHEESE] = -1;
            continue;
          }
          const wy = ly * LAT_STEP;
          lat[i + F_TERRAIN] = this.nTerrain.fbm3(wx / 48, wy / 34, wz / 48, 3);
          lat[i + F_CAVE_A] = this.nCaveA.fbm3(wx / 55, wy / 38, wz / 55, 2);
          lat[i + F_CAVE_B] = this.nCaveB.fbm3(wx / 55, wy / 38, wz / 55, 2);
          lat[i + F_CHEESE] = this.nCheese.fbm3(wx / 90, wy / 55, wz / 90, 2);
        }
      }
    }
  }

  /**
   * Construit la colonne (rx, rz) de l'anneau dans `this.col` : relief, eau, surface,
   * grottes, bedrock. Renseigne aussi ringTop / ringTopBlock / ringWater.
   */
  private buildColumn(rx: number, rz: number, bx: number, bz: number): void {
    const col = this.col;
    const colLat = this.colLat;
    const lat = this.lat;
    const lx = rx - RING;
    const lz = rz - RING;
    const wx = bx + lx;
    const wz = bz + lz;
    const pi = (lz + PAD) * PW + lx + PAD;
    const h = this.pH[pi];
    const amp = this.pAmp[pi];

    // interpolation horizontale du treillis pour cette colonne
    const fx = (rx & 3) * 0.25;
    const fz = (rz & 3) * 0.25;
    const w00 = (1 - fx) * (1 - fz);
    const w10 = fx * (1 - fz);
    const w01 = (1 - fx) * fz;
    const w11 = fx * fz;
    const stride = LY * FIELDS;
    const i00 = ((rz >> 2) * LXZ + (rx >> 2)) * stride;
    const i10 = i00 + stride;
    const i01 = i00 + LXZ * stride;
    const i11 = i01 + stride;
    for (let k = 0; k < stride; k++) {
      colLat[k] = lat[i00 + k] * w00 + lat[i10 + k] * w10 + lat[i01 + k] * w01 + lat[i11 + k] * w11;
    }

    // relief : solide si (h - y) + bruit × amplitude > 0
    const yHi = Math.min(CHUNK_HEIGHT - 5, Math.floor(h + amp) + 1);
    const yLo = Math.max(0, Math.floor(h - amp) - 1);
    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      let solid: boolean;
      if (y <= yLo) solid = true;
      else if (y > yHi) solid = false;
      else {
        const k = (y >> 2) * FIELDS + F_TERRAIN;
        const a = colLat[k];
        const n = a + (colLat[k + FIELDS] - a) * ((y & 3) * 0.25);
        solid = h - y + n * amp > 0;
      }
      col[y] = solid ? B.STONE : y <= SEA_LEVEL ? B.WATER : B.AIR;
    }

    // surface : à chaque passage vide → solide en descendant
    const biome = this.pBiome[pi];
    const temp = this.pTemp[pi];
    const slope = Math.max(
      Math.abs(h - this.pH[pi - 1]),
      Math.abs(h - this.pH[pi + 1]),
      Math.abs(h - this.pH[pi - PW]),
      Math.abs(h - this.pH[pi + PW]),
    );
    const patch = this.nPatch.noise2(wx / 17, wz / 17);
    const hsh = hash2(wx, wz, this.sSurface);
    let run = 0;
    let above: number = B.AIR;
    for (let y = CHUNK_HEIGHT - 1; y >= 1; y--) {
      const cur = col[y];
      if (cur !== B.STONE) {
        run = 0;
        above = cur;
        continue;
      }
      if (run === 0) {
        this.surfaceRule(biome, y, above === B.WATER, slope, temp, patch, hsh);
        if (this.sTop) col[y] = this.sTop;
        run = 1;
      } else if (run <= this.sFillDepth) {
        if (this.sFill) col[y] = this.sFill;
        run++;
      } else if (run <= this.sFillDepth + this.sUnderDepth) {
        if (this.sUnder) col[y] = this.sUnder;
        run++;
      }
      above = B.STONE;
    }

    // grottes : jamais à proximité d'une colonne immergée (ni sous elle)
    let carveMax = yHi;
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const qi = pi + dz * PW + dx;
        const qh = this.pH[qi];
        if (qh < 63.2) {
          const lim = qh - 6 - this.pAmp[qi];
          if (lim < carveMax) carveMax = lim;
        }
      }
    }
    for (let y = 1; y <= carveMax; y++) {
      const cur = col[y];
      if (cur === B.AIR || cur === B.WATER) continue;
      const fy = (y & 3) * 0.25;
      const k = (y >> 2) * FIELDS;
      const a0 = colLat[k + F_CAVE_A];
      const a = a0 + (colLat[k + FIELDS + F_CAVE_A] - a0) * fy;
      const b0 = colLat[k + F_CAVE_B];
      const b = b0 + (colLat[k + FIELDS + F_CAVE_B] - b0) * fy;
      const c0 = colLat[k + F_CHEESE];
      const c = c0 + (colLat[k + FIELDS + F_CHEESE] - c0) * fy;
      const depth = h - y;
      // tunnels : plus étroits près de la surface et du fond
      let radius = 0.085;
      if (depth < 14) radius *= depth < 2 ? 0.42 : 0.42 + ((depth - 2) / 12) * 0.58;
      if (y < 6) radius *= 0.5 + y / 12;
      // cavernes : de plus en plus rares en montant et près de la surface
      let threshold = 0.5 + (y > 36 ? (y - 36) * 0.012 : 0);
      if (depth < 10) threshold += (10 - depth) * 0.03;
      if (a * a + b * b < radius * radius || c > threshold) {
        col[y] = y <= LAVA_LEVEL ? B.LAVA : B.AIR;
      }
    }

    // bedrock
    col[0] = B.BEDROCK;
    for (let y = 1; y <= 4; y++) {
      if (rand3(wx, y, wz, this.sBedrock) < (5 - y) / 5) col[y] = B.BEDROCK;
    }

    // sommet de la colonne (hors eau)
    let top = CHUNK_HEIGHT - 1;
    while (top > 0 && (col[top] === B.AIR || col[top] === B.WATER)) top--;
    // une grotte qui affleure met la terre à nu : l'herbe la recouvre
    if (col[top] === B.DIRT && col[top + 1] === B.AIR && biome !== BIOME.SWAMP) col[top] = B.GRASS;
    const ri = rz * RW + rx;
    this.ringTop[ri] = top;
    this.ringTopBlock[ri] = col[top];
    this.ringWater[ri] = col[SEA_LEVEL] === B.WATER ? 1 : 0;
  }

  /** Choisit les blocs de surface d'une colonne (résultat dans sTop / sFill / sUnder). */
  private surfaceRule(
    biome: number, y: number, underwater: boolean, slope: number, temp: number, patch: number, hsh: number,
  ): void {
    this.sFillDepth = 3 + (hsh & 1);
    this.sUnder = 0;
    this.sUnderDepth = 0;
    if (underwater) {
      let b: number;
      if (y < 48) b = B.GRAVEL;
      else if (biome === BIOME.SWAMP) b = patch > 0.4 ? B.CLAY : B.DIRT;
      else if (patch > 0.5 && y >= 54) b = B.CLAY;
      else if (patch < -0.42) b = B.GRAVEL;
      else b = B.SAND;
      this.sTop = b;
      this.sFill = b;
      return;
    }
    switch (biome) {
      case BIOME.DESERT:
        this.sTop = B.SAND;
        this.sFill = B.SAND;
        this.sUnder = B.SANDSTONE;
        this.sUnderDepth = 3;
        return;
      case BIOME.BEACH:
      case BIOME.SNOWY_BEACH:
        this.sTop = B.SAND;
        this.sFill = B.SAND;
        this.sUnder = B.SANDSTONE;
        this.sUnderDepth = 2;
        return;
      case BIOME.OCEAN:
      case BIOME.DEEP_OCEAN:
      case BIOME.FROZEN_OCEAN:
      case BIOME.RIVER:
      case BIOME.FROZEN_RIVER:
        if (y <= SEA_LEVEL + 1) {
          this.sTop = B.SAND;
          this.sFill = B.SAND;
          return;
        }
        break;
      case BIOME.STONY_SHORE:
        this.sTop = 0;
        this.sFill = 0;
        return;
      case BIOME.MOUNTAINS:
      case BIOME.SNOWY_MOUNTAINS:
        if (slope >= 2.6 || y > 96 + patch * 6) {
          const snowCap = slope < 2.6 && y > snowLine(temp) + 8;
          this.sTop = snowCap ? B.SNOW_BLOCK : 0;
          this.sFill = 0;
          return;
        }
        this.sFillDepth = 2;
        break;
      default:
        break;
    }
    this.sTop = B.GRASS;
    this.sFill = B.DIRT;
  }

  // ------------------------------------------------------------------ minerais

  /** Veines de minerai et de roches : celles des 8 chunks voisins peuvent déborder ici. */
  private placeVeins(cx: number, cz: number): void {
    const blocks = this.blocks;
    const bx = cx * CHUNK_SIZE;
    const bz = cz * CHUNK_SIZE;
    for (let t = 0; t < VEINS.length; t++) {
      const [block, count, size, yMin, yMax, overVariants] = VEINS[t];
      const reach = size / 8 + size / 16 + 1;
      for (let ncz = cz - 1; ncz <= cz + 1; ncz++) {
        for (let ncx = cx - 1; ncx <= cx + 1; ncx++) {
          for (let v = 0; v < count; v++) {
            const rng = mulberry32(hash3(ncx, t * 64 + v, ncz, this.sOre));
            const ox = ncx * CHUNK_SIZE + rng() * CHUNK_SIZE;
            const oz = ncz * CHUNK_SIZE + rng() * CHUNK_SIZE;
            // le lapis se concentre autour de y = 16
            const oy = block === B.LAPIS_ORE
              ? (rng() + rng()) * 16
              : yMin + rng() * (yMax - yMin);
            const angle = rng() * Math.PI;
            if (ox + reach < bx || ox - reach >= bx + CHUNK_SIZE || oz + reach < bz || oz - reach >= bz + CHUNK_SIZE) {
              continue;
            }
            const sx = Math.sin(angle) * size / 8;
            const sz = Math.cos(angle) * size / 8;
            const y0 = oy + Math.floor(rng() * 3) - 2;
            const y1 = oy + Math.floor(rng() * 3) - 2;
            for (let i = 0; i < size; i++) {
              const f = i / size;
              const px = ox + sx - 2 * sx * f;
              const py = y0 + (y1 - y0) * f;
              const pz = oz + sz - 2 * sz * f;
              const half = ((Math.sin(Math.PI * f) + 1) * (rng() * size / 16) + 1) / 2;
              const x0 = Math.max(bx, Math.floor(px - half));
              const x1 = Math.min(bx + CHUNK_SIZE - 1, Math.floor(px + half));
              const z0 = Math.max(bz, Math.floor(pz - half));
              const z1 = Math.min(bz + CHUNK_SIZE - 1, Math.floor(pz + half));
              const ya = Math.max(1, Math.floor(py - half));
              const yb = Math.min(CHUNK_HEIGHT - 1, Math.floor(py + half));
              for (let x = x0; x <= x1; x++) {
                const dx = (x + 0.5 - px) / half;
                if (dx * dx >= 1) continue;
                for (let z = z0; z <= z1; z++) {
                  const dz = (z + 0.5 - pz) / half;
                  if (dx * dx + dz * dz >= 1) continue;
                  for (let y = ya; y <= yb; y++) {
                    const dy = (y + 0.5 - py) / half;
                    if (dx * dx + dz * dz + dy * dy >= 1) continue;
                    const idx = (y << 8) | ((z - bz) << 4) | (x - bx);
                    const cur = blocks[idx];
                    if (cur === B.STONE || (overVariants && (cur === B.GRANITE || cur === B.DIORITE || cur === B.ANDESITE))) {
                      blocks[idx] = block;
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }

  /** Émeraudes : blocs isolés, uniquement sous les montagnes. */
  private placeEmeralds(cx: number, cz: number): void {
    const rng = mulberry32(hash3(cx, 0x3e3e, cz, this.sOre));
    const n = 3 + Math.floor(rng() * 5);
    for (let i = 0; i < n; i++) {
      const lx = Math.floor(rng() * CHUNK_SIZE);
      const lz = Math.floor(rng() * CHUNK_SIZE);
      const y = 4 + Math.floor(rng() * 28);
      const biome = this.pBiome[(lz + PAD) * PW + lx + PAD];
      if (biome !== BIOME.MOUNTAINS && biome !== BIOME.SNOWY_MOUNTAINS) continue;
      const idx = (y << 8) | (lz << 4) | lx;
      if (this.blocks[idx] === B.STONE) this.blocks[idx] = B.EMERALD_ORE;
    }
  }

  // ------------------------------------------------------------------ arbres

  /** Écrit une bûche (coordonnées locales, ignorée hors du chunk). */
  private log(lx: number, y: number, lz: number, id: number): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 1 || y >= CHUNK_HEIGHT) return;
    const idx = (y << 8) | (lz << 4) | lx;
    const cur = this.blocks[idx];
    if (cur === B.AIR || (cur >= B.OAK_LEAVES && cur <= B.ACACIA_LEAVES) || cur === B.VINE) {
      this.blocks[idx] = id;
      this.meta[idx] = 0;
    }
  }

  /** Écrit un bloc de feuillage ou une liane : uniquement dans l'air. */
  private leaf(lx: number, y: number, lz: number, id: number, meta = 0): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE || y < 1 || y >= CHUNK_HEIGHT) return;
    const idx = (y << 8) | (lz << 4) | lx;
    if (this.blocks[idx] === B.AIR) {
      this.blocks[idx] = id;
      this.meta[idx] = meta;
    }
  }

  /**
   * Un arbre possible par cellule de 4 × 4 colonnes, à une position tirée du hash de la
   * cellule. Les arbres plantés dans l'anneau débordent dans le chunk à l'identique.
   */
  private placeTrees(bx: number, bz: number): void {
    const cellX0 = (bx - RING) >> 2;
    const cellZ0 = (bz - RING) >> 2;
    const cells = RW >> 2;
    for (let j = 0; j < cells; j++) {
      for (let i = 0; i < cells; i++) {
        const cellX = cellX0 + i;
        const cellZ = cellZ0 + j;
        const hsh = hash2(cellX, cellZ, this.sTree);
        const wx = cellX * 4 + (hsh & 3);
        const wz = cellZ * 4 + ((hsh >>> 2) & 3);
        const lx = wx - bx;
        const lz = wz - bz;
        const def = BIOMES[this.pBiome[(lz + PAD) * PW + lx + PAD]];
        if (def.treeDensity <= 0) continue;
        if (((hsh >>> 8) & 0xffff) / 65536 >= def.treeDensity) continue;

        const rng = mulberry32(hash2(wx, wz, this.sTree ^ 0x7ee5));
        let total = 0;
        for (const [, w] of def.trees) total += w;
        let pick = rng() * total;
        let kind: number = TREE.NONE;
        for (const [k, w] of def.trees) {
          kind = k;
          pick -= w;
          if (pick < 0) break;
        }

        const ri = (lz + RING) * RW + lx + RING;
        const top = this.ringTop[ri];
        const ground = this.ringTopBlock[ri];
        if (top < SEA_LEVEL || top > CHUNK_HEIGHT - 34) continue;
        if (kind === TREE.CACTUS) {
          if (ground === B.SAND) this.cactus(lx, top + 1, lz, rng);
          continue;
        }
        if (ground !== B.GRASS && ground !== B.DIRT) continue;
        // terre sous le tronc
        if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
          this.blocks[(top << 8) | (lz << 4) | lx] = B.DIRT;
        }
        const y0 = top + 1;
        switch (kind) {
          case TREE.OAK:
            this.roundTree(lx, y0, lz, rng, B.OAK_LOG, B.OAK_LEAVES, 4, 3, 0);
            break;
          case TREE.BIRCH:
            this.roundTree(lx, y0, lz, rng, B.BIRCH_LOG, B.BIRCH_LEAVES, 5, 3, 0);
            break;
          case TREE.JUNGLE:
            this.roundTree(lx, y0, lz, rng, B.JUNGLE_LOG, B.JUNGLE_LEAVES, 6, 5, 1);
            break;
          case TREE.SWAMP_OAK:
            this.roundTree(lx, y0, lz, rng, B.OAK_LOG, B.OAK_LEAVES, 5, 3, 2);
            break;
          case TREE.SPRUCE:
            this.spruce(lx, y0, lz, rng);
            break;
          case TREE.ACACIA:
            this.acacia(lx, y0, lz, rng);
            break;
          case TREE.LARGE_OAK:
            this.largeOak(lx, y0, lz, rng);
            break;
          case TREE.JUNGLE_BUSH:
            this.bush(lx, y0, lz, rng);
            break;
          case TREE.TALL_JUNGLE:
            this.tallJungle(lx, y0, lz, rng);
            break;
          default:
            break;
        }
      }
    }
  }

  /**
   * Arbre à houppier arrondi (chêne, bouleau, jungle, chêne de marais).
   * style 0 : simple ; 1 : lianes sur le tronc ; 2 : houppier large et lianes pendantes.
   */
  private roundTree(
    x: number, y0: number, z: number, rng: () => number,
    logId: number, leafId: number, hMin: number, hVar: number, style: number,
  ): void {
    const H = hMin + Math.floor(rng() * hVar);
    const wide = style === 2 ? 1 : 0;
    for (let yy = H - 3; yy <= H; yy++) {
      const r = (yy >= H - 1 ? 1 : 2) + wide;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const roll = rng();
          const corner = Math.abs(dx) === r && Math.abs(dz) === r;
          if (corner && (yy === H || roll < 0.5)) continue;
          this.leaf(x + dx, y0 + yy, z + dz, leafId);
          // lianes pendantes sur le pourtour de la couche basse
          if (style === 2 && yy === H - 3 && !corner && (Math.abs(dx) === r || Math.abs(dz) === r) && roll > 0.72) {
            const len = 1 + Math.floor((roll - 0.72) / 0.28 * 4);
            let vx = x + dx;
            let vz = z + dz;
            let bit: number;
            if (Math.abs(dx) === r) {
              vx += Math.sign(dx);
              bit = dx > 0 ? 1 : 3; // la liane s'accroche à la feuille côté ouest / est
            } else {
              vz += Math.sign(dz);
              bit = dz > 0 ? 2 : 0; // côté nord / sud
            }
            for (let k = 0; k < len; k++) this.leaf(vx, y0 + yy - k, vz, B.VINE, 1 << bit);
          }
        }
      }
    }
    for (let i = 0; i < H; i++) {
      this.log(x, y0 + i, z, logId);
      if (style === 1 && i > 0) {
        // lianes sur le tronc (bit = côté du support)
        if (rng() < 0.14) this.leaf(x - 1, y0 + i, z, B.VINE, 1 << 3);
        if (rng() < 0.14) this.leaf(x + 1, y0 + i, z, B.VINE, 1 << 1);
        if (rng() < 0.14) this.leaf(x, y0 + i, z - 1, B.VINE, 1 << 0);
        if (rng() < 0.14) this.leaf(x, y0 + i, z + 1, B.VINE, 1 << 2);
      }
    }
  }

  private spruce(x: number, y0: number, z: number, rng: () => number): void {
    const H = 6 + Math.floor(rng() * 4);
    const bare = 1 + Math.floor(rng() * 2);
    for (let yy = H; yy >= bare; yy--) {
      const i = H - yy;
      const r = i === 0 ? 0 : Math.min(3, 1 + ((i - 1) % 2) + (i > 4 ? 1 : 0));
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          if (r >= 2 && Math.abs(dx) === r && Math.abs(dz) === r) continue;
          this.leaf(x + dx, y0 + yy, z + dz, B.SPRUCE_LEAVES);
        }
      }
    }
    for (let i = 0; i < H; i++) this.log(x, y0 + i, z, B.SPRUCE_LOG);
  }

  private acacia(x: number, y0: number, z: number, rng: () => number): void {
    const H = 5 + Math.floor(rng() * 3);
    const dir = Math.floor(rng() * 4);
    const leanAt = H - 3 - Math.floor(rng() * 2);
    const ddx = dir === 1 ? -1 : dir === 3 ? 1 : 0;
    const ddz = dir === 0 ? 1 : dir === 2 ? -1 : 0;
    let px = x;
    let pz = z;
    let shift = 0;
    for (let i = 0; i < H; i++) {
      if (i >= leanAt && shift < 2) {
        px += ddx;
        pz += ddz;
        shift++;
      }
      this.log(px, y0 + i, pz, B.ACACIA_LOG);
    }
    const ty = y0 + H - 1;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        if (Math.abs(dx) === 2 && Math.abs(dz) === 2) continue;
        this.leaf(px + dx, ty, pz + dz, B.ACACIA_LEAVES);
        if (Math.abs(dx) + Math.abs(dz) <= 1) this.leaf(px + dx, ty + 1, pz + dz, B.ACACIA_LEAVES);
      }
    }
  }

  private largeOak(x: number, y0: number, z: number, rng: () => number): void {
    const H = 7 + Math.floor(rng() * 4);
    const cy = y0 + H - 1;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dz = -3; dz <= 3; dz++) {
        for (let dx = -3; dx <= 3; dx++) {
          const roll = rng();
          const d = (dx * dx + dz * dz) / 10.6 + (dy * dy) / 5.6;
          if (d > 1 || (d > 0.78 && roll < 0.35)) continue;
          this.leaf(x + dx, cy + dy, z + dz, B.OAK_LEAVES);
        }
      }
    }
    for (let i = 0; i < H; i++) this.log(x, y0 + i, z, B.OAK_LOG);
  }

  private bush(x: number, y0: number, z: number, rng: () => number): void {
    for (let yy = 0; yy <= 1; yy++) {
      const r = 2 - yy;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const roll = rng();
          if (Math.abs(dx) === r && Math.abs(dz) === r && (r === 2 || roll < 0.5)) continue;
          this.leaf(x + dx, y0 + yy, z + dz, B.OAK_LEAVES);
        }
      }
    }
    this.log(x, y0, z, B.JUNGLE_LOG);
  }

  /** Grand arbre de jungle : tronc 2 × 2, houppier circulaire à trois étages. */
  private tallJungle(x: number, y0: number, z: number, rng: () => number): void {
    const H = 14 + Math.floor(rng() * 9);
    const radii = [3.2, 3.8, 2.6];
    for (let layer = 0; layer < 3; layer++) {
      const y = y0 + H - 2 + layer;
      const r2 = radii[layer] * radii[layer];
      for (let dz = -3; dz <= 4; dz++) {
        for (let dx = -3; dx <= 4; dx++) {
          const roll = rng();
          const d2 = (dx - 0.5) * (dx - 0.5) + (dz - 0.5) * (dz - 0.5);
          if (d2 > r2 || (d2 > r2 * 0.8 && roll < 0.3)) continue;
          this.leaf(x + dx, y, z + dz, B.JUNGLE_LEAVES);
        }
      }
    }
    for (let q = 0; q < 4; q++) {
      const tx = x + (q & 1);
      const tz = z + (q >> 1);
      for (let i = 0; i < H; i++) this.log(tx, y0 + i, tz, B.JUNGLE_LOG);
      // prolonge le tronc vers le bas si le sol est plus bas sous ce quart
      if (tx >= 0 && tx < CHUNK_SIZE && tz >= 0 && tz < CHUNK_SIZE) {
        for (let y = y0 - 1; y > y0 - 8 && y > 0; y--) {
          const idx = (y << 8) | (tz << 4) | tx;
          const cur = this.blocks[idx];
          if (cur === B.GRASS) {
            this.blocks[idx] = B.DIRT;
            break;
          }
          if (cur !== B.AIR && cur !== B.WATER && !(cur >= B.OAK_LEAVES && cur <= B.ACACIA_LEAVES)) break;
          this.blocks[idx] = B.JUNGLE_LOG;
        }
      }
    }
    // lianes le long du tronc
    for (let i = 2; i < H - 2; i++) {
      if (rng() < 0.18) this.leaf(x - 1, y0 + i, z, B.VINE, 1 << 3);
      if (rng() < 0.18) this.leaf(x + 2, y0 + i, z + 1, B.VINE, 1 << 1);
      if (rng() < 0.18) this.leaf(x + 1, y0 + i, z - 1, B.VINE, 1 << 0);
      if (rng() < 0.18) this.leaf(x, y0 + i, z + 2, B.VINE, 1 << 2);
    }
  }

  private cactus(lx: number, y0: number, lz: number, rng: () => number): void {
    if (lx < 0 || lx >= CHUNK_SIZE || lz < 0 || lz >= CHUNK_SIZE) return;
    const H = 1 + Math.floor(rng() * 3);
    // un cactus ne pousse pas contre un bloc : les 4 colonnes voisines doivent être plus basses
    const ri = (lz + RING) * RW + lx + RING;
    const top = y0 - 1;
    if (this.ringTop[ri - 1] > top || this.ringTop[ri + 1] > top || this.ringTop[ri - RW] > top || this.ringTop[ri + RW] > top) {
      return;
    }
    for (let i = 0; i < H; i++) {
      const idx = ((y0 + i) << 8) | (lz << 4) | lx;
      if (this.blocks[idx] !== B.AIR) break;
      this.blocks[idx] = B.CACTUS;
    }
  }

  // ------------------------------------------------------------------ plantes

  private placePlants(bx: number, bz: number): void {
    const blocks = this.blocks;
    const meta = this.meta;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const wx = bx + lx;
        const wz = bz + lz;
        const ri = (lz + RING) * RW + lx + RING;
        const pi = (lz + PAD) * PW + lx + PAD;
        const biome = this.pBiome[pi];
        const def = BIOMES[biome];
        const top = this.ringTop[ri];
        const base = (lz << 4) | lx;

        // nénuphars sur l'eau des marais
        if (this.ringWater[ri]) {
          if (biome === BIOME.SWAMP && blocks[((SEA_LEVEL + 1) << 8) | base] === B.AIR
            && blocks[(SEA_LEVEL << 8) | base] === B.WATER && rand2(wx, wz, this.sPlant ^ 0x11) < 0.07) {
            blocks[((SEA_LEVEL + 1) << 8) | base] = B.LILY_PAD;
          }
          continue;
        }
        if (top < SEA_LEVEL || top >= CHUNK_HEIGHT - 6) continue;
        const above = ((top + 1) << 8) | base;
        if (blocks[above] !== B.AIR) continue;
        if (top + 1 >= snowLine(this.pTemp[pi])) continue; // sous la neige
        const ground = blocks[(top << 8) | base];
        const r = rand2(wx, wz, this.sPlant);
        const r2 = rand2(wx, wz, this.sPlant ^ 0x22);

        // canne à sucre : au niveau de la mer, contre l'eau
        if (top === SEA_LEVEL && (ground === B.GRASS || ground === B.SAND || ground === B.DIRT)
          && (this.ringWater[ri - 1] || this.ringWater[ri + 1] || this.ringWater[ri - RW] || this.ringWater[ri + RW])) {
          if (!def.snowy && this.nFlower.noise2(wx / 9 + 300, wz / 9 - 300) > 0.25 && r < 0.45) {
            const hgt = 1 + Math.floor(r2 * 3);
            for (let k = 0; k < hgt; k++) {
              const idx = ((top + 1 + k) << 8) | base;
              if (blocks[idx] !== B.AIR) break;
              blocks[idx] = B.SUGAR_CANE;
            }
            continue;
          }
        }

        if (ground === B.SAND) {
          if (biome === BIOME.DESERT && r < 0.008) blocks[above] = B.DEAD_BUSH;
          continue;
        }
        if (ground !== B.GRASS) continue;

        if (r2 < 0.0005 && !def.dry) {
          blocks[above] = B.PUMPKIN;
          meta[above] = hash2(wx, wz, this.sPlant ^ 0x33) & 3;
          continue;
        }
        if ((biome === BIOME.DARK_FOREST || biome === BIOME.SWAMP || biome === BIOME.TAIGA) && r2 < 0.008) {
          blocks[above] = r2 < 0.005 ? B.BROWN_MUSHROOM : B.RED_MUSHROOM;
          continue;
        }
        // fleurs : par parterres d'une même espèce
        const bed = smoothstep(0.25, 0.6, this.nFlower.noise2(wx / 31, wz / 31));
        if (r2 < def.flowerDensity * bed + 0.003 && def.flowers.length > 0) {
          const cell = hash2(Math.floor(wx / 10), Math.floor(wz / 10), this.sPlant ^ 0x44);
          const own = hash2(wx, wz, this.sPlant ^ 0x55);
          const n = def.flowers.length;
          blocks[above] = def.flowers[(own & 3) === 0 ? (own >>> 4) % n : cell % n];
          continue;
        }
        if (r < def.grassDensity) {
          blocks[above] = rand2(wx, wz, this.sPlant ^ 0x66) < def.fernRatio ? B.FERN : B.TALL_GRASS;
        }
      }
    }
  }

  // ------------------------------------------------------------------ neige

  /** Couche de neige sur le sommet des colonnes froides ou hautes, glace sur l'eau gelée. */
  private placeSnow(): void {
    const blocks = this.blocks;
    for (let lz = 0; lz < CHUNK_SIZE; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const pi = (lz + PAD) * PW + lx + PAD;
        const line = snowLine(this.pTemp[pi]);
        if (line > CHUNK_HEIGHT) continue;
        const base = (lz << 4) | lx;
        let top = CHUNK_HEIGHT - 2;
        while (top > 0 && blocks[(top << 8) | base] === B.AIR) top--;
        if (top + 1 < line) continue;
        const b = blocks[(top << 8) | base];
        if (b === B.WATER) {
          if (BIOMES[this.pBiome[pi]].snowy) blocks[(top << 8) | base] = B.ICE;
        } else if (snowSupport(b)) {
          blocks[((top + 1) << 8) | base] = B.SNOW_LAYER;
        }
      }
    }
  }
}

/** Blocs pleins sur lesquels la neige tient. */
function snowSupport(b: number): boolean {
  return (
    (b >= B.STONE && b <= B.SNOW_BLOCK && b !== B.BEDROCK) ||
    (b >= B.COAL_ORE && b <= B.EMERALD_ORE) ||
    (b >= B.OAK_LOG && b <= B.ACACIA_LOG) ||
    (b >= B.OAK_LEAVES && b <= B.ACACIA_LEAVES)
  );
}

/** Biome d'une colonne à partir de son climat et de son relief nominal. */
function pickBiome(c: ColumnSample): number {
  const { temp, humid, height: h, cont, mount } = c;
  const cold = temp < 0.2;
  if (c.swamp > 0.45) return BIOME.SWAMP;
  if (h < SEA_LEVEL) {
    if (c.river > 0.3 && cont > -0.08) return cold ? BIOME.FROZEN_RIVER : BIOME.RIVER;
    if (cold) return BIOME.FROZEN_OCEAN;
    return cont < -0.5 ? BIOME.DEEP_OCEAN : BIOME.OCEAN;
  }
  if (cont < 0.035 && h < 64.6) {
    if (c.ero < -0.45) return BIOME.STONY_SHORE;
    return cold ? BIOME.SNOWY_BEACH : BIOME.BEACH;
  }
  if (mount > 0.42) return temp < 0.32 ? BIOME.SNOWY_MOUNTAINS : BIOME.MOUNTAINS;
  if (cold) return humid > 0.5 ? BIOME.SNOWY_TAIGA : BIOME.SNOWY_PLAINS;
  if (temp < 0.4) return humid > 0.42 ? BIOME.TAIGA : BIOME.PLAINS;
  if (temp < 0.66) {
    if (humid < 0.36) return BIOME.PLAINS;
    if (humid < 0.56) return BIOME.FOREST;
    if (humid < 0.68) return BIOME.BIRCH_FOREST;
    return BIOME.DARK_FOREST;
  }
  if (humid < 0.4) return BIOME.DESERT;
  if (humid < 0.58) return BIOME.SAVANNA;
  return BIOME.JUNGLE;
}

/** Recalcule la carte des hauteurs d'un chunk (plus haut bloc non vide + 1). */
export function computeHeightmap(blocks: Uint8Array, heightmap: Uint8Array): void {
  for (let i = 0; i < CHUNK_AREA; i++) {
    let y = CHUNK_HEIGHT - 1;
    while (y >= 0 && blocks[(y << 8) | i] === B.AIR) y--;
    heightmap[i] = y + 1;
  }
}
