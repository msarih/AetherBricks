/**
 * Recrée une entité à partir de sa donnée sauvegardée (voir Entity.save()).
 */
import type { Entity, EntityData } from './Entity';
import { EndCrystal } from './EndMobs';
import { loadMob } from './Mobs';
import { Arrow, FallingBlock, Fireball, ItemEntity, Tnt } from './Objects';
import { Boat, Minecart } from './Vehicles';

function isEntityData(d: unknown): d is EntityData {
  if (typeof d !== 'object' || d === null) return false;
  const o = d as Record<string, unknown>;
  return typeof o.type === 'string' && Number.isFinite(o.x) && Number.isFinite(o.y) && Number.isFinite(o.z);
}

/** Retourne null si la donnée est invalide ou d'un type inconnu (elle est alors ignorée). */
export function createEntity(data: unknown): Entity | null {
  if (!isEntityData(data)) return null;
  try {
    switch (data.type) {
      case 'item':
        return ItemEntity.load(data);
      case 'falling_block':
        return FallingBlock.load(data);
      case 'tnt':
        return Tnt.load(data);
      case 'arrow':
        return Arrow.load(data);
      case 'fireball':
        return Fireball.load(data);
      case 'mob':
        return loadMob(data);
      case 'end_crystal':
        return EndCrystal.load(data);
      case 'boat':
        return Boat.load(data);
      case 'minecart':
        return Minecart.load(data);
      default:
        return null;
    }
  } catch {
    return null;
  }
}
