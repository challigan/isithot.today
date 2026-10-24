/**
 * The app's "Credits and licences" screen (iOS build spec, section 10.6), beyond what core
 * already words for the website (`COPY.forecastCredit`, `metOfficeCredit` and `climateCredit`,
 * linked by `CREDIT_LINKS`): the forecast models' agencies, as the About page lists them; the
 * climate records' and the place names' credits; and the answer's typeface and Google's two SDKs,
 * each with the notice the app bundles as a file in `LICENCES_DIR`. `pnpm mobile:generate` writes
 * them into `AppCredits.swift` (`exportCredits.ts`).
 *
 * These are names and licences as their owners write them ("SIL Open Font License", "NASA
 * Langley Research Center"), so they are data here rather than `APP_COPY`, whose sentence case
 * and British spelling rules they can't follow. Like the app's copy, they name no other weather
 * type: the climate records are credited for snowfall alone.
 */
import { COPY, MODELS, MODEL_AGENCIES } from '@isithot/core';

/** A phrase of a credit that links out, and where to. */
export interface CreditLink {
  phrase: string;
  url: string;
}

/** A credit for the data, with the links it needs beyond core's `CREDIT_LINKS`. */
export interface DataCredit {
  text: string;
  links: CreditLink[];
}

/** A typeface or software in the app, and the notice it bundles. */
export interface Notice {
  /** "Bricolage Grotesque" */
  name: string;
  /** What it does in the app, its copyright and its licence. */
  summary: string;
  /** Its project's page. */
  url: string;
  /** The notice's file in `LICENCES_DIR`, without `.txt`: the app's resource name. */
  file: string;
}

/** The licence notices the app bundles: files under the app's resources, copied whole. */
export const LICENCES_DIR = 'apps/ios/Apps/Snow/Resources/Licences';

/**
 * Who runs each forecast model, as the About page lists them (`AboutBody.astro`): "ECMWF, NOAA
 * (GFS), …, Météo-France and Environment and Climate Change Canada (GEM)". A model whose agency
 * has its own name is named once.
 */
export function modelAgencies(): string {
  const agencies = MODELS.map((m) => {
    const agency = MODEL_AGENCIES[m.id];
    if (!agency) throw new Error(`No agency for the model ${m.id} in core's MODEL_AGENCIES`);
    return agency === m.name ? agency : `${agency} (${m.name})`;
  });
  return agencies.length > 1
    ? `${agencies.slice(0, -1).join(', ')} and ${agencies.at(-1)}`
    : agencies.join('');
}

/**
 * The data's credits beyond the footer's, as the About page gives them: the climate records
 * (snowfall only, the one thing the app reads from them) and the place names. "NASA POWER" and
 * "CC BY 4.0" are linked by core's `CREDIT_LINKS`; GeoNames links here.
 */
export const DATA_CREDITS: readonly DataCredit[] = [
  {
    text:
      `${COPY.climateCredit} (Prediction Of Worldwide Energy Resources), long-term monthly ` +
      'averages of snowfall from the NASA Langley Research Center (LaRC) POWER Project, ' +
      'licensed under CC BY 4.0',
    links: [],
  },
  {
    text: 'Place names: GeoNames, licensed under CC BY 4.0',
    links: [{ phrase: 'GeoNames', url: 'https://www.geonames.org/' }],
  },
];

/**
 * The typeface and the software, each with its notice in full. Google's two notices are their
 * Swift packages' own LICENSE files, at the revisions `apps/ios/Package.resolved` pins; the
 * typeface's is the licence of the package the answer font is made from (`exportFont.ts`).
 */
export const NOTICES: readonly Notice[] = [
  {
    name: 'Bricolage Grotesque',
    summary:
      "The answer's typeface. Copyright 2022 The Bricolage Grotesque Project Authors, licensed " +
      'under the SIL Open Font License, Version 1.1.',
    url: 'https://github.com/ateliertriay/bricolage',
    file: 'BricolageGrotesque-OFL',
  },
  {
    name: 'Google Mobile Ads SDK',
    summary:
      'Shows the ads in the free version. Its Swift package is copyright 2021 Google LLC, ' +
      'licensed under the Apache License, Version 2.0.',
    url: 'https://github.com/googleads/swift-package-manager-google-mobile-ads',
    file: 'Google-Mobile-Ads-LICENSE',
  },
  {
    name: 'Google User Messaging Platform SDK',
    summary:
      'Asks for your choice about ads where the law requires it. Its Swift package is copyright ' +
      '2021 Google LLC, licensed under the Apache License, Version 2.0.',
    url: 'https://github.com/googleads/swift-package-manager-google-user-messaging-platform',
    file: 'Google-UMP-LICENSE',
  },
];
