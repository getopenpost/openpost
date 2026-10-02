import { loadEditorBrandFonts } from '$lib/editor-fonts';
import fontURL from '../../../../../assets/brand/fonts/Geist-Regular.ttf?url';
import { registerLocalImageEditorMedia, releaseLocalImageEditorMedia } from './local-media-url';
import { imageEditorTextFontFamily } from './fonts';
import { expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import { blankImageEditorDocument, defaultTransform } from './document';
import { renderImageEditorPage } from './static-renderer';
import { OpenPostFabricAdapter } from './fabric-adapter';
import { editTextWithRuns } from './text-runs';
import type { ImageEditorTextCurveType } from './types';

function fixture(text: string) {
	const authored = blankImageEditorDocument({
		key: 'test',
		name: 'Test',
		width_px: 640,
		height_px: 320,
		default_format: 'png',
		profiles: []
	});
	authored.pages[0].layers = [
		{
			id: 'arabic',
			type: 'text',
			name: 'Arabic',
			visible: true,
			locked: false,
			opacity: 1,
			transform: defaultTransform(500, 150, 50, 60),
			text: {
				text,
				font_family: 'Arial',
				font_weight: 400,
				font_style: 'normal',
				font_size: 64,
				color: '#000000',
				align: 'center',
				line_height: 1.2,
				letter_spacing: 0,
				stroke_width: 0,
				shadow: { color: '#00000000', blur: 0, offset_x: 0, offset_y: 0 },
				curve: { type: 'arc_up', strength: 0.65, offset: 0, reverse: false }
			}
		}
	];
	return authored;
}

async function exportedCanvas(authored: ReturnType<typeof fixture>, scale = 1) {
	if (scale !== 1) {
		const canvas = document.createElement('canvas');
		const adapter = new OpenPostFabricAdapter({
			canvas,
			document: authored,
			page: authored.pages[0],
			readOnly: true,
			staticCanvas: true,
			renderScale: scale,
			onSelection() {},
			onTransform() {},
			onTextChange() {}
		});
		try {
			await adapter.mount();
			const result = document.createElement('canvas');
			result.width = canvas.width;
			result.height = canvas.height;
			result.getContext('2d')!.drawImage(canvas, 0, 0);
			return result;
		} finally {
			adapter.dispose();
		}
	}
	const output = await renderImageEditorPage(authored, authored.pages[0], 0);
	const bitmap = await createImageBitmap(output.blob);
	const canvas = document.createElement('canvas');
	canvas.width = bitmap.width;
	canvas.height = bitmap.height;
	canvas.getContext('2d')!.drawImage(bitmap, 0, 0);
	bitmap.close();
	return canvas;
}

function pixels(canvas: HTMLCanvasElement) {
	return canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
}

function inkPixels(canvas: HTMLCanvasElement): number {
	const data = pixels(canvas);
	let count = 0;
	for (let index = 0; index < data.length; index += 4) {
		if (data[index + 3] > 128 && data[index] < 128) count++;
	}
	return count;
}

it('preserves the native joined Arabic ligature in exported curved pixels', async () => {
	const native = document.createElement('canvas');
	native.width = 640;
	native.height = 320;
	const context = native.getContext('2d')!;
	context.fillStyle = 'white';
	context.fillRect(0, 0, native.width, native.height);
	context.fillStyle = 'black';
	context.font = '400 64px Arial';
	context.fillText('لا', 100, 160);
	const rendered = await exportedCanvas(fixture('لا'));
	// Curvature may change edge antialiasing, but must retain the shaped glyph's ink area.
	expect(inkPixels(rendered) / inkPixels(native)).toBeGreaterThan(0.85);
	expect(inkPixels(rendered) / inkPixels(native)).toBeLessThan(1.15);
});

it.each([
	{ text: 'مرحبا', reverse: false, scale: 1, rich: false },
	{ text: 'Café مرحبا 東京 👋', reverse: false, scale: 1, rich: false },
	{ text: 'A👩🏽‍🚀 é لا B', reverse: false, scale: 1, rich: false },
	{ text: 'Café مرحبا 👋', reverse: true, scale: 1, rich: false },
	{ text: 'HHH', reverse: false, scale: 3, rich: false },
	{ text: 'MMiiMM', reverse: false, scale: 1, rich: true },
	{ text: 'MMiiMM', reverse: false, scale: 1, rich: 'stylesheet' },
	{ text: 'MMiiMM', reverse: false, scale: 1, rich: 'programmatic' },
	{ text: 'مرحبا', reverse: true, scale: 1, rich: false, curveType: 'ellipse' }
] satisfies Array<{
	text: string;
	reverse: boolean;
	scale: number;
	rich: boolean | 'stylesheet' | 'programmatic';
	curveType?: ImageEditorTextCurveType;
}>)(
	'exports native bidi and grapheme runs for $text (reversed: $reverse, scale: $scale, imported rich text: $rich, curve: $curveType)',
	async ({ text, reverse, scale, rich, curveType }) => {
		const width = 640 * scale,
			height = 320 * scale;
		// Independent browser textPath reference, with this fixture's explicitly authored geometry.
		const authored = fixture(text);
		let mediaID = '';
		let fontStyle: HTMLStyleElement | undefined;
		if (rich) {
			mediaID = `local_media_${crypto.randomUUID()}`;
			const blob = await (await fetch(fontURL)).blob();
			if (rich === 'stylesheet') {
				fontStyle = document.createElement('style');
				fontStyle.textContent = `@font-face{font-family:ICUStyleSheet;src:url("${fontURL}");font-weight:400;font-style:normal}`;
				document.head.append(fontStyle);
				await document.fonts.load('400 64px ICUStyleSheet');
				mediaID = '';
			} else {
				registerLocalImageEditorMedia(mediaID, blob);
				if (rich === 'programmatic')
					await loadEditorBrandFonts({
						fonts: [
							{
								id: mediaID,
								media_id: mediaID,
								family: 'ICUProgrammatic',
								weight: 400,
								style: 'normal'
							}
						]
					});
			}
			authored.pages[0].layers[0].text = {
				...authored.pages[0].layers[0].text!,
				font_family:
					rich === 'stylesheet'
						? 'ICUStyleSheet'
						: rich === 'programmatic'
							? 'ICUProgrammatic'
							: 'ICUProject',
				font_asset_id: rich === 'programmatic' ? undefined : mediaID || undefined,
				runs: [{ start: 2, end: 4, font_weight: 700, font_style: 'italic', color: '#ff0000' }]
			};
		}
		const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
		svg.setAttribute('width', '640');
		svg.setAttribute('height', '320');
		svg.innerHTML =
			'<defs><path id="reference" d="M 50 147.75 Q 300 33.75 550 147.75"/></defs><text font-family="Arial" font-size="64" dominant-baseline="central" text-anchor="middle"><textPath href="#reference" startOffset="50%"/></text>';
		if (reverse) svg.querySelector('path')!.setAttribute('d', 'M 550 147.75 Q 300 33.75 50 147.75');
		if (curveType === 'ellipse')
			svg
				.querySelector('path')!
				.setAttribute('d', 'M 50 129 A 244 69 0 1 0 538 129 A 244 69 0 1 0 50 129');
		svg.querySelector('textPath')!.textContent = text;
		if (rich) {
			const blob = await (await fetch(fontURL)).blob();
			const data = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onload = () => resolve(String(reader.result));
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});
			const style = document.createElementNS('http://www.w3.org/2000/svg', 'style');
			style.textContent = `@font-face{font-family:NativeExpected;src:url("${data}");font-style:normal;font-weight:400}`;
			svg.prepend(style);
			svg.querySelector('text')!.setAttribute('font-family', 'NativeExpected');
			svg.querySelector('textPath')!.innerHTML =
				'<tspan>MM</tspan><tspan font-weight="700" font-style="italic" fill="#ff0000">ii</tspan><tspan>MM</tspan>';
		}
		const url = URL.createObjectURL(
			new Blob([new XMLSerializer().serializeToString(svg)], {
				type: 'image/svg+xml'
			})
		);
		try {
			const image = new Image();
			image.src = url;
			await image.decode();
			const reference = document.createElement('canvas');
			reference.width = width;
			reference.height = height;
			const context = reference.getContext('2d')!;
			context.fillStyle = 'white';
			context.fillRect(0, 0, width, height);
			context.scale(scale, scale);
			context.drawImage(image, 0, 0);
			authored.pages[0].layers[0].text!.curve!.reverse = reverse;
			if (curveType) authored.pages[0].layers[0].text!.curve!.type = curveType;
			const actual = await exportedCanvas(authored, scale);
			const expected = pixels(reference);
			const observed = pixels(actual);
			const nearInk = (data: Uint8ClampedArray, x: number, y: number) => {
				for (let dx = -2; dx <= 2; dx++)
					for (let dy = -2; dy <= 2; dy++) {
						if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height) continue;
						const index = ((y + dy) * width + x + dx) * 4;
						if (Math.min(...data.slice(index, index + 3)) < 128) return true;
					}
				return false;
			};
			let matched = 0,
				ink = 0;
			for (let index = 0; index < expected.length; index += 4) {
				const x = (index / 4) % width;
				const y = Math.floor(index / 4 / width);
				if (Math.min(...expected.slice(index, index + 3)) < 128) {
					ink++;
					if (nearInk(observed, x, y)) matched++;
				}
				if (Math.min(...observed.slice(index, index + 3)) < 128) {
					ink++;
					if (nearInk(expected, x, y)) matched++;
				}
			}
			expect(ink).toBeGreaterThan(100);
			expect(matched / ink).toBeGreaterThan(scale > 1 ? 0.95 : 0.98);
			if (rich) {
				const redPixels = (data: Uint8ClampedArray) => {
					let count = 0;
					for (let index = 0; index < data.length; index += 4) {
						if (data[index] > 180 && data[index + 1] < 80 && data[index + 2] < 80) count++;
					}
					return count;
				};
				expect(redPixels(expected)).toBeGreaterThan(100);
				expect(redPixels(observed) / redPixels(expected)).toBeGreaterThan(0.85);
				expect(redPixels(observed) / redPixels(expected)).toBeLessThan(1.15);
			}
			if (scale > 1) {
				const edgePixels = (data: Uint8ClampedArray) => {
					let count = 0;
					for (let index = 0; index < data.length; index += 4) {
						if (data[index] > 8 && data[index] < 247) count++;
					}
					return count;
				};
				expect(edgePixels(observed) / edgePixels(expected)).toBeGreaterThan(0.85);
				expect(edgePixels(observed) / edgePixels(expected)).toBeLessThan(1.15);
			}
		} finally {
			URL.revokeObjectURL(url);
			fontStyle?.remove();
			if (mediaID) {
				releaseLocalImageEditorMedia(mediaID);
				const family = imageEditorTextFontFamily(authored.pages[0].layers[0].text!);
				for (const face of document.fonts) if (face.family === family) document.fonts.delete(face);
			}
		}
	}
);

it('keeps the editable textarea and caret while reshaping a curved text edit', async () => {
	let authored = fixture('لا');
	const canvas = document.createElement('canvas');
	document.body.append(canvas);
	const adapter = new OpenPostFabricAdapter({
		canvas,
		document: authored,
		page: authored.pages[0],
		readOnly: false,
		onSelection() {},
		onTransform() {},
		onTextChange(_id, text, edit) {
			const value = editTextWithRuns(authored.pages[0].layers[0].text!, text, edit);
			authored = structuredClone(authored);
			authored.pages[0].layers[0].text = value;
			adapter.accept(authored, authored.pages[0]);
			return value;
		}
	});
	try {
		await adapter.mount();
		adapter.enterTextEditing('arabic');
		const textarea = document.querySelector<HTMLTextAreaElement>(
			'textarea[data-fabric="textarea"]'
		)!;
		expect(textarea).not.toBeNull();
		await userEvent.type(textarea, 'مرحبا');
		expect(document.querySelector('textarea[data-fabric="textarea"]')).toBe(textarea);
		expect(textarea.selectionStart).toBe('مرحبا'.length);
		expect(authored.pages[0].layers[0].text!.text).toBe('مرحبا');
		await userEvent.keyboard('{Escape}');
		await adapter.sync(authored, authored.pages[0]);
		const exported = await exportedCanvas(authored);
		adapter.setSelection([]);
		const expected = pixels(exported);
		await expect
			.poll(() => pixels(canvas).every((value, index) => value === expected[index]))
			.toBe(true);
	} finally {
		adapter.dispose();
		canvas.remove();
	}
});
