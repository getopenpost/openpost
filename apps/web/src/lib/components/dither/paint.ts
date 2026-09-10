// Adapted from Dither Kit's pixel.ts, dither-paint.ts and gradient.tsx (MIT).
// Source revision and license: ./NOTICE.md.

const BAYER = [
	[0, 8, 2, 10],
	[12, 4, 14, 6],
	[3, 11, 1, 9],
	[15, 7, 13, 5]
];
const CELL = 2;
const COLUMNS = 4;
const ROWS = 32;
const OFF_TIER = 0.4;

/** One repeating strip, with the same alpha falloff as Dither Kit's chart fills. */
function gradientMask(): string {
	const pixels: string[] = [];
	for (let y = 0; y < ROWS; y++) {
		const density = y / (ROWS - 1);
		for (let x = 0; x < COLUMNS; x++) {
			const lit = density > (BAYER[y % 4][x % 4] + 0.5) / 16;
			const alpha = (0.3 + density * 0.7) * (lit ? 1 : OFF_TIER);
			pixels.push(
				`<rect x="${x * CELL}" y="${y * CELL}" width="${CELL}" height="${CELL}" fill-opacity="${alpha.toFixed(3)}"/>`
			);
		}
	}
	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${COLUMNS * CELL}" height="${ROWS * CELL}" viewBox="0 0 ${COLUMNS * CELL} ${ROWS * CELL}" preserveAspectRatio="none" shape-rendering="crispEdges"><g fill="white">${pixels.join('')}</g></svg>`;
	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

// A shared CSS image avoids a canvas and animation loop for every small control.
export const DITHER_GRADIENT_MASK = gradientMask();
