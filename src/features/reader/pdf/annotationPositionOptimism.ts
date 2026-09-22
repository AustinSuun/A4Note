import type { JsonValue, PositionJson } from '../../../core/types';

export type OptimisticAnnotationPosition = Readonly<{
  revision: number;
  positionJson: PositionJson;
}>;

function jsonValueEqual(left: JsonValue, right: JsonValue): boolean {
  if (Object.is(left, right)) return true;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left)
      && Array.isArray(right)
      && left.length === right.length
      && left.every((value, index) => jsonValueEqual(value, right[index]));
  }
  if (left === null || right === null || typeof left !== 'object' || typeof right !== 'object') return false;
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && jsonValueEqual(left[key], right[key]));
}

export function annotationPositionsEqual(left: PositionJson, right: PositionJson): boolean {
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  return leftKeys.length === rightKeys.length
    && leftKeys.every((key) => Object.prototype.hasOwnProperty.call(right, key)
      && jsonValueEqual(left[key], right[key]));
}

export function createOptimisticAnnotationPosition(
  revision: number,
  positionJson: PositionJson,
): OptimisticAnnotationPosition {
  return { revision, positionJson };
}

/** A native/parent publication only settles the optimistic revision whose exact geometry it contains. */
export function reconcileOptimisticAnnotationPosition(
  optimistic: OptimisticAnnotationPosition | undefined,
  committed: PositionJson,
): OptimisticAnnotationPosition | undefined {
  return optimistic && annotationPositionsEqual(optimistic.positionJson, committed) ? undefined : optimistic;
}

/** Dismissing an older failed write must not discard a newer drag of the same annotation. */
export function discardOptimisticAnnotationPosition(
  optimistic: OptimisticAnnotationPosition | undefined,
  revision: number,
): OptimisticAnnotationPosition | undefined {
  return optimistic?.revision === revision ? undefined : optimistic;
}
