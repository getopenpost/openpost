/**
 * Power-window canvas outline: sample the window boundary (and the feather
 * edge) in shader UV space so the on-canvas gizmo draws what the
 * `powerWindowFragment` shader masks. Boundary math mirrors
 * `powerWindowMask` in effects/gpu/shaders/color.ts: the local offset from
 * the center is aspect-scaled on X, rotated by the window rotation, and
 * normalized by half size; the boundary sits at distance 1 and the feather
 * edge at distance (1 - feather).
 */
import type { SpatialPoint } from './spatial-effect-coordinates';
import { readNumber, type GpuParamValues } from '../effects/gpu/types';

export interface PowerWindowOutlineParams {
	centerX: number;
	centerY: number;
	sizeX: number;
	sizeY: number;
	rotation: number;
	feather: number;
	shape: string;
}

export interface PowerWindowOutline {
	outer: SpatialPoint[];
	inner: SpatialPoint[] | null;
}

const ELLIPSE_SEGMENTS = 48;
const RECT_EDGE_SEGMENTS = 12;

function normalizeParams(params: GpuParamValues): Required<PowerWindowOutlineParams> {
	return {
		centerX: readNumber(params, 'centerX', 0.5),
		centerY: readNumber(params, 'centerY', 0.5),
		sizeX: Math.max(0.02, readNumber(params, 'sizeX', 0.5)),
		sizeY: Math.max(0.02, readNumber(params, 'sizeY', 0.5)),
		rotation: readNumber(params, 'rotation', 0),
		feather: Math.min(1, Math.max(0, readNumber(params, 'feather', 0.3))),
		shape: params.shape === 'rectangle' ? 'rectangle' : 'ellipse'
	};
}

function normalizedBoundary(shape: string): SpatialPoint[] {
	if (shape === 'rectangle') {
		const points: SpatialPoint[] = [];
		const corners = [
			{ x: -1, y: -1 },
			{ x: 1, y: -1 },
			{ x: 1, y: 1 },
			{ x: -1, y: 1 }
		];
		for (let edge = 0; edge < 4; edge += 1) {
			const from = corners[edge]!;
			const to = corners[(edge + 1) % 4]!;
			for (let step = 0; step < RECT_EDGE_SEGMENTS; step += 1) {
				const t = step / RECT_EDGE_SEGMENTS;
				points.push({
					x: from.x + (to.x - from.x) * t,
					y: from.y + (to.y - from.y) * t
				});
			}
		}
		return points;
	}
	const points: SpatialPoint[] = [];
	for (let index = 0; index < ELLIPSE_SEGMENTS; index += 1) {
		const angle = (index / ELLIPSE_SEGMENTS) * Math.PI * 2;
		points.push({ x: Math.cos(angle), y: Math.sin(angle) });
	}
	return points;
}

/**
 * Map one normalized boundary point at the given distance scale into
 * shader UV space. `aspect` is the render width/height ratio (uWidth/uHeight).
 */
function toUv(
	point: SpatialPoint,
	scale: number,
	centerX: number,
	centerY: number,
	halfX: number,
	halfY: number,
	rotationDeg: number,
	aspect: number
): SpatialPoint {
	const radians = (rotationDeg * Math.PI) / 180;
	const cos = Math.cos(radians);
	const sin = Math.sin(radians);
	// Inverse of the shader's rotateWindowPoint (which rotates by -rotation).
	const scaled = { x: point.x * halfX * scale, y: point.y * halfY * scale };
	return {
		x: centerX + (scaled.x * cos - scaled.y * sin) / aspect,
		y: centerY + (scaled.x * sin + scaled.y * cos)
	};
}

export function powerWindowBoundaryPoints(
	params: GpuParamValues,
	aspect: number
): PowerWindowOutline {
	const { centerX, centerY, sizeX, sizeY, rotation, feather, shape } = normalizeParams(params);
	const safeAspect = aspect > 0 && Number.isFinite(aspect) ? aspect : 1;
	const halfX = (sizeX * safeAspect) / 2;
	const halfY = sizeY / 2;
	const boundary = normalizedBoundary(shape);
	const outer = boundary.map((point) =>
		toUv(point, 1, centerX, centerY, halfX, halfY, rotation, safeAspect)
	);
	const inner =
		feather < 0.01
			? null
			: boundary.map((point) =>
					toUv(point, 1 - feather, centerX, centerY, halfX, halfY, rotation, safeAspect)
				);
	return { outer, inner };
}
