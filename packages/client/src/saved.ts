/**
 * The picker's saved places, beside its recent places: at most `PLACES.savedMax`, in the order
 * saved with the newest last, one entry per place (`targetKey`). The two lists change together,
 * so each action takes both and gives both (`PlaceLists`), and a place is never shown in both:
 * saving takes it out of the recent places, removing it puts it back on top of them (so one more
 * tap undoes it), and choosing a saved place leaves the recent places alone.
 *
 * Approximate IP location is never saved (it is the server's guess, not a place), and nor is the
 * phone's own point (a `coords` target from `device`): a device fix follows the phone, and a
 * saved place that moved, or one that stood still under "my location", would mislead. To keep
 * where you are, search for the town and save that.
 *
 * Swift: `IsItLogic/SavedPlaces.swift`, checked against the golden vectors in `saved.json`.
 */
import { PLACES } from './config';
import { addRecent, removeRecent, type RecentPlace } from './recent';
import { targetKey, type PlaceTarget, type Target } from './target';

export interface SavedPlace {
  /** The place, as it was chosen or found. */
  target: PlaceTarget;
  /** Its name as shown ("Leeds"). It doesn't change when its answer names it differently. */
  name: string;
  /** The line beneath it ("England, United Kingdom"), when known. */
  detail?: string;
}

/** The picker's two lists, which every action changes together. */
export interface PlaceLists {
  saved: readonly SavedPlace[];
  recent: readonly RecentPlace[];
}

/** Whether a saved place is `target`'s place, by its key. */
export function isSaved(saved: readonly SavedPlace[], target: Target): boolean {
  const key = targetKey(target);
  return saved.some((s) => targetKey(s.target) === key);
}

/**
 * Whether `target` can be saved: a place someone chose or found (not approximate IP location, and
 * not the phone's own point), not saved already, with room for one more.
 */
export function canSave(saved: readonly SavedPlace[], target: Target): boolean {
  if (target.kind === 'ip') return false;
  if (target.kind === 'coords' && target.source === 'device') return false;
  return saved.length < PLACES.savedMax && !isSaved(saved, target);
}

/**
 * `place` saved, at the end of the saved places, and out of the recent places. A place that
 * can't be saved, or has no name to show, leaves both lists as they were.
 */
export function savePlace(lists: PlaceLists, place: SavedPlace): PlaceLists {
  if (place.name === '' || !canSave(lists.saved, place.target)) return lists;
  return { saved: [...lists.saved, place], recent: removeRecent(lists.recent, place.target) };
}

/**
 * `target`'s place out of the saved places, and back on top of the recent places, as it was
 * saved (its target, name and line), the list cut to `PLACES.recentMax`. A place that isn't saved
 * leaves both lists as they were.
 */
export function unsavePlace(lists: PlaceLists, target: Target): PlaceLists {
  const key = targetKey(target);
  const place = lists.saved.find((s) => targetKey(s.target) === key);
  if (!place) return lists;
  return {
    saved: lists.saved.filter((s) => targetKey(s.target) !== key),
    recent: addRecent(lists.recent, place.target, place.name, PLACES.recentMax, place.detail),
  };
}

/**
 * The lists once `target` is chosen in the picker under `name`: a saved place stays where it is,
 * so the list doesn't shuffle under the thumb, and doesn't join the recent places; any other
 * joins the recent places (`addRecent`), with its line when it has one.
 */
export function choosePlace(
  lists: PlaceLists,
  target: Target,
  name: string,
  detail?: string,
): PlaceLists {
  if (isSaved(lists.saved, target)) return lists;
  return {
    saved: lists.saved,
    recent: addRecent(lists.recent, target, name, PLACES.recentMax, detail),
  };
}

/**
 * The recent places the picker shows under "Recent": those that aren't saved. Each action keeps
 * the lists apart, but the apps write them one after the other, so a write cut short between
 * the two could leave a place in both, and it is then shown once, under "Saved".
 */
export function shownRecent(lists: PlaceLists): RecentPlace[] {
  return lists.recent.filter((r) => !isSaved(lists.saved, r.target));
}
