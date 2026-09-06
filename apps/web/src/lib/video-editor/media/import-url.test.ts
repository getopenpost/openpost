import { describe, expect, it, vi } from 'vitest';
import { fetchRemoteMediaFile, MAX_REMOTE_MEDIA_BYTES } from './import-url';

describe('remote media import', () => {
	it('downloads without credentials and derives a safe redirected filename', async () => {
		const fetcher = vi.fn(async () => {
			const response = new Response(new Blob(['image'], { type: 'image/png' }), {
				status: 200,
				headers: {
					'content-disposition': "attachment; filename*=UTF-8''launch%20still.png",
					'content-type': 'image/png'
				}
			});
			Object.defineProperty(response, 'url', { value: 'https://cdn.example/final' });
			return response;
		});

		const file = await fetchRemoteMediaFile('https://example.test/download?id=1', fetcher);

		expect(file.name).toBe('launch still.png');
		expect(file.type).toBe('image/png');
		expect(fetcher).toHaveBeenCalledWith(
			new URL('https://example.test/download?id=1'),
			expect.objectContaining({ credentials: 'omit', referrerPolicy: 'no-referrer' })
		);
	});

	it('accepts an unquoted content-disposition filename', async () => {
		const file = await fetchRemoteMediaFile(
			'https://example.test/download',
			async () =>
				new Response(new Blob(['audio'], { type: 'audio/mpeg' }), {
					headers: { 'content-disposition': 'attachment; filename=voice-note.mp3' }
				})
		);

		expect(file.name).toBe('voice-note.mp3');
	});

	it('rejects unsafe locations, pages, empty files, and declared oversize downloads', async () => {
		await expect(fetchRemoteMediaFile('file:///tmp/video.mp4')).rejects.toThrow(/HTTP and HTTPS/);
		await expect(fetchRemoteMediaFile('https://user:pass@example.test/video.mp4')).rejects.toThrow(
			/username or password/
		);
		await expect(
			fetchRemoteMediaFile(
				'https://example.test/watch',
				async () => new Response('<html></html>', { headers: { 'content-type': 'text/html' } })
			)
		).rejects.toThrow(/web page/);
		await expect(
			fetchRemoteMediaFile('https://example.test/empty.mp4', async () => new Response())
		).rejects.toThrow(/empty/);
		await expect(
			fetchRemoteMediaFile(
				'https://example.test/huge.mp4',
				async () =>
					new Response('x', {
						headers: { 'content-length': String(MAX_REMOTE_MEDIA_BYTES + 1) }
					})
			)
		).rejects.toThrow(/2 GB/);
	});
});
