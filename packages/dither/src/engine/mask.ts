import { getThresholdMap } from "./matrices.js";
import type { DitherMatrix } from "./matrices.js";

/** One matrix tile of a dither level as SVG geometry and a CSS mask. Shared by patterns and fill styles. */

const pathCache = new Map<string, string>();

/**
 * One SVG path covering the inked cells of one matrix tile, in cell units.
 * Runs of neighbouring cells in a row merge into one rectangle.
 */
export const ditherPath = (level: number, matrix: DitherMatrix = "bayer4") => {
  const key = `${matrix}:${level}`;
  const cached = pathCache.get(key);
  if (cached !== undefined) {
    return cached;
  }
  const { size, thresholds } = getThresholdMap(matrix);
  let path = "";
  for (let y = 0; y < size; y += 1) {
    let start = -1;
    for (let x = 0; x <= size; x += 1) {
      const inked = x < size && level > (thresholds[y * size + x] ?? 1);
      if (inked && start === -1) {
        start = x;
      } else if (!inked && start !== -1) {
        path += `M${start} ${y}h${x - start}v1h${start - x}z`;
        start = -1;
      }
    }
  }
  pathCache.set(key, path);
  return path;
};

export interface DitherMaskOptions {
  /** Threshold matrix. Default `"bayer4"`. */
  matrix?: DitherMatrix;
  /**
   * Cell size in CSS pixels. When set, the image has that intrinsic size
   * and tiles without a `mask-size`.
   */
  cell?: number;
}

/**
 * A CSS `mask-image` value: one matrix tile with the cells below `level`
 * filled. Paint the element with the ink colour and mask it.
 */
export const ditherMask = (level: number, { matrix = "bayer4", cell }: DitherMaskOptions = {}) => {
  const { size } = getThresholdMap(matrix);
  const dimensions = cell === undefined ? "" : ` width="${size * cell}" height="${size * cell}"`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"${dimensions} shape-rendering="crispEdges"><path d="${ditherPath(level, matrix)}"/></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
};
