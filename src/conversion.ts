export type Side = 'left' | 'right';

export function isValidAmount(value: string): boolean {
  return /^\d*(\.\d*)?$/.test(value) && (value === '' || value === '.' || Number.isFinite(Number(value)));
}

export function convertAmount(value: string, rate: number, side: Side): string {
  if (value === '') return '';
  const amount = value === '.' ? 0 : Number(value);
  const result = side === 'left' ? amount * rate : amount / rate;
  if (!Number.isFinite(result)) return '';
  return Number(result.toFixed(8)).toString();
}

export function getRate(rates: Record<string, number>, from: string, to: string): number | undefined {
  if (from === to) return 1;
  const rate = rates[to] / rates[from];
  return Number.isFinite(rate) && rate > 0 ? rate : undefined;
}
