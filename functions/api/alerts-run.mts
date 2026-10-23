import type { Config, Context } from '@netlify/functions';
import { alertsRun } from '../lib/server.mjs';

/**
 * The snow notifications' run, every 15 minutes (packages/server alerts.ts). Off until
 * ALERTS_ENABLED is true, logging one line ("alerts-run: disabled (production, ALERTS_ENABLED
 * unset)"); a dry run everywhere but production, and in production until ALERTS_DRY_RUN is false.
 * On a deploy preview with ALERTS_SMOKE=1, "Run now" only checks that a function can reach Apple's
 * push service. Lines it logs as it goes (deletions, errors, a dry run's notifications) come
 * first, and its one summary line last.
 */
export default async (_request: Request, context: Context): Promise<void> => {
  console.log(
    await alertsRun({
      env: (name) => Netlify.env.get(name),
      deployContext: context.deploy?.context,
      now: Date.now(),
      log: (line) => console.log(line),
      // The forecast cache's writes finish after the run returns.
      waitUntil: (promise) => {
        if (typeof context.waitUntil === 'function') context.waitUntil(promise);
        else void promise.catch(() => {});
      },
    }),
  );
};

// Must be a literal: Netlify reads it statically. UTC, every 15 minutes.
export const config: Config = {
  schedule: '*/15 * * * *',
};
