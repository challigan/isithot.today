import { describe, expect, it } from 'vitest';
import { PLACES } from '../src/config';
import type { RecentPlace } from '../src/recent';
import {
  canSave,
  choosePlace,
  isSaved,
  savePlace,
  shownRecent,
  unsavePlace,
  type PlaceLists,
  type SavedPlace,
} from '../src/saved';
import { deviceTarget, type PlaceTarget } from '../src/target';

const city = (slug: string, name?: string): PlaceTarget =>
  name === undefined ? { kind: 'city', slug } : { kind: 'city', slug, name };
const saved = (slug: string, detail?: string): SavedPlace =>
  detail === undefined
    ? { target: city(slug), name: slug }
    : { target: city(slug), name: slug, detail };
const recent = (slug: string): RecentPlace => ({ target: city(slug), name: slug });
const lists = (s: SavedPlace[], r: RecentPlace[] = []): PlaceLists => ({ saved: s, recent: r });

const leeds: SavedPlace = {
  target: city('leeds-gb', 'Leeds'),
  name: 'Leeds',
  detail: 'England, United Kingdom',
};
/** Ten saved places: a full list. */
const full = Array.from({ length: PLACES.savedMax }, (_, i) => saved(`place-${i}`));

describe('isSaved', () => {
  it('finds a place by its key, whatever its name', () => {
    expect(isSaved([leeds], city('leeds-gb'))).toBe(true);
    expect(isSaved([leeds], city('leeds-gb', 'Leeds, West Yorkshire'))).toBe(true);
    expect(isSaved([leeds], city('york-gb'))).toBe(false);
    expect(isSaved([], city('leeds-gb'))).toBe(false);
  });

  it('tells a searched point from the same point by the phone', () => {
    const here = deviceTarget(53.8, -1.55);
    const searched: PlaceTarget = { ...here, source: 'search', name: 'Leeds' };
    expect(isSaved([{ target: searched, name: 'Leeds' }], searched)).toBe(true);
    expect(isSaved([{ target: searched, name: 'Leeds' }], here)).toBe(false);
  });
});

describe('canSave', () => {
  it('saves a city page or a searched point that is not saved yet', () => {
    expect(canSave([], city('leeds-gb'))).toBe(true);
    const point: PlaceTarget = { kind: 'coords', source: 'search', lat: 27.7, lon: 85.3 };
    expect(canSave([leeds], point)).toBe(true);
    expect(canSave([leeds], city('leeds-gb'))).toBe(false);
  });

  it('never saves approximate IP location or the phone’s own point', () => {
    expect(canSave([], { kind: 'ip' })).toBe(false);
    expect(canSave([], deviceTarget(53.8, -1.55))).toBe(false);
    expect(canSave([], { ...deviceTarget(53.8, -1.55), name: 'Leeds' })).toBe(false);
  });

  it('stops at PLACES.savedMax', () => {
    expect(canSave(full.slice(1), city('leeds-gb'))).toBe(true);
    expect(canSave(full, city('leeds-gb'))).toBe(false);
  });
});

describe('savePlace', () => {
  it('puts the newest last, and takes it out of the recent places', () => {
    const before = lists([saved('york-gb')], [recent('durham-gb'), recent('leeds-gb')]);
    const after = savePlace(before, leeds);
    expect(after.saved).toEqual([saved('york-gb'), leeds]);
    expect(after.recent).toEqual([recent('durham-gb')]);
  });

  it('saves a place that was not a recent one, leaving them as they were', () => {
    const after = savePlace(lists([], [recent('durham-gb')]), leeds);
    expect(after).toEqual(lists([leeds], [recent('durham-gb')]));
  });

  it('saves the tenth, and refuses the eleventh', () => {
    const nine = lists(full.slice(1), [recent('leeds-gb')]);
    expect(savePlace(nine, leeds).saved).toHaveLength(PLACES.savedMax);
    const ten = lists(full, [recent('leeds-gb')]);
    expect(savePlace(ten, leeds)).toBe(ten);
  });

  it('refuses a place saved already, under any name, and one with no name', () => {
    const before = lists([leeds]);
    expect(savePlace(before, { target: city('leeds-gb'), name: 'Leeds again' })).toBe(before);
    const empty = lists([], [recent('york-gb')]);
    expect(savePlace(empty, { target: city('york-gb'), name: '' })).toBe(empty);
  });

  it('refuses approximate IP location and the phone’s own point', () => {
    const before = lists([]);
    const here = { ...deviceTarget(53.8, -1.55), name: 'Leeds' };
    expect(savePlace(before, { target: here, name: 'Leeds' })).toBe(before);
  });

  it('leaves the lists it was given alone', () => {
    const before = lists([saved('york-gb')], [recent('leeds-gb')]);
    savePlace(before, leeds);
    expect(before).toEqual(lists([saved('york-gb')], [recent('leeds-gb')]));
  });
});

describe('unsavePlace', () => {
  it('puts the place back on top of the recent places, as it was saved', () => {
    const after = unsavePlace(lists([saved('york-gb'), leeds], [recent('durham-gb')]), {
      kind: 'city',
      slug: 'leeds-gb',
    });
    expect(after.saved).toEqual([saved('york-gb')]);
    expect(after.recent).toEqual([
      { target: city('leeds-gb', 'Leeds'), name: 'Leeds', detail: 'England, United Kingdom' },
      recent('durham-gb'),
    ]);
  });

  it('cuts the recent places to PLACES.recentMax, dropping the oldest', () => {
    const five = ['a', 'b', 'c', 'd', 'e'].map(recent);
    const after = unsavePlace(lists([leeds], five), leeds.target);
    expect(after.recent.map((r) => r.name)).toEqual(['Leeds', 'a', 'b', 'c', 'd']);
  });

  it('leaves a place without a line without one', () => {
    const after = unsavePlace(lists([saved('york-gb')]), city('york-gb'));
    expect(after.recent).toEqual([recent('york-gb')]);
    expect(Object.keys(after.recent[0]!)).toEqual(['target', 'name']);
  });

  it('leaves both lists as they were for a place not saved', () => {
    const before = lists([leeds], [recent('york-gb')]);
    expect(unsavePlace(before, city('york-gb'))).toBe(before);
    expect(unsavePlace(before, { kind: 'ip' })).toBe(before);
  });

  it('is undone by saving again', () => {
    const before = lists([leeds], [recent('york-gb')]);
    const back = unsavePlace(before, leeds.target);
    expect(savePlace(back, back.recent[0]!)).toEqual(before);
  });
});

describe('choosePlace', () => {
  it('leaves both lists alone for a saved place', () => {
    const before = lists([leeds], [recent('york-gb')]);
    expect(choosePlace(before, city('leeds-gb'), 'Leeds', 'England, United Kingdom')).toBe(before);
  });

  it('adds any other to the top of the recent places, with its line', () => {
    const before = lists([leeds], [recent('york-gb')]);
    const after = choosePlace(before, city('durham-gb'), 'Durham', 'England, United Kingdom');
    expect(after.saved).toBe(before.saved);
    expect(after.recent).toEqual([
      { target: city('durham-gb'), name: 'Durham', detail: 'England, United Kingdom' },
      recent('york-gb'),
    ]);
    expect(choosePlace(before, city('durham-gb'), 'Durham').recent[0]).toEqual({
      target: city('durham-gb'),
      name: 'Durham',
    });
  });

  it('adds the phone’s point, which can never be saved, as addRecent does', () => {
    const here = deviceTarget(53.8, -1.55);
    const after = choosePlace(lists([]), here, 'Leeds');
    expect(after.recent).toEqual([{ target: here, name: 'Leeds' }]);
    // Approximate IP location is never a recent place.
    expect(choosePlace(lists([], [recent('york-gb')]), { kind: 'ip' }, 'Leeds').recent).toEqual([
      recent('york-gb'),
    ]);
  });
});

describe('shownRecent', () => {
  it('shows the recent places that are not saved, in order', () => {
    const both = lists([leeds], [recent('york-gb'), recent('leeds-gb'), recent('durham-gb')]);
    expect(shownRecent(both)).toEqual([recent('york-gb'), recent('durham-gb')]);
    expect(shownRecent(lists([], [recent('york-gb')]))).toEqual([recent('york-gb')]);
    expect(shownRecent(lists([leeds]))).toEqual([]);
  });
});
