/** Small numeric helpers shared by blending and climate code. */

export function mean(values: readonly number[]): number {
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/**
 * Trimmed mean: with `trimFrom` or more values drop the single highest and lowest,
 * otherwise a plain mean. Callers guarantee at least one value.
 */
export function trimmedMean(values: readonly number[], trimFrom: number): number {
  if (values.length >= trimFrom) {
    const sorted = [...values].sort((a, b) => a - b);
    return mean(sorted.slice(1, -1));
  }
  return mean(values);
}

export function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
