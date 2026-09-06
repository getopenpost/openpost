export function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;

  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function withAlpha(color: string, alpha: number): string {
  const match = /^#([\da-f]{2})([\da-f]{2})([\da-f]{2})(?:[\da-f]{2})?$/i.exec(color);
  if (!match) return color;
  const [, red, green, blue] = match;
  const channel = Math.max(0, Math.min(1, alpha));
  return `rgba(${Number.parseInt(red, 16)}, ${Number.parseInt(green, 16)}, ${Number.parseInt(
    blue,
    16,
  )}, ${channel})`;
}
