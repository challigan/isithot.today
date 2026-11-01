/**
 * `Snow.storekit` (iOS build spec, section 13): the StoreKit configuration the scheme's Run action
 * and the StoreKit tests buy from, written from `PURCHASE` and the copy, so it sells what App
 * Store Connect sells, under the same name, description and price. It is written as Xcode's
 * StoreKit editor writes it (format 6.3), so opening and saving it in Xcode with no change leaves
 * the same bytes; a setting changed there is a difference `pnpm mobile:check` fails on, and is
 * kept by changing this file instead. It sits outside every target's sources, so no build of the
 * app bundles it.
 */
import { APP_COPY } from './appCopy';
import { PURCHASE } from './purchase';

/** A folder of its own beside the app's sources, which the generator owns. */
export const STOREKIT_DIR = 'apps/ios/Apps/Snow/StoreKit';

export const STOREKIT_PATH = `${STOREKIT_DIR}/Snow.storekit`;

/** A JSON value, as `JSON.parse` gives one back. */
export type Json =
  string | number | boolean | null | readonly Json[] | { readonly [key: string]: Json };

const isList = (value: Json): value is readonly Json[] => Array.isArray(value);

/**
 * Keys in the order Xcode writes them: without regard to case (`_storefront` before
 * `_storeKitErrors`), and by code unit when two differ only in case.
 */
function xcodeOrder(a: string, b: string): number {
  const [x, y] = [a.toLowerCase(), b.toLowerCase()];
  if (x !== y) return x < y ? -1 : 1;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * `value` as JSON in the form Xcode's StoreKit editor saves a `.storekit` file in: two spaces in
 * at each level, `" : "` between a key and its value, keys in `xcodeOrder`, an empty array or
 * object as its brackets around a blank line, and strings as `JSON.stringify` writes them, a `/`
 * left as it is. `indent` is the indentation of the line the value starts on.
 */
export function xcodeJson(value: Json, indent = ''): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  const inner = `${indent}  `;
  const list = isList(value);
  const items = list
    ? value.map((item) => xcodeJson(item, inner))
    : Object.keys(value)
        .sort(xcodeOrder)
        .map((key) => `${JSON.stringify(key)} : ${xcodeJson(value[key]!, inner)}`);
  const lines = items.map((item) => `${inner}${item}`).join(',\n');
  return list ? `[\n${lines}\n${indent}]` : `{\n${lines}\n${indent}}`;
}

/**
 * The file's own ID and the product's, which Xcode's editor makes up when it adds them: fixed
 * here, so generating twice gives the same file.
 */
const FILE_ID = '5A1C3E07';
const PRODUCT_INTERNAL_ID = '6B2D4F18';

export function storeKitJson(): string {
  const file: Json = {
    appPolicies: {
      eula: '',
      policies: [{ locale: PURCHASE.locale, policyText: '', policyURL: '' }],
    },
    identifier: FILE_ID,
    nonRenewingSubscriptions: [],
    products: [
      {
        displayPrice: PURCHASE.price,
        familyShareable: PURCHASE.familyShareable,
        internalID: PRODUCT_INTERNAL_ID,
        localizations: [
          {
            description: APP_COPY.upgradeDescription,
            displayName: APP_COPY.upgradeTitle,
            locale: PURCHASE.locale,
          },
        ],
        productID: PURCHASE.productID,
        referenceName: PURCHASE.referenceName,
        type: PURCHASE.type,
      },
    ],
    // The editor's test settings, all off: the StoreKit tests set Ask to Buy, the dialogs and
    // the errors on their own `SKTestSession`.
    settings: {
      _askToBuyEnabled: false,
      _billingGracePeriodEnabled: false,
      _billingIssuesEnabled: false,
      _disableDialogs: false,
      _failTransactionsEnabled: false,
      _locale: PURCHASE.locale,
      _renewalBillingIssuesEnabled: false,
      _storefront: PURCHASE.storefront,
      _storeKitErrors: [],
      _timeRate: 0,
    },
    subscriptionBundleGroups: [],
    subscriptionGroups: [],
    subscriptionSuiteGroups: [],
    version: { major: 6, minor: 3 },
  };
  return `${xcodeJson(file)}\n`;
}
