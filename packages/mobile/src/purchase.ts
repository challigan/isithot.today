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
