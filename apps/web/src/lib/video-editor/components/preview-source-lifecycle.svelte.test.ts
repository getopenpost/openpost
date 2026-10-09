import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { editorSession } from '../editor.svelte';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { getMediaObjectUrl, revokeMediaObjectUrl } from '../media/media-source';
import { clearPreviewDecoderPrewarm } from '../preview/decoder-prewarm-client';
import type { MediaMetadata } from '../media/types';
import '../../../routes/layout.css';

afterEach(() => {
	revokeMediaObjectUrl('pending-preview');
	clearPreviewDecoderPrewarm();
	mediaPool.clear();
	timelineStore.__resetForTesting();
	sequenceStore.reset();
	editorSession.project = null;
});

it('revokes a pending source read when the preview is unmounted', async () => {
	const pendingFile = Promise.withResolvers<File>();
	const getFile = vi.fn(() => pendingFile.promise);
	// SAFETY: the linked source resolver only calls getFile on this file-handle boundary.
	const fileHandle = { kind: 'file', name: 'image.png', getFile } as FileSystemFileHandle;
	const media: MediaMetadata = {
		id: 'pending-preview',
		storageType: 'handle',
		fileHandle,
		fileName: 'image.png',
		fileSize: 1,
		mimeType: 'image/png',
		duration: 0,
		width: 1,
		height: 1,
		fps: 0,
		codec: '',
		bitrate: 0,
		tags: ['image']
	};
	const project = createBlankProject('Pending preview');
	editorSession.project = project;
	sequenceStore.load(project.timeline!, project.metadata);
	mediaPool.loadAll([media]);
	const screen = await render(PreviewPlayer, { onedit: () => {} });
	let unmounted = false;
	try {
		await expect.poll(() => getFile.mock.calls.length).toBe(1);
		const pendingUrl = getMediaObjectUrl(media);
		const result = expect(pendingUrl).rejects.toMatchObject({ name: 'AbortError' });
		await screen.unmount();
		unmounted = true;
		pendingFile.resolve(new File(['source'], 'image.png', { type: 'image/png' }));
		await result;
	} finally {
		pendingFile.resolve(new File(['source'], 'image.png', { type: 'image/png' }));
		if (!unmounted) await screen.unmount();
	}
});
