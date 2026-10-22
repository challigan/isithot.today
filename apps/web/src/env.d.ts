/// <reference types="astro/client" />

interface ImportMetaEnv {
  /** "true" turns the AdSense unit on. Off until the paid Open-Meteo plan and AdSense approval. */
  readonly PUBLIC_ADS_ENABLED?: string;
  /** AdSense publisher ID, e.g. "ca-pub-1234567890123456". Also used to generate ads.txt. */
  readonly PUBLIC_ADSENSE_CLIENT?: string;
  /** AdSense ad unit slot ID. */
  readonly PUBLIC_ADSENSE_SLOT?: string;
  /** AdMob publisher ID for the apps, e.g. "pub-1234567890123456". Generates app-ads.txt. */
  readonly PUBLIC_ADMOB_PUBLISHER_ID?: string;
  /** Cloudflare Web Analytics token (cookieless). */
  readonly PUBLIC_CF_BEACON_TOKEN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare namespace App {
  // eslint-disable-next-line @typescript-eslint/consistent-type-imports -- must stay a global script
  type Locals = import('@astrojs/netlify').NetlifyLocals;
}
