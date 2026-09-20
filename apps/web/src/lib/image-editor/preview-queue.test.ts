import { describe, expect, it, vi } from 'vitest';
import type { ImageEditorDocument, ImageEditorPage } from './types';
import { createImageEditorPreviewQueue } from './preview-queue';

describe('Image Editor page preview queue', () => {
	it('keeps only the latest pending settings per preview without canceling running work', async () => {
		const page: ImageEditorPage = {
			id: 'page',
			name: 'Page',
			background_color: '#ffffff',
			layers: []
		};
		const document: ImageEditorDocument = {
			schema_version: 1,
			title: 'Queue',
			preset_key: 'custom',
			width_px: 100,
			height_px: 100,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 1, matte_color: '#ffffff' },
			pages: [page]
		};
		const releases: Array<(value: Blob) => void> = [];
		const render = vi.fn(() => new Promise<Blob>((resolve) => releases.push(resolve)));
		const queue = createImageEditorPreviewQueue(render);
		const signal = new AbortController().signal;
		const owner = Symbol('preview');
		const first = queue(document, page, signal, owner);
		const other = queue(document, page, signal, Symbol('other-preview'));
		const old = queue(document, { ...page, name: 'Old' }, signal, owner);
		const rejected = expect(old).rejects.toMatchObject({ name: 'AbortError' });
		const newestPage = { ...page, name: 'Newest' };
		const newest = queue(document, newestPage, signal, owner);
		await rejected;
		expect(render).toHaveBeenCalledTimes(2);
		releases[0](new Blob());
		await first;
		await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(3));
		expect(render).toHaveBeenLastCalledWith(document, newestPage, signal);
		releases[1](new Blob());
		releases[2](new Blob());
		await Promise.all([other, newest]);
	});
	it('renders at most two pages at once and skips a canceled queued page', async () => {
		const resolvers: Array<(blob: Blob) => void> = [];
		const render = vi.fn(
			(_document: ImageEditorDocument, _page: ImageEditorPage): Promise<Blob> =>
				new Promise((resolve) => resolvers.push(resolve))
		);
		const pages: ImageEditorPage[] = ['one', 'two', 'three'].map((id) => ({
			id,
			name: id,
			background_color: '#ffffff',
			layers: []
		}));
		const document: ImageEditorDocument = {
			schema_version: 1,
			title: 'Queue test',
			preset_key: 'custom',
			width_px: 512,
			height_px: 512,
			brand_kit_revision: 0,
			export_defaults: { format: 'png', quality: 0.9, matte_color: '#ffffff' },
			pages
		};
		const queue = createImageEditorPreviewQueue(render);
		const signals = pages.map(() => new AbortController());
		const jobs = pages.map((page, index) => queue(document, page, signals[index].signal));
		expect(render).toHaveBeenCalledTimes(2);
		signals[2].abort();
		const canceled = jobs[2].catch(() => undefined);
		resolvers[0](new Blob());
		await jobs[0];
		await canceled;
		expect(render).toHaveBeenCalledTimes(2);
		resolvers[1](new Blob());
		await jobs[1];
	});
});
