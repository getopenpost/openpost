import { describe, expect, it } from 'vitest';
import { transitionRegistry } from './registry';
import type { TransitionDefinition } from './types';
import './index';

const WIDTH = 40;
const HEIGHT = 30;
const PIXEL_THRESHOLD = 6;

function fixture(kind: 'outgoing' | 'incoming'): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext('2d');
	if (!context) throw new Error('Canvas2D is unavailable.');
	const gradient = context.createLinearGradient(0, 0, WIDTH, HEIGHT);
	if (kind === 'outgoing') {
		gradient.addColorStop(0, '#e63232');
		gradient.addColorStop(0.5, '#f4c430');
		gradient.addColorStop(1, '#6414a8');
	} else {
		gradient.addColorStop(0, '#16b8e0');
		gradient.addColorStop(0.5, '#20d060');
		gradient.addColorStop(1, '#102878');
	}
	context.fillStyle = gradient;
	context.fillRect(0, 0, WIDTH, HEIGHT);
	context.fillStyle = kind === 'outgoing' ? '#ffffff' : '#080808';
	context.fillRect(kind === 'outgoing' ? 3 : WIDTH - 14, 4, 11, 8);
	context.strokeStyle = kind === 'outgoing' ? '#101010' : '#ffffff';
	context.lineWidth = 2;
	context.beginPath();
	context.moveTo(0, kind === 'outgoing' ? HEIGHT - 3 : 3);
	context.lineTo(WIDTH, kind === 'outgoing' ? 3 : HEIGHT - 3);
	context.stroke();
	return canvas;
}

function defaultProperties(definition: TransitionDefinition): Record<string, unknown> {
	return Object.fromEntries(
		(definition.parameters ?? []).map((parameter) => [parameter.key, parameter.defaultValue])
	);
}

function render(
	definition: TransitionDefinition,
	progress: number,
	outgoing: HTMLCanvasElement,
	incoming: HTMLCanvasElement,
	direction = definition.directions?.[0]
): Uint8ClampedArray {
	const canvas = document.createElement('canvas');
	canvas.width = WIDTH;
	canvas.height = HEIGHT;
	const context = canvas.getContext('2d', { willReadFrequently: true });
	const renderer = transitionRegistry.getRenderer(definition.id)?.renderCanvas;
	if (!context || !renderer) throw new Error(`Canvas renderer unavailable for ${definition.id}.`);
	renderer(
		context as unknown as OffscreenCanvasRenderingContext2D,
		outgoing as unknown as OffscreenCanvas,
		incoming as unknown as OffscreenCanvas,
		progress,
		direction,
		{ width: WIDTH, height: HEIGHT },
		defaultProperties(definition)
	);
	return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

function pixels(canvas: HTMLCanvasElement): Uint8ClampedArray {
	const context = canvas.getContext('2d', { willReadFrequently: true });
	if (!context) throw new Error('Canvas2D is unavailable.');
	return context.getImageData(0, 0, WIDTH, HEIGHT).data;
}

function changedRatio(left: Uint8ClampedArray, right: Uint8ClampedArray): number {
	let changed = 0;
	for (let offset = 0; offset < left.length; offset += 4) {
		if (
			Math.abs(left[offset]! - right[offset]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 1]! - right[offset + 1]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 2]! - right[offset + 2]!) > PIXEL_THRESHOLD ||
			Math.abs(left[offset + 3]! - right[offset + 3]!) > PIXEL_THRESHOLD
		) {
			changed += 1;
		}
	}
	return changed / (left.length / 4);
}

describe('all 44 transition canvas renderers', () => {
	it('render real start, midpoint, and end pixels without a silent fallback', () => {
		const definitions = transitionRegistry.getDefinitions();
		expect(definitions).toHaveLength(44);
		const outgoing = fixture('outgoing');
		const incoming = fixture('incoming');
		const outgoingPixels = pixels(outgoing);
		const incomingPixels = pixels(incoming);

		for (const definition of definitions) {
			const start = render(definition, 0, outgoing, incoming);
			const midpoint = render(definition, 0.5, outgoing, incoming);
			const end = render(definition, 1, outgoing, incoming);
			expect(
				changedRatio(start, outgoingPixels),
				`${definition.id} must start on the outgoing frame`
			).toBeLessThan(0.03);
			expect(
				changedRatio(end, incomingPixels),
				`${definition.id} must end on the incoming frame`
			).toBeLessThan(0.03);
			expect(
				changedRatio(midpoint, outgoingPixels),
				`${definition.id} midpoint must leave the outgoing frame`
			).toBeGreaterThan(0.03);
			expect(
				changedRatio(midpoint, incomingPixels),
				`${definition.id} midpoint must not jump to the incoming frame`
			).toBeGreaterThan(0.03);
		}
	});

	it('renders every advertised direction as a distinct midpoint', () => {
		const outgoing = fixture('outgoing');
		const incoming = fixture('incoming');
		for (const definition of transitionRegistry.getDefinitions()) {
			if (!definition.hasDirection || !definition.directions || definition.directions.length < 2) {
				continue;
			}
			const first = render(definition, 0.37, outgoing, incoming, definition.directions[0]);
			const last = render(
				definition,
				0.37,
				outgoing,
				incoming,
				definition.directions[definition.directions.length - 1]
			);
			expect(
				changedRatio(first, last),
				`${definition.id} directions must produce distinct pixels`
			).toBeGreaterThan(0.03);
		}
	});
});
