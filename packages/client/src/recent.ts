/**
 * The picker's recent places: newest first, one entry per place (`targetKey`). Approximate IP
 * location is never one.
 *
 * Swift: `IsItLogic/RecentPlaces.swift`, checked against the golden vectors in `recent.json`.
 */
import { targetKey, type PlaceTarget, type Target } from './target';

export interface RecentPlace {
  target: PlaceTarget;
  /** The place's name as it was shown (a device location's comes from its answer). */
  name: string;
}

/** The list with `target` first, without any older entry for the same place, at most `max` long. */
export function addRecent(
  list: readonly RecentPlace[],
  target: Target,
  name: string,
  max = 5,
): RecentPlace[] {
  if (target.kind === 'ip') return list.slice(0, max);
  const key = targetKey(target);
  return [{ target, name }, ...list.filter((r) => targetKey(r.target) !== key)].slice(0, max);
}

/** The list without `target`. */
export function removeRecent(list: readonly RecentPlace[], target: Target): RecentPlace[] {
  const key = targetKey(target);
  return list.filter((r) => targetKey(r.target) !== key);
}
