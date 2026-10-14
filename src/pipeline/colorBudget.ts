import type { BackgroundMask, ColorBudgetLevel, ColorBudgetResult, Palette } from '@/types';
import { rgbToLab, type Lab } from './colorSimplifier';

/**
 * 每档允许的最大颜色数。用户心智是「我要几个颜色」，所以主项直接给数字，
 * 而不是按格子数放大 —— 后者在大图上会让 K 远超实际色数，等于完全不压缩。
 */
const LEVEL_TARGET_COLOR_COUNT: Readonly<Record<Exclude<ColorBudgetLevel, 'off'>, number>> = {
  relaxed: 12,
  standard: 20,
  tight: 32,
};

/**
 * 小图安全下限：每种颜色至少要摊到这么多格子才允许独占一个色号，
 * 避免在只有几十颗的图案上把颜色砍得面目全非。
 */
const MIN_CELLS_PER_COLOR = 40;

/** K 的绝对下限。 */
const MIN_COLOR_COUNT = 4;

/** 簇内允许的最大感知色差；超过时宁可多留一种颜色也不牺牲保真度。 */
export const MAX_CLUSTER_DELTA_E = 12;

const MAX_ITERATIONS = 12;
/** 比较容差：Lab 距离为浮点数，并列判定需留一点余量。 */
const EPSILON = 1e-9;

interface ActiveColor {
  readonly paletteIndex: number;
  readonly count: number;
  readonly lab: Lab;
}

interface ActiveColorSet {
  readonly active: ActiveColor[];
  readonly visibleCellCount: number;
}

function validateInput(indices: Uint8Array, palette: Palette, mask: Uint8Array): void {
  if (mask.length !== indices.length) {
    throw new Error('Mask length must match indices length');
  }
  for (const paletteIndex of indices) {
    if (paletteIndex >= palette.length) {
      throw new Error(`Palette index ${paletteIndex} is out of range`);
    }
  }
}

function distance(a: Lab, b: Lab): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * 颜色预算上限 K = min(档位上限, 每色至少摊到 40 格换算出的数量)。
 * 档位决定大图的上限，小图则由 MIN_CELLS_PER_COLOR 兜底。
 */
export function resolveColorBudget(visibleCellCount: number, level: ColorBudgetLevel): number {
  if (level === 'off') return 0;
  if (visibleCellCount <= 0) return 0;
  const bySize = Math.max(
    MIN_COLOR_COUNT,
    Math.round(visibleCellCount / MIN_CELLS_PER_COLOR)
  );
  return Math.min(LEVEL_TARGET_COLOR_COUNT[level], bySize);
}

function collectActiveColors(
  indices: Uint8Array,
  palette: Palette,
  mask: Uint8Array
): ActiveColorSet {
  const counts = new Array<number>(palette.length).fill(0);
  let visibleCellCount = 0;
  for (let position = 0; position < indices.length; position += 1) {
    if (mask[position] !== 0) continue;
    counts[indices[position]] += 1;
    visibleCellCount += 1;
  }

  const active: ActiveColor[] = [];
  for (let paletteIndex = 0; paletteIndex < palette.length; paletteIndex += 1) {
    if (counts[paletteIndex] === 0) continue;
    active.push({
      paletteIndex,
      count: counts[paletteIndex],
      lab: rgbToLab(palette[paletteIndex].rgb),
    });
  }
  return { active, visibleCellCount };
}

/** 用量降序；用量并列取色板索引较小者，保证结果可复现。 */
function sortByCountDesc(active: readonly ActiveColor[]): ActiveColor[] {
  return [...active].sort((a, b) => b.count - a.count || a.paletteIndex - b.paletteIndex);
}

/** 距离最近的 medoid 下标；距离并列取色板索引较小者。 */
function nearestMedoidSlot(member: ActiveColor, medoids: readonly ActiveColor[]): number {
  let bestSlot = 0;
  let bestDeltaE = Number.POSITIVE_INFINITY;
  for (let slot = 0; slot < medoids.length; slot += 1) {
    const deltaE = distance(member.lab, medoids[slot].lab);
    const isCloser = deltaE < bestDeltaE - EPSILON;
    const isTieWithSmallerIndex =
      deltaE < bestDeltaE + EPSILON &&
      medoids[slot].paletteIndex < medoids[bestSlot].paletteIndex;
    if (isCloser || isTieWithSmallerIndex) {
      bestDeltaE = Math.min(bestDeltaE, deltaE);
      bestSlot = slot;
    }
  }
  return bestSlot;
}

/** 簇内加权 medoid：使 Σ 用量 × ΔE 最小的成员。 */
function weightedMedoid(cluster: readonly ActiveColor[]): ActiveColor {
  let best = cluster[0];
  let bestCost = Number.POSITIVE_INFINITY;
  for (const candidate of cluster) {
    let cost = 0;
    for (const member of cluster) {
      cost += member.count * distance(member.lab, candidate.lab);
    }
    if (cost < bestCost - EPSILON) {
      bestCost = cost;
      best = candidate;
    }
  }
  return best;
}

/** 每个活跃色号归入最近的 medoid（medoid 自身距离为 0，自然归到自己）。 */
function assignClusters(
  active: readonly ActiveColor[],
  medoids: readonly ActiveColor[]
): ActiveColor[][] {
  const clusters: ActiveColor[][] = medoids.map(() => []);
  for (const member of active) {
    clusters[nearestMedoidSlot(member, medoids)].push(member);
  }
  return clusters;
}

function sameMedoidSet(a: readonly ActiveColor[], b: readonly ActiveColor[]): boolean {
  if (a.length !== b.length) return false;
  const keyOf = (list: readonly ActiveColor[]) =>
    list
      .map(member => member.paletteIndex)
      .sort((x, y) => x - y)
      .join(',');
  return keyOf(a) === keyOf(b);
}

/** 迭代「分配 + 加权 medoid 更新」，直到 medoid 集合不再变化。 */
function refineMedoids(active: readonly ActiveColor[], initial: readonly ActiveColor[]): ActiveColor[] {
  let medoids = [...initial];
  for (let round = 0; round < MAX_ITERATIONS; round += 1) {
    const next: ActiveColor[] = [];
    for (const cluster of assignClusters(active, medoids)) {
      if (cluster.length > 0) next.push(weightedMedoid(cluster));
    }
    const refreshed = sortByCountDesc(next);
    if (sameMedoidSet(refreshed, medoids)) return medoids;
    medoids = refreshed;
  }
  return medoids;
}

/**
 * 把违反 Delta E 上限的簇中最远的成员提升为独立 medoid，直到全部满足。
 * 因此最终颜色数可能多于目标 K —— 这是「保真优先于色数」的刻意取舍。
 */
function enforceFidelityCap(
  active: readonly ActiveColor[],
  medoids: readonly ActiveColor[]
): ActiveColor[] {
  let current = [...medoids];
  for (;;) {
    const clusters = assignClusters(active, current);
    let violatedSlot = -1;
    let farthestMember: ActiveColor | null = null;
    let farthestDeltaE = MAX_CLUSTER_DELTA_E;

    for (let slot = 0; slot < clusters.length; slot += 1) {
      const cluster = clusters[slot];
      if (cluster.length <= 1) continue;
      const medoid = current[slot];
      for (const member of cluster) {
        const deltaE = distance(member.lab, medoid.lab);
        if (deltaE > farthestDeltaE + EPSILON) {
          farthestDeltaE = deltaE;
          farthestMember = member;
          violatedSlot = slot;
        }
      }
    }

    if (violatedSlot < 0 || farthestMember === null) return current;
    current = [...current, farthestMember];
    if (current.length >= active.length) return current;
  }
}

/**
 * 按颜色预算压缩可见颜色总数。
 * 代表色（medoid）只从原图实际使用的色号中选取，不引入未使用的新色号。
 */
export function applyColorBudget(
  indices: Uint8Array,
  palette: Palette,
  mask: BackgroundMask,
  level: ColorBudgetLevel
): ColorBudgetResult {
  validateInput(indices, palette, mask);

  const { active, visibleCellCount } = collectActiveColors(indices, palette, mask);
  const targetColorCount = resolveColorBudget(visibleCellCount, level);

  if (level === 'off' || active.length <= 1 || active.length <= targetColorCount) {
    return {
      indices,
      targetColorCount,
      colorCount: active.length,
      fidelityLimited: false,
    };
  }

  const initialMedoids = sortByCountDesc(active).slice(0, targetColorCount);
  const medoids = enforceFidelityCap(active, refineMedoids(active, initialMedoids));

  const mapping = new Map<number, number>();
  for (const member of active) {
    const medoid = medoids[nearestMedoidSlot(member, medoids)];
    if (medoid.paletteIndex !== member.paletteIndex) {
      mapping.set(member.paletteIndex, medoid.paletteIndex);
    }
  }

  const compressed = indices.slice();
  for (let position = 0; position < compressed.length; position += 1) {
    if (mask[position] !== 0) continue;
    const target = mapping.get(compressed[position]);
    if (target !== undefined) compressed[position] = target;
  }

  const remaining = new Set<number>();
  for (let position = 0; position < compressed.length; position += 1) {
    if (mask[position] === 0) remaining.add(compressed[position]);
  }

  return {
    indices: compressed,
    targetColorCount,
    colorCount: remaining.size,
    fidelityLimited: remaining.size > targetColorCount,
  };
}