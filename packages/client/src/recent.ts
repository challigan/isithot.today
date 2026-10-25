/**
 * The picker's recent places: newest first, one entry per place (`targetKey`). Approximate IP
 * location is never one.
 *
 * Swift: `IsItLogic/RecentPlaces.swift`, checked against the golden vectors in `recent.json`.
 */
import { PLACES } from './config';
import { targetKey, type PlaceTarget, type Target } from './target';

export interface RecentPlace {
  target: PlaceTarget;
  /** The place's name as it was shown (a device location's comes from its answer). */
  name: string;
  /**
   * The line beneath it ("England, United Kingdom"), when it was chosen from a search result or
   * came back from the saved places, so two places of one name can be told apart. Optional, as
   * what is stored only ever gains optional fields: older entries have none.
   */
  detail?: string;
}

/**
 * The list with `target` first (with `detail` when given), without any older entry for the same
 * place, at most `max` long.
 */
export function addRecent(
  list: readonly RecentPlace[],
  target: Target,
  name: string,
  max: number = PLACES.recentMax,
  detail?: string,
): RecentPlace[] {
  if (target.kind === 'ip') return list.slice(0, max);
  const key = targetKey(target);
  const place: RecentPlace = detail === undefined ? { target, name } : { target, name, detail };
  return [place, ...list.filter((r) => targetKey(r.target) !== key)].slice(0, max);
}

/** The list without `target`. */
export function removeRecent(list: readonly RecentPlace[], target: Target): RecentPlace[] {
  const key = targetKey(target);
  return list.filter((r) => targetKey(r.target) !== key);
}
