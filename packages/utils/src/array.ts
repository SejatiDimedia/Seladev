export function groupBy<T, K extends keyof any>(list: T[], getKey: (item: T) => K): Record<K, T[]> {
  return list.reduce((previous, current) => {
    const group = getKey(current);
    if (!previous[group]) {
      previous[group] = [];
    }
    previous[group]!.push(current);
    return previous;
  }, {} as Record<K, T[]>);
}

export function uniqueBy<T>(list: T[], getKey: (item: T) => unknown): T[] {
  const seen = new Set();
  return list.filter((item) => {
    const key = getKey(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function sortBy<T>(list: T[], getValue: (item: T) => number | string, order: 'asc' | 'desc' = 'asc'): T[] {
  return [...list].sort((a, b) => {
    const valA = getValue(a);
    const valB = getValue(b);
    if (valA < valB) return order === 'asc' ? -1 : 1;
    if (valA > valB) return order === 'asc' ? 1 : -1;
    return 0;
  });
}
