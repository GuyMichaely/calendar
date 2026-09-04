export function toStorageValue<T>(value: T, seen = new WeakMap<object, unknown>()): T {
  if (value === null || typeof value !== "object") return value;

  const object = value as object;
  const existing = seen.get(object);
  if (existing) return existing as T;

  if (value instanceof Date) return new Date(value.getTime()) as T;
  if (typeof Blob !== "undefined" && value instanceof Blob) return value;

  if (Array.isArray(value)) {
    const copy: unknown[] = [];
    seen.set(object, copy);
    for (const item of value) copy.push(toStorageValue(item, seen));
    return copy as T;
  }

  if (value instanceof Map) {
    const copy = new Map();
    seen.set(object, copy);
    for (const [key, item] of value) copy.set(toStorageValue(key, seen), toStorageValue(item, seen));
    return copy as T;
  }

  if (value instanceof Set) {
    const copy = new Set();
    seen.set(object, copy);
    for (const item of value) copy.add(toStorageValue(item, seen));
    return copy as T;
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype === Object.prototype || prototype === null) {
    const copy: Record<string, unknown> = Object.create(prototype);
    seen.set(object, copy);
    for (const [key, item] of Object.entries(value)) copy[key] = toStorageValue(item, seen);
    return copy as T;
  }

  return value;
}
