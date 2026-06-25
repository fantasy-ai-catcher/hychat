export type ReorderDirection = 'up' | 'down';

// Return a new array with the item at `index` moved one step up or down.
// Moving past either end is a no-op. Does not mutate the input.
export function moveItem<T>(list: T[], index: number, direction: ReorderDirection): T[] {
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= list.length) {
    return list.slice();
  }
  const next = list.slice();
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}
