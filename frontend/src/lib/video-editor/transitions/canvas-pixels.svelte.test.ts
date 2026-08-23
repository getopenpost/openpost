// oxlint-disable
/**
 * Ported from FreeCut (MIT) - canvas transition pixel tests
 * Representative exact canvas pixels for browser environment.
 */

import { describe, expect, it } from 'vitest';
import { transitionRegistry } from './registry';
import type { FlipDirection, SlideDirection, WipeDirection } from './types';
import './index';

function createSolidCanvas(
	width: number,
	height: number,
	r: number,
	g: number,
	b: number
): HTMLCanvasElement {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2d unavailable');
	ctx.fillStyle = `rgb(${r}, ${g}, ${b})`;
	ctx.fillRect(0, 0, width, height);
	return canvas;
}

function createOutputCanvas(
	width: number,
	height: number
): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
	const canvas = document.createElement('canvas');
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext('2d');
	if (!ctx) throw new Error('2d unavailable');
	return { canvas, ctx };
}

function pixelAt(ctx: CanvasRenderingContext2D, x: number, y: number): number[] {
	const data = ctx.getImageData(x, y, 1, 1).data;
	return [data[0], data[1], data[2], data[3]];
}

function render(
	id: string,
	progress: number,
	w: number,
	h: number,
	left: HTMLCanvasElement,
	right: HTMLCanvasElement,
	direction?: WipeDirection | SlideDirection | FlipDirection,
	properties?: Record<string, unknown>
): CanvasRenderingContext2D {
	const renderer = transitionRegistry.getRenderer(id);
	if (!renderer?.renderCanvas) throw new Error(`no renderer for ${id}`);
	const { canvas, ctx } = createOutputCanvas(w, h);
	// Cast HTMLCanvas to OffscreenCanvas for signature compatibility
	renderer.renderCanvas(
		ctx as unknown as OffscreenCanvasRenderingContext2D,
		left as unknown as OffscreenCanvas,
		right as unknown as OffscreenCanvas,
		progress,
		direction,
		{ width: w, height: h },
		properties
	);
	return ctx;
}

describe('canvas fallback exact pixels', () => {
	const W = 4;
	const H = 4;
	const left = createSolidCanvas(W, H, 255, 0, 0); // red outgoing
	const right = createSolidCanvas(W, H, 0, 0, 255); // blue incoming

	it('fade at progress 0 shows outgoing (red) with full opacity, at 1 shows incoming (blue)', () => {
		// The fade renderer uses additive lighter composite with scale; at p=0 outgoing weight ~1, incoming ~0.
		// Sampling center pixel should be predominantly red at start.
		const ctx0 = render('fade', 0, W, H, left, right);
		const p0 = pixelAt(ctx0, 1, 1);
		expect(p0[0]).toBeGreaterThan(200); // red channel high
		expect(p0[2]).toBeLessThan(50); // blue low

		const ctx1 = render('fade', 1, W, H, left, right);
		const p1 = pixelAt(ctx1, 1, 1);
		expect(p1[2]).toBeGreaterThan(200);
		expect(p1[0]).toBeLessThan(50);
	});

	it('fade at 0.5 blends to purple-ish (both channels present)', () => {
		const ctx = render('fade', 0.5, W, H, left, right);
		const p = pixelAt(ctx, 1, 1);
		// At midpoint both weights are 0.5, plus lighter composite sums channels -> ~128 each
		// Exact value may vary due to scale but both channels should be present
		expect(p[0]).toBeGreaterThan(80);
		expect(p[2]).toBeGreaterThan(80);
	});

	it('wipe from-left at 0.25 reveals left side as incoming, right side as outgoing', () => {
		const ctx = render('wipe', 0.25, W, H, left, right, 'from-left');
		const leftPixel = pixelAt(ctx, 0, 1); // x=0 should be incoming (blue) when wiping from left at 25%
		const rightPixel = pixelAt(ctx, 3, 1); // x=3 should still be outgoing (red)
		expect(leftPixel[2]).toBeGreaterThan(150);
		expect(rightPixel[0]).toBeGreaterThan(150);
	});

	it('slide from-left at 0.5 shows both clips split mid-frame', () => {
		const ctx = render('slide', 0.5, W, H, left, right, 'from-left');
		// Outgoing moved right by 2px, incoming moved from left by -2px, so midpoint split
		const blueSide = pixelAt(ctx, 0, 1);
		const redSide = pixelAt(ctx, 3, 1);
		expect(blueSide[2]).toBeGreaterThan(150);
		expect(redSide[0]).toBeGreaterThan(150);
	});

	it('dissolve at 0.5 mixes red and blue to purple', () => {
		const ctx = render('dissolve', 0.5, W, H, left, right);
		const p = pixelAt(ctx, 1, 1);
		// crossDissolveT cosine easing at 0.5 is 0.5 -> 50% blend
		expect(p[0]).toBeGreaterThan(80);
		expect(p[0]).toBeLessThan(180);
		expect(p[2]).toBeGreaterThan(80);
		expect(p[2]).toBeLessThan(180);
	});

	it('dipToColorDissolve dips through black at 0.5', () => {
		const ctx = render('dipToColorDissolve', 0.5, W, H, left, right, undefined, {
			color: [0, 0, 0]
		});
		const p = pixelAt(ctx, 1, 1);
		// Should be near black at midpoint
		expect(p[0]).toBeLessThan(30);
		expect(p[1]).toBeLessThan(30);
		expect(p[2]).toBeLessThan(30);
	});

	it('iris at 0 shows outgoing fully, at ~1 shows incoming centered', () => {
		const ctx0 = render('iris', 0, W, H, left, right);
		const p0 = pixelAt(ctx0, 0, 0);
		expect(p0[0]).toBeGreaterThan(150); // corner stays outgoing (red) at start

		const ctx1 = render('iris', 0.95, W, H, left, right);
		const center = pixelAt(ctx1, 1, 1);
		expect(center[2]).toBeGreaterThan(150); // center becomes incoming (blue) near end
	});

	it('clamps progress outside [0,1]', () => {
		const ctxNeg = render('fade', -1, W, H, left, right);
		const ctxPos = render('fade', 2, W, H, left, right);
		const pNeg = pixelAt(ctxNeg, 1, 1);
		const pPos = pixelAt(ctxPos, 1, 1);
		expect(pNeg[0]).toBeGreaterThan(200);
		expect(pPos[2]).toBeGreaterThan(200);
	});

	it('glitch fallback does not throw and produces a frame', () => {
		const ctx = render('glitch', 0.5, W, H, left, right);
		const p = pixelAt(ctx, 1, 1);
		expect(p[3]).toBe(255); // opaque
	});
});
