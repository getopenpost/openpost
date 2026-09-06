import type { SelectionPoint } from './selection';

export interface MagicPixelScanInput {
	width: number;
	height: number;
	data: Uint8ClampedArray;
	point: SelectionPoint;
	tolerance: number;
	contiguous: boolean;
}

export interface MagicPixelScanOptions {
	shouldCancel?: () => boolean;
	onProgress?: (fraction: number) => void;
	yieldEvery?: number;
}

export async function scanMagicPixels(
	input: MagicPixelScanInput,
	options: MagicPixelScanOptions = {}
): Promise<Uint8Array> {
	const { width, height, data } = input;
	const total = width * height;
	const mask = new Uint8Array(total);
	if (total === 0 || data.length < total * 4) return mask;
	const startX = clamp(Math.floor(input.point.x), 0, width - 1);
	const startY = clamp(Math.floor(input.point.y), 0, height - 1);
	const startIndex = startY * width + startX;
	const sampleOffset = startIndex * 4;
	const sample = [
		data[sampleOffset] ?? 0,
		data[sampleOffset + 1] ?? 0,
		data[sampleOffset + 2] ?? 0,
		data[sampleOffset + 3] ?? 0
	];
	const tolerance = clamp(input.tolerance, 0, 255);
	const yieldEvery = Math.max(4_096, options.yieldEvery ?? 65_536);
	const checkpoint = async (completed: number): Promise<void> => {
		if (options.shouldCancel?.()) throw new DOMException('Pixel scan cancelled.', 'AbortError');
		options.onProgress?.(Math.max(0, Math.min(1, completed / Math.max(1, total))));
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
	};
	const matches = (index: number): boolean => {
		const offset = index * 4;
		return (
			Math.max(
				Math.abs((data[offset] ?? 0) - sample[0]),
				Math.abs((data[offset + 1] ?? 0) - sample[1]),
				Math.abs((data[offset + 2] ?? 0) - sample[2]),
				Math.abs((data[offset + 3] ?? 0) - sample[3])
			) <= tolerance
		);
	};

	if (!input.contiguous) {
		for (let index = 0; index < total; index++) {
			if (matches(index)) mask[index] = 1;
			if (index > 0 && index % yieldEvery === 0) await checkpoint(index);
		}
		options.onProgress?.(1);
		return mask;
	}

	const visited = new Uint8Array(total);
	const queue = new Uint32Array(total);
	let head = 0;
	let tail = 0;
	queue[tail++] = startIndex;
	visited[startIndex] = 1;
	let processed = 0;
	while (head < tail) {
		const index = queue[head++];
		processed++;
		if (matches(index)) {
			mask[index] = 1;
			const x = index % width;
			const y = Math.floor(index / width);
			if (x > 0 && !visited[index - 1]) {
				visited[index - 1] = 1;
				queue[tail++] = index - 1;
			}
			if (x + 1 < width && !visited[index + 1]) {
				visited[index + 1] = 1;
				queue[tail++] = index + 1;
			}
			if (y > 0 && !visited[index - width]) {
				visited[index - width] = 1;
				queue[tail++] = index - width;
			}
			if (y + 1 < height && !visited[index + width]) {
				visited[index + width] = 1;
				queue[tail++] = index + width;
			}
		}
		if (processed % yieldEvery === 0) await checkpoint(Math.min(total, head));
	}
	options.onProgress?.(1);
	return mask;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.max(minimum, Math.min(maximum, value));
}
