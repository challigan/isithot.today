import { describe, expect, it } from 'vitest';
import { APP_COPY } from '../src/appCopy';
import { STOREKIT_DIR, STOREKIT_PATH, storeKitJson, xcodeJson } from '../src/exportStoreKit';
import { PURCHASE } from '../src/purchase';

/**
 * Snow.storekit as Xcode's StoreKit editor writes it (format 6.3): `" : "` after a key, keys in
 * case-insensitive order, an empty array over a blank line, and one newline at the end.
 */
const SNOW_STOREKIT = `{
  "appPolicies" : {
    "eula" : "",
    "policies" : [
      {
        "locale" : "en_GB",
        "policyText" : "",
        "policyURL" : ""
      }
    ]
  },
  "identifier" : "5A1C3E07",
  "nonRenewingSubscriptions" : [

  ],
  "products" : [
    {
      "displayPrice" : "1.99",
      "familyShareable" : true,
      "internalID" : "6B2D4F18",
      "localizations" : [
        {
          "description" : "No ads, plus home and lock screen widgets",
          "displayName" : "Remove ads and add widgets",
          "locale" : "en_GB"
        }
      ],
      "productID" : "today.willitsnow.app.unlock",
      "referenceName" : "Snow unlock",
      "type" : "NonConsumable"
    }
  ],
  "settings" : {
    "_askToBuyEnabled" : false,
    "_billingGracePeriodEnabled" : false,
    "_billingIssuesEnabled" : false,
    "_disableDialogs" : false,
    "_failTransactionsEnabled" : false,
    "_locale" : "en_GB",
    "_renewalBillingIssuesEnabled" : false,
    "_storefront" : "GBR",
    "_storeKitErrors" : [

    ],
    "_timeRate" : 0
  },
  "subscriptionBundleGroups" : [

  ],
  "subscriptionGroups" : [

  ],
  "subscriptionSuiteGroups" : [

  ],
  "version" : {
    "major" : 6,
    "minor" : 3
  }
}
`;

interface StoreKitFile {
  identifier: string;
  version: { major: number; minor: number };
  products: {
    displayPrice: string;
    familyShareable: boolean;
    internalID: string;
    localizations: { description: string; displayName: string; locale: string }[];
    productID: string;
    referenceName: string;
    type: string;
  }[];
  nonRenewingSubscriptions: unknown[];
  subscriptionGroups: unknown[];
  subscriptionBundleGroups: unknown[];
  subscriptionSuiteGroups: unknown[];
  settings: Record<string, unknown>;
}

describe('storeKitJson', () => {
  const text = storeKitJson();
  const file = JSON.parse(text) as StoreKitFile;

  it('goes beside the app, outside every target, as Xcode writes it', () => {
    expect(STOREKIT_DIR).toBe('apps/ios/Apps/Snow/StoreKit');
    expect(STOREKIT_PATH).toBe(`${STOREKIT_DIR}/Snow.storekit`);
    expect(text).toBe(SNOW_STOREKIT);
    // Xcode's form for any value, so the editor saving it unchanged leaves the same bytes.
    expect(xcodeJson(JSON.parse(text)) + '\n').toBe(text);
    expect(text).not.toContain('":');
    expect(text.endsWith('}\n')).toBe(true);
    expect(text.endsWith('\n\n')).toBe(false);
  });

  it('sells the one purchase, as PURCHASE and the copy have it', () => {
    expect(file.version).toEqual({ major: 6, minor: 3 });
    expect(file.products).toHaveLength(1);
    expect(file.nonRenewingSubscriptions).toEqual([]);
    expect(file.subscriptionGroups).toEqual([]);
    expect(file.subscriptionBundleGroups).toEqual([]);
    expect(file.subscriptionSuiteGroups).toEqual([]);
    const [product] = file.products;
    expect(product!.productID).toBe(PURCHASE.productID);
    expect(product!.referenceName).toBe(PURCHASE.referenceName);
    expect(product!.type).toBe(PURCHASE.type);
    expect(product!.displayPrice).toBe(PURCHASE.price);
    expect(product!.familyShareable).toBe(PURCHASE.familyShareable);
    expect(product!.localizations).toEqual([
      {
        description: APP_COPY.upgradeDescription,
        displayName: APP_COPY.upgradeTitle,
        locale: 'en_GB',
      },
    ]);
  });

  it("sells it in the UK storefront, with none of the editor's test settings on", () => {
    expect(file.settings._storefront).toBe('GBR');
    expect(file.settings._locale).toBe('en_GB');
    expect(PURCHASE.storefront).toBe('GBR');
    expect(PURCHASE.locale).toBe('en_GB');
    for (const setting of ['_askToBuyEnabled', '_disableDialogs', '_failTransactionsEnabled']) {
      expect(file.settings[setting], setting).toBe(false);
    }
  });

  it('is the same every time, its identifiers fixed', () => {
    expect(file.identifier).toBe('5A1C3E07');
    expect(file.products[0]!.internalID).toBe('6B2D4F18');
    expect(storeKitJson()).toBe(text);
  });
});

describe('xcodeJson', () => {
  it("writes JSON as Xcode's StoreKit editor does", () => {
    expect(xcodeJson({ b: 1, a: [true, null] })).toBe(
      '{\n  "a" : [\n    true,\n    null\n  ],\n  "b" : 1\n}',
    );
    expect(xcodeJson({ a: { b: [] }, c: {} })).toBe(
      '{\n  "a" : {\n    "b" : [\n\n    ]\n  },\n  "c" : {\n\n  }\n}',
    );
    expect(xcodeJson([])).toBe('[\n\n]');
    expect(xcodeJson('x')).toBe('"x"');
  });

  it('orders keys without regard to case, as Xcode does', () => {
    expect(xcodeJson({ _storeKitErrors: [], _storefront: 'GBR', B: 1, a: 2 })).toBe(
      '{\n  "_storefront" : "GBR",\n  "_storeKitErrors" : [\n\n  ],\n  "a" : 2,\n  "B" : 1\n}',
    );
  });

  it('leaves a slash as it is, and escapes what JSON must', () => {
    expect(xcodeJson({ url: 'https://x/y', quote: 'say "hi"\n' })).toBe(
      '{\n  "quote" : "say \\"hi\\"\\n",\n  "url" : "https://x/y"\n}',
    );
  });
});
