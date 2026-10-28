import { afterEach, describe, expect, it, vi } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { ImageEditorController } from './editor.svelte';
import { blankImageEditorDocument, defaultTransform } from './document';
import {
	createRenderedPagesArchive,
	downloadRenderedPages,
	renderImageEditorPage,
	renderImageEditorPages,
	renderImageEditorPreview
} from './static-renderer';

afterEach(() => {
	vi.restoreAllMocks();
});

describe('Image Editor full-resolution rendering', () => {
	it.each(['background', 'font'] as const)(
		'cancels export while its %s download is stalled',
		async (target) => {
			const document = blankImageEditorDocument({
				key: 'cancel',
				name: 'Cancel',
				default_format: 'png',
				profiles: [],
				width_px: 64,
				height_px: 64
			});
			const page = document.pages[0];
			page.background = { type: 'image', opacity: 1, image: { media_id: 'slow', fit: 'cover' } };
			if (target === 'font') {
				page.background = { type: 'solid', color: '#ffffff', opacity: 1 };
				const editor = new ImageEditorController();
				editor.load({
					id: 'design',
					workspace_id: 'local',
					created_by_id: 'test',
					revision: 1,
					can_edit: true,
					created_at: '2026-10-09',
					updated_at: '2026-10-09',
					document
				});
				editor.addText('Brand headline');
				page.layers = editor.activePage!.layers;
				page.layers[0].text!.font_asset_id = 'slow-font-export';
			}

			const pending = Promise.withResolvers<Response>();
			const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation((_url, options) => {
				options?.signal?.addEventListener('abort', () => pending.reject(options.signal!.reason), {
					once: true
				});
				return pending.promise;
			});
			const controller = new AbortController();
			const result = renderImageEditorPage(document, page, 0, controller.signal).then(
				() => 'exported',
				(error: Error) => error.name
			);
			try {
				await expect.poll(() => fetchMock.mock.calls.length).toBe(1);
				controller.abort();
				let outcome = 'pending';
				void result.then((value) => {
					outcome = value;
				});
				await expect.poll(() => outcome).toBe('AbortError');
			} finally {
				pending.resolve(new Response(null, { status: 404 }));
				await result;
			}
		}
	);

	it.each(['page', 'preview'] as const)(
		'cancels %s rendering while document fonts remain pending',
		async (target) => {
			const authored = blankImageEditorDocument({
				key: 'cancel-fonts',
				name: 'Cancel fonts',
				default_format: 'png',
				profiles: [],
				width_px: 64,
				height_px: 64
			});
			const fonts = globalThis.document.fonts;
			const pending = Promise.withResolvers<FontFaceSet>();
			vi.spyOn(fonts, 'ready', 'get').mockReturnValue(pending.promise);
			const controller = new AbortController();
			let outcome = 'pending';
			const result = (
				target === 'page'
					? renderImageEditorPage(authored, authored.pages[0], 0, controller.signal)
					: renderImageEditorPreview(authored, authored.pages[0], controller.signal)
			).then(
				() => (outcome = 'rendered'),
				(error: Error) => (outcome = error.name)
			);
			try {
				controller.abort();
				await expect.poll(() => outcome).toBe('AbortError');
			} finally {
				pending.resolve(fonts);
				await result;
			}
		}
	);

	it('finishes a multipage export when browser animation frames are paused', async () => {
		const authored = blankImageEditorDocument({
			key: 'background-export',
			name: 'Background export',
			default_format: 'png',
			profiles: [],
			width_px: 64,
			height_px: 64
		});
		authored.pages.push({
			...authored.pages[0],
			id: 'second',
			name: 'Second',
			background_color: '#ff0000',
			background: { type: 'solid', color: '#ff0000', opacity: 1 }
		});
		const frames = new Map<number, FrameRequestCallback>();
		let frameID = 0;
		const originalFrame = globalThis.requestAnimationFrame;
		const requestFrame = vi
			.spyOn(globalThis, 'requestAnimationFrame')
			.mockImplementation((callback) => {
				frames.set(++frameID, callback);
				return frameID;
			});
		const cancelFrame = vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation((id) => {
			frames.delete(id);
		});
		let complete = false;
		const rendering = renderImageEditorPages(authored).then((result) => {
			complete = true;
			return result;
		});
		try {
			// Canvas encoding may wait for browser idle time on a busy runner.
			// A bounded wait still catches an export blocked on the paused frames.
			await expect.poll(() => complete, { timeout: 5_000 }).toBe(true);
			const rendered = await rendering;
			expect(rendered.map((page) => page.page.id)).toEqual(authored.pages.map((page) => page.id));
			for (const page of rendered) expect(page.blob.size).toBeGreaterThan(0);
		} finally {
			requestFrame.mockRestore();
			cancelFrame.mockRestore();
			for (const callback of frames.values()) originalFrame(callback);
			await rendering;
		}
	});

	it('cancels between export pages without waiting for a throttled task', async () => {
		const authored = blankImageEditorDocument({
			key: 'cancel-yield',
			name: 'Cancel yield',
			default_format: 'png',
			profiles: [],
			width_px: 64,
			height_px: 64
		});
		authored.pages.push({ ...authored.pages[0], id: 'second' });
		const controller = new AbortController();
		const yielded = Promise.withResolvers<void>();
		const originalTimer = globalThis.setTimeout;
		let release = () => {};
		let timer: ReturnType<typeof setTimeout> | undefined;
		let restoreTimer = () => {};
		let outcome = 'pending';
		const rendering = renderImageEditorPages(
			authored,
			undefined,
			(completed) => {
				if (completed !== 1) return;
				const mock = vi.spyOn(globalThis, 'setTimeout').mockImplementationOnce((callback) => {
					timer = originalTimer(() => {}, 60_000);
					release = () => {
						// Browser timers also accept source strings; only invoke function callbacks.
						// oxlint-disable-next-line anti-slop/no-runtime-typeof
						if (typeof callback === 'function') callback();
					};
					yielded.resolve();
					return timer;
				});
				restoreTimer = () => mock.mockRestore();
			},
			controller.signal
		).then(
			() => (outcome = 'rendered'),
			(error: Error) => (outcome = error.name)
		);
		try {
			await yielded.promise;
			controller.abort();
			await expect.poll(() => outcome).toBe('AbortError');
		} finally {
			restoreTimer();
			clearTimeout(timer);
			release();
			await rendering;
		}
	});

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
		// Read the page count itself: a substring match would also accept "12".
		const manifest = files['manifest.txt'];
		if (!manifest) throw new Error('Archive manifest is missing.');
		expect(strFromU8(manifest).match(/\d+/gu)).toEqual(['2']);
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
