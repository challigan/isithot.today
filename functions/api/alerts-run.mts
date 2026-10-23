import type { Config, Context } from '@netlify/functions';
import { alertsRun } from '../lib/server.mjs';

/**
 * The snow notifications' run, every 15 minutes. Until the full job lands it only logs one line
 * ("alerts-run: disabled"), which shows the schedule works; on a deploy preview with ALERTS_SMOKE=1,
 * "Run now" also checks that a function can reach Apple's push service (packages/server apns.ts).
 */
export default async (_request: Request, context: Context): Promise<void> => {
  console.log(
    await alertsRun({
      env: (name) => Netlify.env.get(name),
      deployContext: context.deploy?.context,
      now: Date.now(),
    }),
  );
};

// Must be a literal: Netlify reads it statically. UTC, every 15 minutes.
export const config: Config = {
  schedule: '*/15 * * * *',
};
