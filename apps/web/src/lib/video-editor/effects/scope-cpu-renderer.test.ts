import { expect, it } from 'vitest';
import { drawCpuScope } from './scope-cpu-renderer';

it('centers CPU parade channel labels away from the luma guide labels', () => {
	const labels: Array<{ text: string; x: number; y: number }> = [];
	let translateX = 0;
	const translateStack: number[] = [];
	const context = {
		beginPath() {},
		fillRect() {},
		fillText(text: string, x: number, y: number) {
			labels.push({ text, x: translateX + x, y });
		},
		lineTo() {},
		moveTo() {},
		restore() {
			translateX = translateStack.pop() ?? 0;
		},
		save() {
			translateStack.push(translateX);
		},
		stroke() {},
		translate(x: number) {
			translateX += x;
		}
	} as unknown as CanvasRenderingContext2D;
	const image = {
		data: new Uint8ClampedArray([32, 64, 96, 255]),
		width: 1,
		height: 1
	} as ImageData;

	drawCpuScope(context, image, 'parade', 360, 120);

	expect(labels.filter(({ text }) => ['R', 'G', 'B'].includes(text))).toEqual([
		{ text: 'R', x: 60, y: 12 },
		{ text: 'G', x: 180, y: 12 },
		{ text: 'B', x: 300, y: 12 }
	]);
});
