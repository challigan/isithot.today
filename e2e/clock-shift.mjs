/**
 * Test infrastructure, never part of the site: preloaded into the e2e server by
 * playwright.config.ts only when E2E_CLOCK is set, to run the whole suite as if it were another
 * time of day. Moves this process's clock by E2E_CLOCK_SHIFT_MS; the test pages' clocks move with
 * it (e2e/helpers.ts). Synthetic forecasts, "now" and the 6pm switch to Tomorrow all follow.
 */
const shift = Number(process.env.E2E_CLOCK_SHIFT_MS || 0);

if (shift) {
  const RealDate = Date;
  /** `new Date()` and `Date.now()` read the moved clock; dates built from a value are unchanged. */
  function ShiftedDate(...args) {
    if (!new.target) return new RealDate(RealDate.now() + shift).toString();
    return args.length ? new RealDate(...args) : new RealDate(RealDate.now() + shift);
  }
  Object.setPrototypeOf(ShiftedDate, RealDate);
  ShiftedDate.prototype = RealDate.prototype;
  ShiftedDate.now = () => RealDate.now() + shift;
  globalThis.Date = ShiftedDate;
}
