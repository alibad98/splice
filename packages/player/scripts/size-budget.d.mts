export const KB: number;
export const BUDGETS: { id: string; label: string; cap: number; level: 'fail' | 'warn' }[];
export function evaluate(sizes: Record<string, number>): {
  id: string;
  label: string;
  size: number;
  cap: number;
  level: string;
  status: 'ok' | 'warn' | 'fail';
}[];
