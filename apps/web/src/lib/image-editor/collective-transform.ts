import type { ImageEditorLayer } from './types';

type ImageEditorTransform = ImageEditorLayer['transform'];
type ImageEditorTransformMatrix = [number, number, number, number, number, number];
interface ImageEditorTransformPoint {
	x: number;
	y: number;
}
export type ImageEditorCollectiveTransformKey =
	| 'x'
	| 'y'
	| 'width'
	| 'height'
	| 'rotation'
	| 'flip_x'
	| 'flip_y';

export function normalizeImageEditorRotation(value: number): number {
	return ((((value + 180) % 360) + 360) % 360) - 180;
}

function multiplyMatrices(
	left: ImageEditorTransformMatrix,
	right: ImageEditorTransformMatrix
): ImageEditorTransformMatrix {
	return [
		left[0] * right[0] + left[2] * right[1],
		left[1] * right[0] + left[3] * right[1],
		left[0] * right[2] + left[2] * right[3],
		left[1] * right[2] + left[3] * right[3],
		left[0] * right[4] + left[2] * right[5] + left[4],
		left[1] * right[4] + left[3] * right[5] + left[5]
	];
}

function matrixAround(
	centerX: number,
	centerY: number,
	a: number,
	b: number,
	c: number,
	d: number
): ImageEditorTransformMatrix {
	return [a, b, c, d, centerX - a * centerX - c * centerY, centerY - b * centerX - d * centerY];
}

function transformMatrix(transform: ImageEditorTransform): ImageEditorTransformMatrix {
	const radians = (transform.rotation * Math.PI) / 180;
	const cosine = Math.cos(radians);
	const sine = Math.sin(radians);
	const halfWidth = transform.width / 2;
	const halfHeight = transform.height / 2;
	const centerX = transform.x + halfWidth * cosine - halfHeight * sine;
	const centerY = transform.y + halfWidth * sine + halfHeight * cosine;
	const scaleX = transform.flip_x ? -1 : 1;
	const scaleY = transform.flip_y ? -1 : 1;
	return [cosine * scaleX, sine * scaleX, -sine * scaleY, cosine * scaleY, centerX, centerY];
}

function transformPoint(
	matrix: ImageEditorTransformMatrix,
	x: number,
	y: number
): ImageEditorTransformPoint {
	return {
		x: matrix[0] * x + matrix[2] * y + matrix[4],
		y: matrix[1] * x + matrix[3] * y + matrix[5]
	};
}

function matrixTransform(
	transform: ImageEditorTransform,
	matrix: ImageEditorTransformMatrix
): ImageEditorTransform {
	const combined = multiplyMatrices(matrix, transformMatrix(transform));
	const scaleX = Math.hypot(combined[0], combined[1]);
	const scaleY =
		scaleX > Number.EPSILON ? (combined[0] * combined[3] - combined[2] * combined[1]) / scaleX : 0;
	const width = Math.max(1, transform.width * Math.abs(scaleX));
	const height = Math.max(1, transform.height * Math.abs(scaleY));
	return {
		...transform,
		x: combined[4] - width / 2,
		y: combined[5] - height / 2,
		width,
		height,
		rotation: (Math.atan2(combined[1], combined[0]) * 180) / Math.PI,
		flip_x: scaleX < 0,
		flip_y: scaleY < 0
	};
}

export function imageEditorCollectiveTransform(
	transforms: readonly ImageEditorTransform[]
): ImageEditorTransform | null {
	const reference = transforms[0];
	if (!reference) return null;
	const corners = transforms.flatMap((transform) => {
		const matrix = transformMatrix(transform);
		const halfWidth = transform.width / 2;
		const halfHeight = transform.height / 2;
		return [
			transformPoint(matrix, -halfWidth, -halfHeight),
			transformPoint(matrix, halfWidth, -halfHeight),
			transformPoint(matrix, halfWidth, halfHeight),
			transformPoint(matrix, -halfWidth, halfHeight)
		];
	});
	const x = Math.min(...corners.map((corner) => corner.x));
	const y = Math.min(...corners.map((corner) => corner.y));
	const right = Math.max(...corners.map((corner) => corner.x));
	const bottom = Math.max(...corners.map((corner) => corner.y));
	return {
		x,
		y,
		width: right - x,
		height: bottom - y,
		rotation: reference.rotation,
		flip_x: reference.flip_x,
		flip_y: reference.flip_y
	};
}

export function transformImageEditorCollectiveMember(
	transform: ImageEditorTransform,
	selection: ImageEditorTransform,
	key: ImageEditorCollectiveTransformKey,
	value: number | boolean,
	preserveAspect = false
): ImageEditorTransform {
	if (key === 'x' || key === 'y') {
		const delta = Number(value) - selection[key];
		return matrixTransform(
			transform,
			key === 'x' ? [1, 0, 0, 1, delta, 0] : [1, 0, 0, 1, 0, delta]
		);
	}

	if (key === 'width' || key === 'height') {
		const targetSize = Math.max(1, Number(value));
		const scale = targetSize / Math.max(1, selection[key]);
		const scaleX = key === 'width' || preserveAspect ? scale : 1;
		const scaleY = key === 'height' || preserveAspect ? scale : 1;
		return matrixTransform(transform, matrixAround(selection.x, selection.y, scaleX, 0, 0, scaleY));
	}

	const selectionCenterX = selection.x + selection.width / 2;
	const selectionCenterY = selection.y + selection.height / 2;

	if (key === 'rotation') {
		const rotationDelta = normalizeImageEditorRotation(Number(value) - selection.rotation);
		const radians = (rotationDelta * Math.PI) / 180;
		return matrixTransform(
			transform,
			matrixAround(
				selectionCenterX,
				selectionCenterY,
				Math.cos(radians),
				Math.sin(radians),
				-Math.sin(radians),
				Math.cos(radians)
			)
		);
	}

	if (Boolean(value) === selection[key]) return { ...transform };
	if (key === 'flip_x') {
		return matrixTransform(
			transform,
			matrixAround(selectionCenterX, selectionCenterY, -1, 0, 0, 1)
		);
	}
	return matrixTransform(transform, matrixAround(selectionCenterX, selectionCenterY, 1, 0, 0, -1));
}
