/**
 * Aiguille de la boussole et cadran de l'horloge (Minecraft 1.12) : la position affichée
 * rejoint la cible avec un léger ressort (l'aiguille oscille un peu avant de s'arrêter).
 * Dans le Nether, la cible change au hasard à chaque tick : l'aiguille et le cadran s'affolent.
 *
 * Positions en fraction de tour (0..1). Hasard purement visuel, séparé de celui du jeu.
 */
import { mulberry32 } from '../world/gen/Noise';
import { DIAL_FRAMES } from '../world/Tiles';

function wrap(v: number): number {
  return v - Math.floor(v);
}

export class Dial {
  /** Position affichée, 0..1. */
  rotation = 0;
  private speed = 0;
  private started = false;

  /** Un tick : rapproche la position de `target` (0..1). `snap` : place l'aiguille sans ressort. */
  update(target: number, snap = false): void {
    if (snap || !this.started) {
      this.rotation = wrap(target);
      this.speed = 0;
      this.started = true;
      return;
    }
    let d = wrap(target) - this.rotation;
    d -= Math.round(d); // chemin le plus court, -0,5..0,5
    this.speed = (this.speed + d * 0.1) * 0.8;
    this.rotation = wrap(this.rotation + this.speed);
  }

  /** Image à afficher, 0..DIAL_FRAMES-1. */
  get frame(): number {
    return Math.floor(this.rotation * DIAL_FRAMES + 0.5) % DIAL_FRAMES;
  }
}

/**
 * Direction de `to` vue par un regard de lacet `yaw` (0 = vers -z), en fraction de tour,
 * dans le sens horaire vu de dessus : 0 = droit devant, 0,25 = à droite.
 */
export function bearing(fromX: number, fromZ: number, yaw: number, toX: number, toZ: number): number {
  const vx = toX - fromX;
  const vz = toZ - fromZ;
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  // vecteur « à droite » du regard
  const rx = -fz;
  const rz = fx;
  return wrap(Math.atan2(vx * rx + vz * rz, vx * fx + vz * fz) / (Math.PI * 2));
}

/** Cadran de l'horloge : 0 à midi (soleil en haut), 0,5 à minuit. */
export function clockTarget(dayTime: number): number {
  return wrap(dayTime / 24000 - 0.25);
}

/** Hasard visuel des cadrans affolés (Nether). */
export function dialNoise(seed: number): () => number {
  return mulberry32(seed >>> 0);
}
