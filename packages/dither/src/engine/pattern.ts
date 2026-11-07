import { ditherMask, ditherPath } from "./mask.js";
import { getThresholdMap } from "./matrices.js";
import type { DitherMatrix } from "./matrices.js";
import { ditherRamp, fillTile } from "./style.js";
import type { FillEdge, FillVariant, StyleMap } from "./style.js";

/**
 * Static dithers without a canvas: SVG pattern geometry for chart fills and
 * a CSS mask for any element. Both are pure. `level` is the share of cells
 * inked, from 0 (none) to 1 (all).
 */

export interface DitherMaskStyleOptions {
  /** Threshold matrix. Default `"bayer4"`. */
  matrix?: DitherMatrix;
  /** Cell size: CSS pixels, or any CSS length. Default `var(--dither-cell)`. */
  cell?: number | string;
}

/**
 * Inline styles that mask an element to one dither level, tiled at the
 * cell size. Pair with a background colour.
 */
export const ditherMaskStyle = (
  level: number,
  { matrix = "bayer4", cell = "var(--dither-cell, 2px)" }: DitherMaskStyleOptions = {},
): StyleMap => {
  const { size } = getThresholdMap(matrix);
  const image = ditherMask(level, { matrix });
  const tile = typeof cell === "number" ? `${size * cell}px` : `calc(${cell} * ${size})`;
  return {
    "-webkit-mask-image": image,
    "-webkit-mask-repeat": "repeat",
    "-webkit-mask-size": tile,
    "mask-image": image,
    "mask-repeat": "repeat",
    "mask-size": tile,
  };
};

/** Where a gradient fill's dense edge sits, in SVG user units. */
export interface FillRamp {
  /** The dense side. */
  edge: FillEdge;
  /** Coordinate of that side: y for `top`/`bottom`, x for `left`/`right`. */
  at: number;
  /** How far the fade runs from the edge. */
  length: number;
  /** How far the fill reaches past the edge in total. Default `length`. Past the fade it holds `floor`. */
  extent?: number;
}

export interface FillPatternOptions {
  /** The texture. */
  fill: FillVariant;
  /** Cell size in SVG user units. Default 2. */
  cell?: number;
  /** Gradient only: coverage at the dense edge, 0 to 1. Default 1. */
  level?: number;
  /** Gradient only: coverage at the far end of the fade. Default 0.0625. */
  floor?: number;
  /** Gradient only: threshold matrix. Default `bayer4`. */
  matrix?: DitherMatrix;
  /** Gradient only: where the dense edge sits. Without it, a gradient fills one even `level`. */
  ramp?: FillRamp;
}

/**
 * The geometry of one SVG `<pattern>`: its tile box in user units and the
 * inked cells as a path in cell units, drawn with `transform="scale(cell)"`.
 * `solid` is a single full cell.
 */
export interface FillPatternSpec {
  x: number;
  y: number;
  width: number;
  height: number;
  cell: number;
  path: string;
}

/** Pattern geometry for any fill variant, shared by every SVG adapter. */
export const fillPatternSpec = ({
  fill,
  cell = 2,
  level = 1,
  floor = 0.0625,
  matrix = "bayer4",
  ramp,
}: FillPatternOptions): FillPatternSpec => {
  if (fill === "solid") {
    return { cell, height: cell, path: "M0 0h1v1h-1z", width: cell, x: 0, y: 0 };
  }
  if (fill === "dotted" || fill === "hatched") {
    const { size, path } = fillTile(fill);
    return { cell, height: size * cell, path, width: size * cell, x: 0, y: 0 };
  }
  if (ramp === undefined) {
    const { size } = getThresholdMap(matrix);
    return {
      cell,
      height: size * cell,
      path: ditherPath(level, matrix),
      width: size * cell,
      x: 0,
      y: 0,
    };
  }
  const tile = ditherRamp({
    edge: ramp.edge,
    extent: (ramp.extent ?? ramp.length) / cell,
    from: level,
    length: ramp.length / cell,
    matrix,
    to: floor,
  });
  const width = tile.width * cell;
  const height = tile.height * cell;
  const origin = {
    bottom: { x: 0, y: ramp.at - height },
    left: { x: ramp.at, y: 0 },
    right: { x: ramp.at - width, y: 0 },
    top: { x: 0, y: ramp.at },
  }[ramp.edge];
  return { cell, height, path: tile.path, width, ...origin };
};
