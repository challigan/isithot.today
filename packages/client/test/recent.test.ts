import { describe, expect, it } from 'vitest';
import { PLACES } from '../src/config';
import { addRecent, removeRecent, type RecentPlace } from '../src/recent';
import { deviceTarget, type PlaceTarget } from '../src/target';

const city = (slug: string, name = slug): PlaceTarget => ({ kind: 'city', slug, name });
const place = (slug: string): RecentPlace => ({ target: city(slug), name: slug });

describe('addRecent', () => {
  it('puts the newest first, once', () => {
    let list: RecentPlace[] = [];
    list = addRecent(list, city('leeds-gb'), 'Leeds');
    list = addRecent(list, city('york-gb'), 'York');
    expect(list.map((r) => r.name)).toEqual(['York', 'Leeds']);
    // The same place again moves to the front, with its latest name.
    list = addRecent(list, city('leeds-gb', 'Leeds, West Yorkshire'), 'Leeds, West Yorkshire');
    expect(list).toEqual([
      { target: city('leeds-gb', 'Leeds, West Yorkshire'), name: 'Leeds, West Yorkshire' },
      { target: city('york-gb'), name: 'York' },
    ]);
  });

  it('tells places apart by their key, as saved answers are', () => {
    const here = deviceTarget(53.8, -1.55);
    const searched = { ...here, source: 'search' as const, name: 'Leeds' };
    const list = addRecent(addRecent([], here, 'Leeds'), searched, 'Leeds');
    expect(list.map((r) => r.target)).toEqual([searched, here]);
    expect(addRecent(list, deviceTarget(53.81, -1.549), 'Leeds')).toHaveLength(2);
  });

  it('keeps five, or as many as asked', () => {
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].reduce<RecentPlace[]>(
      (list, slug) => addRecent(list, city(slug), slug),
      [],
    );
    expect(six.map((r) => r.name)).toEqual(['f', 'e', 'd', 'c', 'b']);
    expect(addRecent(six, city('g'), 'g', 3).map((r) => r.name)).toEqual(['g', 'f', 'e']);
  });

  it('never keeps approximate IP location', () => {
    const list = [place('a'), place('b')];
    expect(addRecent(list, { kind: 'ip' }, 'London')).toEqual(list);
    expect(addRecent(list, { kind: 'ip' }, 'London', 1)).toEqual([place('a')]);
  });

  it('keeps a place’s line when given, and the newer entry’s when chosen again', () => {
    const newcastle = city('newcastle-gb');
    let list = addRecent([], newcastle, 'Newcastle', undefined, 'England, United Kingdom');
    expect(list).toEqual([
      { target: newcastle, name: 'Newcastle', detail: 'England, United Kingdom' },
    ]);
    // Without one, the entry has no `detail` at all, as older stored entries have none.
    list = addRecent(list, city('york-gb'), 'York');
    expect(list[0]).toEqual({ target: city('york-gb'), name: 'York' });
    expect(Object.keys(list[0]!)).toEqual(['target', 'name']);
    // Chosen again, the newer entry replaces the older, line and all.
    list = addRecent(list, newcastle, 'Newcastle', 3, 'New South Wales, Australia');
    expect(list.map((r) => r.detail)).toEqual(['New South Wales, Australia', undefined]);
    expect(addRecent(list, newcastle, 'Newcastle')[0]).toEqual({
      target: newcastle,
      name: 'Newcastle',
    });
  });

  it('keeps PLACES.recentMax by default', () => {
    const many = Array.from({ length: PLACES.recentMax + 2 }, (_, i) => place(`p${i}`));
    expect(addRecent(many, city('q'), 'q')).toHaveLength(PLACES.recentMax);
  });

  it('leaves the list it was given alone', () => {
    const list = [place('a')];
    addRecent(list, city('b'), 'b');
    expect(list).toEqual([place('a')]);
  });
});

describe('removeRecent', () => {
  it('takes a place out, by its key', () => {
    const list = [place('a'), place('b'), place('c')];
    expect(removeRecent(list, city('b', 'Another name')).map((r) => r.name)).toEqual(['a', 'c']);
    expect(removeRecent(list, { kind: 'ip' })).toEqual(list);
    expect(list).toHaveLength(3);
  });
});
