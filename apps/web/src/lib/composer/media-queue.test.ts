import { describe, expect, it } from 'vitest';
import { MEDIA_IMAGE_MAX_BYTES } from '../media-input';
import {
	ComposerSessionMediaQueue,
	availablePasteMediaSlots,
	firstFailedPasteMediaUpload,
	hasUnsettledPasteMediaUploads,
	selectPastedImageFiles,
	type ClipboardFileItem,
	type PasteMediaUploadItem,
	type PasteMediaUploadTarget
} from './media-queue';

const target: PasteMediaUploadTarget = {
	workspaceId: 'workspace-1',
	postKey: 'post-1',
	variantAccountId: null
};

// Metadata is all the queue reads. Reporting the size without allocating it
// keeps the large-limit cases cheap to construct.
function fakeFile(name: string, type: string, size = 128, lastModified = 1): File {
	const file = new File([], name, { type, lastModified });
	Object.defineProperty(file, 'size', { value: size });
	return file;
}

function clipboardItem(kind: string, type: string, file: File | null): ClipboardFileItem {
	return { kind, type, getAsFile: () => file };
}

async function settle(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

interface Deferred<T> {
	promise: Promise<T>;
	resolve: (value: T) => void;
	reject: (cause?: Error) => void;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	let reject!: (cause?: Error) => void;
	const promise = new Promise<T>((resolvePromise, rejectPromise) => {
		resolve = resolvePromise;
		reject = rejectPromise;
	});
	return { promise, resolve, reject };
}

describe('pasted image selection', () => {
	it.each(['queued', 'uploading', 'paused', 'failed'] as const)(
		'treats %s paste items as unsettled navigation state',
		(status) => {
			expect(
				hasUnsettledPasteMediaUploads([
					{
						id: 'upload-1',
						file: fakeFile('pending.png', 'image/png'),
						previewURL: 'preview:pending',
						target,
						status,
						progress: null,
						error: ''
					}
				])
			).toBe(true);
		}
	);

	it('does not report settled navigation state for an empty queue', () => {
		expect(hasUnsettledPasteMediaUploads([])).toBe(false);
	});

	it('only reports failed uploads as actionable upload issues', () => {
		const queued = {
			id: 'upload-queued',
			file: fakeFile('queued.png', 'image/png'),
			previewURL: 'preview:queued',
			target,
			status: 'queued' as const,
			progress: null,
			error: ''
		};
		const uploading = { ...queued, id: 'uploading', status: 'uploading' as const };
		const paused = { ...queued, id: 'upload-paused', status: 'paused' as const };
		const failed = {
			...queued,
			id: 'upload-failed',
			status: 'failed' as const,
			error: 'Upload failed'
		};

		expect(firstFailedPasteMediaUpload([queued, uploading])).toBeUndefined();
		expect(firstFailedPasteMediaUpload([queued, paused])).toBeUndefined();
		expect(firstFailedPasteMediaUpload([queued, failed])).toBe(failed);
	});

	it('keeps native text and non-image paste behavior unless an eligible image fits', () => {
		const image = fakeFile('clipboard.png', 'image/png');
		const items = [
			clipboardItem('string', 'text/plain', null),
			clipboardItem('file', 'application/pdf', fakeFile('brief.pdf', 'application/pdf')),
			clipboardItem('file', 'image/png', image)
		];

		expect(selectPastedImageFiles(items, 0).accepted).toEqual([]);
		expect(selectPastedImageFiles(items.slice(0, 2), 1).accepted).toEqual([]);
		expect(selectPastedImageFiles(items, 1).accepted).toEqual([image]);
	});

	it('enforces image size, empty-file, capacity, and duplicate validation', () => {
		const first = fakeFile('first.png', 'image/png', 10, 1);
		const duplicate = fakeFile('first.png', 'image/png', 10, 1);
		const second = fakeFile('second.webp', 'image/webp', 10, 2);
		const items = [
			clipboardItem('file', 'image/png', fakeFile('empty.png', 'image/png', 0)),
			clipboardItem(
				'file',
				'image/jpeg',
				fakeFile('large.jpg', 'image/jpeg', MEDIA_IMAGE_MAX_BYTES + 1)
			),
			clipboardItem('file', 'image/png', first),
			clipboardItem('file', 'image/png', duplicate),
			clipboardItem('file', 'image/webp', second)
		];

		expect(selectPastedImageFiles(items, 2).accepted).toEqual([first, second]);
		expect(selectPastedImageFiles(items, 2, ['first.png\u000010\u00001']).accepted).toEqual([
			second
		]);
		expect(availablePasteMediaSlots(2, 1, 4)).toBe(1);
		expect(availablePasteMediaSlots(4, 2, 4)).toBe(0);
	});

	it('accepts an image by filename extension when the browser provides no MIME type', () => {
		const extensionOnly = fakeFile('photo.png', '', 10, 3);
		const selection = selectPastedImageFiles([clipboardItem('file', '', extensionOnly)], 1);

		expect(selection.hasImageFiles).toBe(true);
		expect(selection.accepted).toEqual([extensionOnly]);
		expect(selection.rejected).toEqual([]);
	});

	it('reports partial acceptance and each actionable rejection without consuming text paste', () => {
		const accepted = fakeFile('accepted.png', 'image/png', 10, 1);
		const duplicate = fakeFile('accepted.png', 'image/png', 10, 1);
		const overflow = fakeFile('overflow.png', 'image/png', 10, 2);
		const selection = selectPastedImageFiles(
			[
				clipboardItem('string', 'text/plain', null),
				clipboardItem('file', 'image/png', fakeFile('empty.png', 'image/png', 0)),
				clipboardItem(
					'file',
					'image/jpeg',
					fakeFile('large.jpg', 'image/jpeg', MEDIA_IMAGE_MAX_BYTES + 1)
				),
				clipboardItem('file', 'image/png', accepted),
				clipboardItem('file', 'image/png', duplicate),
				clipboardItem('file', 'image/png', overflow)
			],
			1
		);

		expect(selection).toEqual({
			accepted: [accepted],
			hasImageFiles: true,
			rejected: [
				{ file: expect.objectContaining({ name: 'empty.png' }), reason: 'empty' },
				{ file: expect.objectContaining({ name: 'large.jpg' }), reason: 'file_too_large' },
				{ file: duplicate, reason: 'duplicate' },
				{ file: overflow, reason: 'capacity' }
			]
		});
		expect(selectPastedImageFiles([clipboardItem('string', 'text/plain', null)], 1)).toEqual({
			accepted: [],
			rejected: [],
			hasImageFiles: false
		});
	});
});

describe('ComposerSessionMediaQueue', () => {
	it('promotes files for one target in original clipboard order', async () => {
		const attempts: Array<{
			file: File;
			request: ReturnType<typeof deferred<{ id: string }>>;
		}> = [];
		const completed: string[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: ({ file }) => {
				const request = deferred<{ id: string }>();
				attempts.push({ file, request });
				return request.promise;
			},
			onComplete: (item, result) => {
				completed.push(`${item.file.name}:${result.id}`);
			},
			onChange: () => {},
			errorMessage: () => 'failed',
			createPreviewURL: (file) => `preview:${file.name}`,
			revokePreviewURL: () => {},
			createID: (() => {
				let id = 0;
				return () => `upload-${++id}`;
			})()
		});

		queue.enqueue(
			[fakeFile('first.png', 'image/png'), fakeFile('second.png', 'image/png')],
			target
		);
		expect(attempts.map((attempt) => attempt.file.name)).toEqual(['first.png']);

		attempts[0].request.resolve({ id: 'media-1' });
		await settle();
		expect(completed).toEqual(['first.png:media-1']);
		expect(attempts.map((attempt) => attempt.file.name)).toEqual(['first.png', 'second.png']);

		attempts[1].request.resolve({ id: 'media-2' });
		await settle();
		expect(completed).toEqual(['first.png:media-1', 'second.png:media-2']);
	});

	it('keeps a failed item for retry before advancing the target queue', async () => {
		const attempts: string[] = [];
		let nextID = 0;
		let latest: PasteMediaUploadItem[] = [];
		const completed: string[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: async ({ file }) => {
				attempts.push(file.name);
				if (attempts.length === 1) throw new Error('offline');
				return { id: `media-${file.name}` };
			},
			onComplete: (item) => {
				completed.push(item.file.name);
			},
			onChange: (items) => (latest = items),
			errorMessage: (cause) => (cause instanceof Error ? cause.message : 'failed'),
			createPreviewURL: (file) => `preview:${file.name}`,
			revokePreviewURL: () => {},
			createID: () => `upload-${++nextID}`
		});

		queue.enqueue([fakeFile('retry.png', 'image/png'), fakeFile('next.png', 'image/png')], target);
		await settle();
		expect(latest.map((item) => item.status)).toEqual(['failed', 'queued']);
		expect(latest[0].error).toBe('offline');
		expect(attempts).toEqual(['retry.png']);
		expect(completed).toEqual([]);

		queue.retry(latest[0].id);
		await settle();
		expect(attempts).toEqual(['retry.png', 'retry.png', 'next.png']);
		expect(completed).toEqual(['retry.png', 'next.png']);
		expect(latest).toEqual([]);
	});

	it('retries promotion with the uploaded result instead of uploading the file twice', async () => {
		let uploads = 0;
		let promotions = 0;
		let latest: PasteMediaUploadItem[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: async () => {
				uploads += 1;
				return { id: 'media-retained' };
			},
			onComplete: () => {
				promotions += 1;
				if (promotions === 1) throw new Error('capacity changed');
			},
			onChange: (items) => (latest = items),
			errorMessage: (cause) => (cause instanceof Error ? cause.message : 'failed'),
			createPreviewURL: () => 'preview:retained',
			revokePreviewURL: () => {},
			createID: () => 'upload-retained'
		});

		queue.enqueue([fakeFile('retained.png', 'image/png')], target);
		await settle();
		expect(latest[0]).toMatchObject({ status: 'failed', error: 'capacity changed' });

		queue.retry('upload-retained');
		await settle();
		expect({ uploads, promotions, latest }).toEqual({ uploads: 1, promotions: 2, latest: [] });
	});

	it('caps uploads across targets while preserving one-at-a-time target ordering', async () => {
		const attempts: Array<{
			file: File;
			request: ReturnType<typeof deferred<{ id: string }>>;
		}> = [];
		let active = 0;
		let peakActive = 0;
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: ({ file }) => {
				active += 1;
				peakActive = Math.max(peakActive, active);
				const request = deferred<{ id: string }>();
				attempts.push({ file, request });
				return request.promise.finally(() => {
					active -= 1;
				});
			},
			onComplete: () => {},
			onChange: () => {},
			errorMessage: () => 'failed',
			createPreviewURL: (file) => `preview:${file.name}`,
			revokePreviewURL: () => {},
			createID: (() => {
				let id = 0;
				return () => `upload-cap-${++id}`;
			})(),
			maxConcurrentUploads: 2
		});

		queue.enqueue([fakeFile('a-1.png', 'image/png'), fakeFile('a-2.png', 'image/png')], {
			...target,
			postKey: 'post-a'
		});
		queue.enqueue([fakeFile('b.png', 'image/png')], { ...target, postKey: 'post-b' });
		queue.enqueue([fakeFile('c.png', 'image/png')], { ...target, postKey: 'post-c' });
		expect(attempts.map(({ file }) => file.name)).toEqual(['a-1.png', 'b.png']);
		expect(peakActive).toBe(2);

		attempts[1].request.resolve({ id: 'media-b' });
		await settle();
		expect(attempts.map(({ file }) => file.name)).toEqual(['a-1.png', 'b.png', 'c.png']);

		attempts[0].request.resolve({ id: 'media-a-1' });
		await settle();
		expect(attempts.map(({ file }) => file.name)).toEqual(['a-1.png', 'b.png', 'c.png', 'a-2.png']);
		expect(peakActive).toBe(2);
		attempts[2].request.resolve({ id: 'media-c' });
		attempts[3].request.resolve({ id: 'media-a-2' });
		await settle();
		expect(active).toBe(0);
	});

	it('aborts to a retryable paused state without completing twice', async () => {
		let latest: PasteMediaUploadItem[] = [];
		const signals: AbortSignal[] = [];
		let attempt = 0;
		const completed: string[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: ({ signal }) => {
				attempt += 1;
				signals.push(signal);
				if (attempt > 1) return Promise.resolve({ id: 'media-retry' });
				return new Promise((_, reject) => {
					signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
				});
			},
			onComplete: (_, result) => {
				completed.push(result.id);
			},
			onChange: (items) => (latest = items),
			errorMessage: () => 'failed',
			createPreviewURL: () => 'preview:cancel',
			revokePreviewURL: () => {},
			createID: () => 'upload-cancel'
		});

		queue.enqueue([fakeFile('cancel.png', 'image/png')], target);
		queue.cancel('upload-cancel');
		await settle();
		expect(signals[0].aborted).toBe(true);
		expect(latest[0]).toMatchObject({ status: 'paused', progress: null });
		expect(completed).toEqual([]);

		queue.retry('upload-cancel');
		await settle();
		expect(completed).toEqual(['media-retry']);
		expect(latest).toEqual([]);
	});

	it('revokes previews and ignores a late completion from a stale generation', async () => {
		const request = deferred<{ id: string }>();
		const completed: string[] = [];
		const revoked: string[] = [];
		let latest: PasteMediaUploadItem[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: () => request.promise,
			onComplete: (_, result) => {
				completed.push(result.id);
			},
			onChange: (items) => (latest = items),
			errorMessage: () => 'failed',
			createPreviewURL: () => 'preview:stale',
			revokePreviewURL: (url) => revoked.push(url),
			createID: () => 'upload-stale'
		});

		queue.enqueue([fakeFile('stale.png', 'image/png')], target);
		queue.reset();
		request.resolve({ id: 'media-stale' });
		await settle();

		expect(latest).toEqual([]);
		expect(revoked).toEqual(['preview:stale']);
		expect(completed).toEqual([]);
	});

	it('discards uploads whose destination context is no longer valid', async () => {
		const request = deferred<{ id: string }>();
		const completed: string[] = [];
		const revoked: string[] = [];
		const signals: AbortSignal[] = [];
		let latest: PasteMediaUploadItem[] = [];
		const queue = new ComposerSessionMediaQueue<{ id: string }>({
			upload: ({ signal }) => {
				signals.push(signal);
				return request.promise;
			},
			onComplete: (_, result) => {
				completed.push(result.id);
			},
			onChange: (items) => (latest = items),
			errorMessage: () => 'failed',
			createPreviewURL: () => 'preview:removed-account',
			revokePreviewURL: (url) => revoked.push(url),
			createID: () => 'upload-removed-account'
		});

		queue.enqueue([fakeFile('removed-account.png', 'image/png')], {
			...target,
			variantAccountId: 'account-removed'
		});
		queue.discardWhere((item) => item.target.variantAccountId === 'account-removed');
		request.resolve({ id: 'orphaned-media' });
		await settle();

		expect(signals[0].aborted).toBe(true);
		expect(latest).toEqual([]);
		expect(revoked).toEqual(['preview:removed-account']);
		expect(completed).toEqual([]);
	});
});
