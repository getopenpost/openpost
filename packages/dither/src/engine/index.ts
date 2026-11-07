/**
 * The dither engine, ported from dithercn (MIT, see ../../NOTICE.md):
 * threshold matrices with blue noise, theme colours, fill ramps, SVG
 * pattern geometry, image dithering, a visibility-aware frame loop and a
 * WebGL field shader. Framework-free; UI packages wrap it.
 */
export {
  BAYER_2,
  BAYER_4,
  BAYER_8,
  BLUE_NOISE_64,
  DITHER_MATRICES,
  getThresholdMap,
  isInked,
  thresholdAt,
} from "./matrices.js";
export type { DitherMatrix, ThresholdMap } from "./matrices.js";
export { cssColor, DEFAULT_PALETTE, DITHER_COLOR_NAMES, DITHER_COLORS, MOTION } from "./tokens.js";
export type { DitherColor, DitherColorName, DitherPalette, Rgba } from "./tokens.js";
export { readDitherCell, resolveColor, subscribeToTheme, watchDitherColors } from "./color.js";
export { createFrameLoop, prefersReducedMotion, watchReducedMotion } from "./motion.js";
export type { FrameLoop, FrameLoopCallback, FrameLoopOptions, FrameLoopState } from "./motion.js";
export {
  BLOOM_LEVELS,
  BLOOMS,
  bloomFilter,
  bloomLayerStyle,
  bloomStyle,
  ditherRamp,
  FILL_VARIANTS,
  fillStyle,
  fillTile,
  SERIES_COLORS,
  seriesColor,
  styleString,
} from "./style.js";
export type {
  Bloom,
  FillEdge,
  FillStyleOptions,
  FillTile,
  FillVariant,
  RampOptions,
  RampTile,
  StyleMap,
} from "./style.js";
export { ditherMask, ditherPath } from "./mask.js";
export type { DitherMaskOptions } from "./mask.js";
export { ditherMaskStyle, fillPatternSpec } from "./pattern.js";
export type {
  DitherMaskStyleOptions,
  FillPatternOptions,
  FillPatternSpec,
  FillRamp,
} from "./pattern.js";
export { MAX_LIVE_CONTEXTS, mountDitherShader } from "./shader.js";
export type {
  DitherShaderOptions,
  DitherShaderState,
  DitherUniforms,
  MountedDitherShader,
  ShaderUniformValue,
} from "./shader.js";
export { DITHER_METHODS, ditherImage } from "./diffuse.js";
export type {
  DiffuseOptions,
  DiffusionMethod,
  DitherMethod,
  ImagePalette,
  OrderedMethod,
  PaletteColor,
  PixelBuffer,
} from "./diffuse.js";
