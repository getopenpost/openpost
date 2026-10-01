// Adapted from Dither Kit (MIT). See ../NOTICE.md for source and license.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
export const DITHER_CELL_SIZE = 2;
export const DITHER_BUTTON_OPACITY = 0.16;
export const DITHER_BUTTON_MIN_CONTRAST = 1.18;
export const DITHER_BUTTON_MAX_CONTRAST = 1.8;
const PERIOD = 4;

export type DitherDirection = "up" | "down" | "left" | "right";
export function ditherThreshold(x: number, y: number): number {
  return (BAYER[(y & 3) * PERIOD + (x & 3)]! + 0.5) / 16;
}

export interface GradientOptions {
  length?: number;
  direction?: DitherDirection;
  intensity?: number;
  kind?: "button" | "surface";
}

/** One native-resolution Bayer strip. Repeating across the gradient keeps every cell square. */
export function gradientSvg({
  length = 64,
  direction = "down",
  intensity = 0,
  kind = "surface",
  ink = "white",
}: GradientOptions & { ink?: string } = {}): string {
  const horizontal = direction === "left" || direction === "right";
  const reverse = direction === "up" || direction === "left";
  const rows = Math.max(1, Math.ceil(length / DITHER_CELL_SIZE));
  const pixels: string[] = [];
  for (let row = 0; row < rows; row++) {
    const fraction = (row + 0.5) / rows;
    const position = reverse ? 1 - fraction : fraction;
    const density = kind === "button" ? 0.1 + 0.65 * position : position;
    for (let column = 0; column < PERIOD; column++) {
      const x = horizontal ? row : column;
      const y = horizontal ? column : row;
      const lit = density > ditherThreshold(x, y) - 0.1 * intensity;
      const strength = (0.3 + density * 0.7) * (1 + 0.22 * intensity);
      // Buttons keep two fixed colors; interaction changes coverage, not contrast.
      const alpha = kind === "button" ? (lit ? 1 : 0) : Math.min(1, strength * (lit ? 1 : 0.4));
      pixels.push(
        `<rect x="${x * DITHER_CELL_SIZE}" y="${y * DITHER_CELL_SIZE}" width="2" height="2" fill-opacity="${alpha.toFixed(3)}"/>`,
      );
    }
  }
  const width = horizontal ? rows * DITHER_CELL_SIZE : PERIOD * DITHER_CELL_SIZE;
  const height = horizontal ? PERIOD * DITHER_CELL_SIZE : rows * DITHER_CELL_SIZE;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="${ink.replace(/[&<>\"']/g, (character) => `&#${character.charCodeAt(0)};`)}">${pixels.join("")}</g></svg>`;
}

export function gradientMask(options: GradientOptions = {}): string {
  return `url("data:image/svg+xml,${encodeURIComponent(gradientSvg(options))}")`;
}

export const DITHER_GRADIENT_MASK = gradientMask();
