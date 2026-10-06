/**
 * Loads AdSense only after the page is interactive and consent is known. The answer never
 * waits for ad code. With Google's Privacy & messaging CMP switched on in AdSense, the CMP
 * shows the consent banner to UK/EEA visitors and AdSense waits for its TCF signal before
 * requesting any ad.
 */
declare global {
  interface Window {
    adsbygoogle?: unknown[];
    __tcfapi?: (
      command: string,
      version: number,
      callback: (data: { eventStatus?: string; gdprApplies?: boolean } | null, ok: boolean) => void,
    ) => void;
  }
}

function idle(): Promise<void> {
  return new Promise((resolve) => {
    const go = () =>
      'requestIdleCallback' in window
        ? requestIdleCallback(() => resolve(), { timeout: 3000 })
        : setTimeout(resolve, 1);
    if (document.readyState === 'complete') go();
    else window.addEventListener('load', go, { once: true });
  });
}

function script(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.async = true;
    s.src = src;
    s.crossOrigin = 'anonymous';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.append(s);
  });
}

/** Resolves once the CMP says consent is settled, or immediately where GDPR does not apply. */
function consentSettled(): Promise<void> {
  return new Promise((resolve) => {
    const started = Date.now();
    const wait = () => {
      if (window.__tcfapi) {
        window.__tcfapi('addEventListener', 2, (data, ok) => {
          if (!ok || !data) return;
          if (data.gdprApplies === false) resolve();
          if (data.eventStatus === 'tcloaded' || data.eventStatus === 'useractioncomplete')
            resolve();
        });
      } else if (Date.now() - started > 4000) {
        // No CMP on the page: AdSense serves non-personalised ads under its own rules.
        resolve();
      } else {
        setTimeout(wait, 100);
      }
    };
    wait();
  });
}

export async function loadAds(): Promise<void> {
  const slot = document.querySelector<HTMLElement>('.ad-slot');
  const client = slot?.dataset.adClient;
  if (!slot || !client) return;
  await idle();
  try {
    // The AdSense tag also loads the Privacy & messaging CMP when it is enabled for the site.
    await script(
      `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(client)}`,
    );
    await consentSettled();
    (window.adsbygoogle = window.adsbygoogle || []).push({});
  } catch {
    // Blocked by an ad blocker or offline: leave the reserved space empty.
  }
}
