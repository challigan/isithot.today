/**
 * The app's one in-app purchase (iOS build spec, section 13; Carl's Q4): a non-consumable that
 * removes the ads and turns the widgets on, as App Store Connect has it (C9). `exportStoreKit.ts`
 * writes Snow.storekit from it, and `exportConstants.ts` the app's `Constants.Purchase`, so the
 * file the StoreKit tests buy from, the app and App Store Connect can't drift apart. The display
 * name and description are copy (`APP_COPY`), under its rules.
 */
export const PURCHASE = {
  productID: 'today.willitsnow.app.unlock',
  referenceName: 'Snow unlock',
  type: 'NonConsumable',
  /** The price in the GBR storefront, as Snow.storekit writes it: a bare decimal. */
  price: '1.99',
  storefront: 'GBR',
  locale: 'en_GB',
  familyShareable: true,
} as const;

/** What StoreKit shows for `price` in `storefront`, and the Debug stand-in shows: "£1.99". */
export const PURCHASE_DISPLAY_PRICE = new Intl.NumberFormat('en-GB', {
  style: 'currency',
  currency: 'GBP',
}).format(Number(PURCHASE.price));

/**
 * How long the widget waits for StoreKit's entitlements before it goes on with `unlock.v1` alone
 * (iOS build spec 11.2 step 1, V3). iOS 26.4 and 26.5 are reported to leave
 * `Transaction.currentEntitlements` silent until a restart, and a timeline never finished is asked
 * for again and again. An answer that comes late, or empty, never locks (DECISIONS, "The widgets
 * in the iPhone app (phase 7.2)").
 */
export const PURCHASE_WIDGET_CHECK_MS = 2000;
