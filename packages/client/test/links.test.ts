import { describe, expect, it } from 'vitest';
import { notificationRoute, parseDeepLink } from '../src/links';
import type { Target } from '../src/target';

describe('parseDeepLink', () => {
  it('opens a view, the upgrade or the notification settings', () => {
    expect(parseDeepLink('willitsnow://view/now')).toEqual({ kind: 'view', view: 'now' });
    expect(parseDeepLink('willitsnow://view/today')).toEqual({ kind: 'view', view: 'today' });
    expect(parseDeepLink('willitsnow://view/week')).toEqual({ kind: 'view', view: 'week' });
    expect(parseDeepLink('willitsnow://upgrade')).toEqual({ kind: 'upgrade' });
    expect(parseDeepLink('willitsnow://settings/notifications')).toEqual({
      kind: 'settings',
      section: 'notifications',
    });
  });

  it('ignores case, a trailing slash, a query and a fragment', () => {
    expect(parseDeepLink(' WillItSnow://View/Today/ ')).toEqual({ kind: 'view', view: 'today' });
    expect(parseDeepLink('willitsnow://upgrade/?from=widget')).toEqual({ kind: 'upgrade' });
    expect(parseDeepLink('willitsnow://view/week#top')).toEqual({ kind: 'view', view: 'week' });
  });

  it('is null for anything else', () => {
    for (const url of [
      '',
      'willitsnow://',
      'willitsnow://view',
      'willitsnow://view/tomorrow',
      'willitsnow://view/today/more',
      'willitsnow://upgrade/now',
      'willitsnow://settings',
      'willitsnow://settings/privacy',
      'willitsnow://place/leeds-gb',
      'isitwindy://view/now',
      'https://willitsnow.today/view/now',
      'willitsnow:view/now',
    ]) {
      expect(parseDeepLink(url), url).toBeNull();
    }
  });
});

describe('notificationRoute', () => {
  // The evening notification for Durham (spec section 8.5), about Wednesday 2 December.
  const payload = {
    aps: { alert: { title: 'Snow likely in Durham tomorrow', body: '1 to 2cm of snow.' } },
    topic: 'snow',
    kind: 'evening',
    date: '2026-12-02',
    view: 'today',
    place: 'place=durham-gb',
    name: 'Durham',
  };
  const durham = { kind: 'city', slug: 'durham-gb', name: 'Durham' };
  const on = (date: string | null) => () => date;

  it('opens its place on the middle view the evening before, and on the day', () => {
    const route = { kind: 'place', target: durham, view: 'today' };
    expect(notificationRoute(payload, on('2026-12-01'))).toEqual(route);
    expect(notificationRoute(payload, on('2026-12-02'))).toEqual(route);
    // Without the place's date, the notification is taken as current.
    expect(notificationRoute(payload, on(null))).toEqual(route);
  });

  it('opens the place on its view for the time of day once the day has passed', () => {
    expect(notificationRoute(payload, on('2026-12-03'))).toMatchObject({ view: 'default' });
    expect(notificationRoute(payload, on('2026-11-30'))).toMatchObject({ view: 'default' });
    expect(notificationRoute(payload, on('not a date'))).toMatchObject({ view: 'default' });
  });

  it('asks for the place’s date with the place it opens', () => {
    const asked: Target[] = [];
    notificationRoute(payload, (t) => {
      asked.push(t);
      return null;
    });
    expect(asked).toEqual([durham]);
  });

  it('opens coordinates as they were registered, without renaming them', () => {
    const searched = {
      ...payload,
      place: 'lat=54.95&lon=-2.1&name=Hexham&country=GB&source=search',
      name: 'Somewhere else',
    };
    expect(notificationRoute(searched, on('2026-12-01'))).toEqual({
      kind: 'place',
      target: {
        kind: 'coords',
        source: 'search',
        lat: 54.95,
        lon: -2.1,
        name: 'Hexham',
        country: 'GB',
      },
      view: 'today',
    });
    const device = { ...payload, place: 'lat=53.8&lon=-1.55&source=device', name: 'Leeds' };
    expect(notificationRoute(device, on('2026-12-01'))!).toMatchObject({
      target: { kind: 'coords', source: 'device', lat: 53.8, lon: -1.55 },
    });
    expect(notificationRoute(device, on('2026-12-01'))).not.toHaveProperty('target.name');
  });

  it('keeps a city without a name when the notification has none', () => {
    for (const name of [undefined, '', 42]) {
      expect(notificationRoute({ ...payload, name }, on('2026-12-01'))).toMatchObject({
        target: { kind: 'city', slug: 'durham-gb' },
      });
      expect(notificationRoute({ ...payload, name }, on('2026-12-01'))).not.toHaveProperty(
        'target.name',
      );
    }
  });

  it('is null for a payload that is malformed, for another topic, or for no chosen place', () => {
    for (const bad of [
      null,
      undefined,
      'place=durham-gb',
      42,
      {},
      { ...payload, topic: 'wind' },
      { ...payload, topic: undefined },
      { ...payload, date: undefined },
      { ...payload, date: '2 December' },
      { ...payload, date: '2026-12-32' },
      { ...payload, date: '2026-02-30' },
      { ...payload, view: 'tomorrow' },
      { ...payload, view: undefined },
      { ...payload, place: 42 },
      { ...payload, place: '' },
      { ...payload, place: 'units=c' },
      { ...payload, place: 'place=' },
      { ...payload, place: 'lat=95&lon=0' },
    ]) {
      expect(notificationRoute(bad, on('2026-12-01')), JSON.stringify(bad)).toBeNull();
    }
  });
});
