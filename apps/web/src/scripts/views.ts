/**
 * Keeps the tab bar and the horizontal views scroller in step: tap a tab (or use the arrow
 * keys) to scroll to its view, swipe the views to move the tab. Every load opens on Today.
 *
 * Pages arrive with Now and This week hidden, so the first paint is Today alone. They join
 * the scroller the moment the visitor touches it or uses the tabs, and from then on the
 * scroller takes the height of the view on screen.
 *
 * While a swipe is under way only the tab thumb and (past about two thirds of the way) the
 * page colours follow it; which panel is active for keyboard and screen readers changes once
 * the scroller comes to rest with no finger on it.
 */
import { VIEWS, type View } from '@isithot/core';

export interface ViewsController {
  active(): View;
  go(view: View, opts?: { focus?: boolean; instant?: boolean }): void;
}

export interface ViewsEvents {
  /** The view whose colours the page should show; changes during a swipe. */
  onShow(view: View): void;
  /** The view the scroller came to rest on, after it changed. */
  onSettle(view: View): void;
}

/** Scroll events stop arriving this long before a swipe counts as finished (no `scrollend`). */
const SETTLE_MS = 150;
/** How far past a view a swipe goes before the page takes the next view's colours. */
const SWITCH_AT = 0.65;

export function wireViews(events: ViewsEvents): ViewsController | null {
  const scroller = document.getElementById('views');
  const tabs = document.getElementById('tabs');
  if (!scroller || !tabs) return null;
  const tabFor = (v: View) => tabs.querySelector<HTMLButtonElement>(`[data-view="${v}"]`)!;
  const panelFor = (v: View) => document.getElementById(`view-${v}`)!;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const width = (): number => scroller.clientWidth || 1;
  const position = (): number =>
    Math.min(VIEWS.length - 1, Math.max(0, scroller.scrollLeft / width()));
  const viewAt = (): View => VIEWS[Math.round(position())]!;

  let revealed = VIEWS.every((v) => !panelFor(v).hidden);
  let active: View = revealed ? viewAt() : 'today';
  let shown: View = active;
  /** Set while a tab press scrolls the views, so views passed on the way are not shown. */
  let target: View | null = null;
  let goAt = 0;
  let touching = false;
  let frame = 0;
  let idle: ReturnType<typeof setTimeout> | undefined;
  let lastWidth = scroller.clientWidth;

  /**
   * The scroller is as tall as the view on screen, and never shorter than Today, so the links,
   * ad space and footer below it stay where they are when switching to a shorter view. Taller
   * views are clipped mid-swipe, then fit on arrival.
   */
  function fitHeight(): void {
    if (!revealed) return;
    const height = Math.max(panelFor('today').offsetHeight, panelFor(active).offsetHeight);
    scroller!.style.height = `${height}px`;
  }

  /** Bring Now and This week into the scroller, keeping the current view where it is. */
  function reveal(): void {
    if (revealed) return;
    revealed = true;
    for (const v of VIEWS) panelFor(v).hidden = false;
    scroller!.scrollLeft = VIEWS.indexOf(active) * width();
    fitHeight();
  }

  function selectTab(view: View): void {
    for (const v of VIEWS) {
      const tab = tabFor(v);
      tab.setAttribute('aria-selected', String(v === view));
      tab.tabIndex = v === view ? 0 : -1;
    }
  }

  function show(view: View): void {
    if (view === shown) return;
    shown = view;
    selectTab(view);
    events.onShow(view);
  }

  /**
   * Make `view` the active panel: the others become inert, rescuing focus first. The active
   * view's answer is the page's main heading (Today's is the real h1, for search engines).
   */
  function activate(view: View): void {
    const changed = view !== active;
    active = view;
    // Open the new panel first, so focus can move into it before the old one closes.
    panelFor(view).inert = false;
    const focused = document.activeElement;
    for (const v of VIEWS) {
      const panel = panelFor(v);
      if (v !== view && focused && panel.contains(focused)) {
        panelFor(view).focus({ preventScroll: true });
      }
      panel.inert = v !== view;
      const answer = panel.querySelector('.answer');
      if (v !== 'today') answer?.toggleAttribute('aria-level', v === view);
      if (v !== 'today' && v === view) answer?.setAttribute('aria-level', '1');
    }
    fitHeight();
    if (changed) events.onSettle(view);
  }

  function thumbAt(pos: number, dragging: boolean): void {
    tabs!.toggleAttribute('data-dragging', dragging);
    tabs!.style.setProperty('--pos', dragging ? pos.toFixed(3) : String(pos));
  }

  function settle(): void {
    clearTimeout(idle);
    if (touching || !revealed) return; // touchend schedules another settle.
    // A tab press is still scrolling to its view: its own scrollend (or the fallback) settles.
    // Give up waiting after a couple of seconds, in case the scroll was interrupted.
    if (target && viewAt() !== target && Date.now() - goAt < 2000) {
      scheduleSettle(300);
      return;
    }
    cancelAnimationFrame(frame);
    frame = 0;
    target = null;
    const view = viewAt();
    thumbAt(VIEWS.indexOf(view), false);
    show(view);
    activate(view);
  }

  function scheduleSettle(ms = SETTLE_MS): void {
    clearTimeout(idle);
    idle = setTimeout(settle, ms);
  }

  function go(view: View, opts: { focus?: boolean; instant?: boolean } = {}): void {
    target = view;
    goAt = Date.now();
    reveal();
    const index = VIEWS.indexOf(view);
    const instant = opts.instant || reduceMotion;
    thumbAt(index, false);
    show(view);
    if (opts.focus) tabFor(view).focus();
    panelFor(view).inert = false;
    scroller!.scrollTo({ left: index * width(), behavior: instant ? 'auto' : 'smooth' });
    // A press on the view already showing does not scroll, so nothing else would settle it.
    scheduleSettle(instant ? 0 : 700);
  }

  scroller.addEventListener(
    'scroll',
    () => {
      scheduleSettle();
      if (target || frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        if (target) return;
        const pos = position();
        thumbAt(pos, true);
        const index = VIEWS.indexOf(shown);
        const nearest = Math.round(pos);
        if (!reduceMotion && nearest !== index && Math.abs(pos - index) >= SWITCH_AT) {
          show(VIEWS[nearest]!);
        }
      });
    },
    { passive: true },
  );
  scroller.addEventListener('scrollend', settle);
  scroller.addEventListener(
    'touchstart',
    () => {
      touching = true;
      target = null; // The visitor takes over from any tab press still scrolling.
      reveal();
    },
    { passive: true },
  );
  // A sideways trackpad swipe on a desktop.
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
      target = null;
      reveal();
    },
    { passive: true },
  );
  const release = (): void => {
    touching = false;
    scheduleSettle();
  };
  scroller.addEventListener('touchend', release, { passive: true });
  scroller.addEventListener('touchcancel', release, { passive: true });

  tabs.addEventListener('click', (e) => {
    const tab = (e.target as Element).closest<HTMLElement>('[data-view]');
    const view = tab?.dataset.view as View | undefined;
    if (view && VIEWS.includes(view)) go(view);
  });

  tabs.addEventListener('keydown', (e) => {
    const i = VIEWS.indexOf(shown);
    const next =
      e.key === 'ArrowLeft'
        ? i - 1
        : e.key === 'ArrowRight'
          ? i + 1
          : e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? VIEWS.length - 1
              : null;
    if (next === null) return;
    e.preventDefault();
    go(VIEWS[Math.min(VIEWS.length - 1, Math.max(0, next))]!, { focus: true });
  });

  // Keep the chosen view in place when the width changes (rotation, window resize), but
  // never while a finger is on the screen. Follow the active view's height as its content
  // changes (an answer arriving, a units switch).
  const resized = new ResizeObserver(() => {
    if (scroller.clientWidth !== lastWidth && !touching) {
      lastWidth = scroller.clientWidth;
      if (revealed) scroller.scrollLeft = VIEWS.indexOf(active) * width();
    }
    if (!touching) fitHeight();
  });
  resized.observe(scroller);
  for (const v of VIEWS) resized.observe(panelFor(v));

  thumbAt(VIEWS.indexOf(active), false);
  selectTab(active);
  for (const v of VIEWS) panelFor(v).inert = v !== active;

  return { active: () => active, go };
}
