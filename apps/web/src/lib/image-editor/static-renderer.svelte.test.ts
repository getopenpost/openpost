import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { blankImageEditorDocument, defaultTransform } from './document';
import {
	createRenderedPagesArchive,
	downloadRenderedPages,
	renderImageEditorPage
} from './static-renderer';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Image Editor full-resolution rendering', () => {
	it('exports each page at its own dimensions', async () => {
		const document = blankImageEditorDocument({
			key: 'mixed-export',
			name: 'Mixed export',
			default_format: 'png',
			profiles: [],
			width_px: 64,
			height_px: 64
		});
		const second = structuredClone(document.pages[0]);
		second.id = 'portrait';
		second.width_px = 80;
		second.height_px = 120;
		document.pages.push(second);
		const rendered = await renderImageEditorPage(document, second, 1);
		const bitmap = await createImageBitmap(rendered.blob);
		try {
			expect([bitmap.width, bitmap.height]).toEqual([80, 120]);
		} finally {
			bitmap.close();
		}
	});

	it('packages multiple encoded pages without changing their bytes', async () => {
		const document = blankImageEditorDocument({
			key: 'archive-test',
			name: 'Archive test',
			default_format: 'png',
			profiles: [],
			width_px: 64,
			height_px: 64
		});
		const first = new Uint8Array([1, 2, 3, 4]);
		const second = new Uint8Array([5, 6, 7, 8]);
		const archive = await createRenderedPagesArchive([
			{
				page: document.pages[0],
				filename: 'first.png',
				blob: new Blob([first])
			},
			{
				page: document.pages[0],
				filename: 'second.webp',
				blob: new Blob([second])
			}
		]);
		const files = unzipSync(new Uint8Array(await archive.arrayBuffer()));
		expect(files['first.png']).toEqual(first);
		expect(files['second.webp']).toEqual(second);
		expect(strFromU8(files['manifest.txt'])).toContain('2');
	});

	it('cancels a page archive before opening a download', async () => {
		const document = blankImageEditorDocument({
			key: 'cancel-archive',
			name: 'Cancel archive',
			default_format: 'png',
			profiles: [],
			width_px: 64,
			height_px: 64
		});
		const first = new Blob([new Uint8Array([1])]);
		vi.spyOn(first, 'stream').mockImplementation(
			() =>
				new ReadableStream<Uint8Array<ArrayBuffer>>({
					start(controller) {
						controller.enqueue(new Uint8Array([1]));
					}
				})
		);
		const createURL = vi.spyOn(URL, 'createObjectURL');
		const controller = new AbortController();
		const downloading = downloadRenderedPages(
			[
				{ page: document.pages[0], filename: 'first.png', blob: first },
				{ page: document.pages[0], filename: 'second.png', blob: new Blob([new Uint8Array([2])]) }
			],
			'design',
			controller.signal
		);
		await new Promise<void>((resolve) => setTimeout(resolve, 0));
		controller.abort();
		await expect(downloading).rejects.toMatchObject({ name: 'AbortError' });
		expect(createURL).not.toHaveBeenCalled();
	});

	it.each(['background', 'layer'] as const)(
		'rejects an export with missing %s media',
		async (target) => {
			const document = blankImageEditorDocument({
				key: 'missing-media-test',
				name: 'Missing media test',
				default_format: 'png',
				profiles: [],
				width_px: 64,
				height_px: 64
			});
			const page = document.pages[0];
			if (target === 'background') {
				page.background = {
					type: 'image',
					color: '#ffffff',
					opacity: 1,
					image: { media_id: 'missing-background', fit: 'cover' }
				};
			} else {
				page.layers = [
					{
						id: 'missing-layer',
						type: 'image',
						name: 'Missing layer',
						visible: true,
						locked: false,
						opacity: 1,
						transform: defaultTransform(64, 64),
						image: {
							media_id: 'missing-layer-media',
							source_width: 64,
							source_height: 64,
							fit: 'stretch',
							crop: { x: 0, y: 0, width: 1, height: 1 },
							adjustments: {
								brightness: 0,
								contrast: 0,
								saturation: 0,
								temperature: 0,
								tint: 0,
								vibrance: 0,
								hue: 0,
								exposure: 0,
								highlights: 0,
								shadows: 0,
								blur: 0
							}
						}
					}
				];
			}
			vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(null, { status: 404 }));

			await expect(renderImageEditorPage(document, page, 0)).rejects.toThrow(
				'Export stopped because media is missing or unreadable.'
			);
		}
	);
});
