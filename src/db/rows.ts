export type Row = Record<string, unknown>;

export function text(value: unknown): string | undefined {
  return value === null || value === undefined ? undefined : String(value);
}

export function flag(value: unknown): boolean {
  return value === 1 || value === true;
}

export function orNull<T>(value: T | undefined): T | null {
  return value === undefined ? null : value;
}
