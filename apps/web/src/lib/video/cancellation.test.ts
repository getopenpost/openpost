import { expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { renderVideoEdit } from './editor';
import { probeVideo } from './prepare';

it('honors cancellation before inspecting a video file', async () => {
	const controller = new AbortController();
	controller.abort();
	await expect(
		probeVideo(new File([], 'cancelled.mp4', { type: 'video/mp4' }), controller.signal)
	).rejects.toMatchObject({ name: 'AbortError' });
});

it.each(['inspect', 'edit'] as const)(
	'cancels %s while the source read is pending',
	async (operation) => {
		const entered = Promise.withResolvers<void>();
		const release = Promise.withResolvers<void>();
		class DelayedBlob extends Blob {
			override stream(): ReadableStream<Uint8Array<ArrayBuffer>> {
				const source = super.arrayBuffer();
				let cancelled = false;
				return new ReadableStream({
					async start(controller) {
						entered.resolve();
						await release.promise;
						const bytes = await source;
						if (cancelled) return;
						controller.enqueue(new Uint8Array(bytes));
						controller.close();
					},
					cancel() {
						cancelled = true;
					}
				});
			}
		}
		class DelayedFile extends File {
			override slice(start?: number, end?: number, type?: string): Blob {
				return new DelayedBlob([super.slice(start, end, type)]);
			}
		}
		const fixture = await readFile(
			new URL(
				'../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4',
				import.meta.url
			)
		);
		const source = new DelayedFile([new Uint8Array(fixture)], 'video.mp4', {
			type: 'video/mp4'
		});
		const controller = new AbortController();
		let outcome: Error | 'completed' | undefined;
		const work =
			operation === 'inspect'
				? probeVideo(source, controller.signal)
				: renderVideoEdit(
						source,
						{
							version: 1,
							trim: { startSeconds: 0, endSeconds: 1 },
							crop: null
						},
						() => undefined,
						controller.signal
					);
		const settled = work.then(
			() => {
				outcome = 'completed';
			},
			(error: Error) => {
				outcome = error;
			}
		);
		try {
			await entered.promise;
			controller.abort();
			await expect.poll(() => outcome).toMatchObject({ name: 'AbortError' });
		} finally {
			release.resolve();
			await settled;
		}
	}
);

it('releases streaming output without an unhandled error when an active edit is cancelled', async () => {
	const abort = vi.fn(async () => undefined);
	const removeEntry = vi.fn(async () => undefined);
	const directory = {
		getDirectoryHandle: async () => directory,
		getFileHandle: async () => ({
			createWritable: async () => ({
				write: async () => undefined,
				close: async () => undefined,
				abort
			})
		}),
		removeEntry,
		async *entries() {}
	};
	vi.stubGlobal('navigator', {
		storage: { getDirectory: async () => directory }
	});
	try {
		const source = new File(
			[
				new Uint8Array(
					await readFile(
						new URL(
							'../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4',
							import.meta.url
						)
					)
				)
			],
			'video.mp4',
			{ type: 'video/mp4' }
		);
		const controller = new AbortController();
		await expect(
			renderVideoEdit(
				source,
				{ version: 1, trim: { startSeconds: 0, endSeconds: 1 }, crop: null },
				() => controller.abort(),
				controller.signal
			)
		).rejects.toMatchObject({ name: 'AbortError' });
		expect(abort).toHaveBeenCalledOnce();
		expect(removeEntry).toHaveBeenCalledOnce();
		await new Promise((resolve) => setTimeout(resolve, 0));
	} finally {
		vi.unstubAllGlobals();
	}
});
