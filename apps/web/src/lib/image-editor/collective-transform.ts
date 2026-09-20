import type { ImageEditorLayer } from './types';

type ImageEditorTransform = ImageEditorLayer['transform'];
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

export function imageEditorCollectiveTransform(
	transforms: readonly ImageEditorTransform[]
): ImageEditorTransform | null {
	const reference = transforms[0];
	if (!reference) return null;
	const x = Math.min(...transforms.map((transform) => transform.x));
	const y = Math.min(...transforms.map((transform) => transform.y));
	const right = Math.max(...transforms.map((transform) => transform.x + transform.width));
	const bottom = Math.max(...transforms.map((transform) => transform.y + transform.height));
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
		return { ...transform, [key]: transform[key] + delta };
	}

	if (key === 'width' || key === 'height') {
		const targetSize = Math.max(1, Number(value));
		const scale = targetSize / Math.max(1, selection[key]);
		const scaleX = key === 'width' || preserveAspect ? scale : 1;
		const scaleY = key === 'height' || preserveAspect ? scale : 1;
		const centerX = transform.x + transform.width / 2;
		const centerY = transform.y + transform.height / 2;
		const width = Math.max(1, transform.width * scaleX);
		const height = Math.max(1, transform.height * scaleY);
		const nextCenterX = selection.x + (centerX - selection.x) * scaleX;
		const nextCenterY = selection.y + (centerY - selection.y) * scaleY;
		return {
			...transform,
			x: nextCenterX - width / 2,
			y: nextCenterY - height / 2,
			width,
			height
		};
	}

	const selectionCenterX = selection.x + selection.width / 2;
	const selectionCenterY = selection.y + selection.height / 2;
	const centerX = transform.x + transform.width / 2;
	const centerY = transform.y + transform.height / 2;

	if (key === 'rotation') {
		const rotationDelta = normalizeImageEditorRotation(Number(value) - selection.rotation);
		const radians = (rotationDelta * Math.PI) / 180;
		const relativeX = centerX - selectionCenterX;
		const relativeY = centerY - selectionCenterY;
		const nextCenterX =
			selectionCenterX + relativeX * Math.cos(radians) - relativeY * Math.sin(radians);
		const nextCenterY =
			selectionCenterY + relativeX * Math.sin(radians) + relativeY * Math.cos(radians);
		return {
			...transform,
			x: nextCenterX - transform.width / 2,
			y: nextCenterY - transform.height / 2,
			rotation: normalizeImageEditorRotation(transform.rotation + rotationDelta)
		};
	}

	if (Boolean(value) === selection[key]) return { ...transform };
	if (key === 'flip_x') {
		return {
			...transform,
			x: selectionCenterX * 2 - centerX - transform.width / 2,
			rotation: normalizeImageEditorRotation(-transform.rotation),
			flip_x: !transform.flip_x
		};
	}
	return {
		...transform,
		y: selectionCenterY * 2 - centerY - transform.height / 2,
		rotation: normalizeImageEditorRotation(-transform.rotation),
		flip_y: !transform.flip_y
	};
}
