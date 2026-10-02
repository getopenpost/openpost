import { describe, expect, it, vi } from 'vitest';
import { blankImageEditorDocument, blankImageEditorPage } from './document';
import { saveImageEditorConflictCopy } from './conflict-recovery';
import type { ImageEditorDocument, ImageEditorDocumentResponse } from './types';

function response(id: string, revision: number, title: string): ImageEditorDocumentResponse {
	const document = blankImageEditorDocument({
		key: 'instagram_square',
		name: 'Instagram square',
		width_px: 1080,
		height_px: 1080,
		default_format: 'png',
		profiles: ['instagram_feed']
	});
	document.title = title;
	return {
		id,
		workspace_id: 'workspace-1',
		created_by_id: 'user-1',
		revision,
		can_edit: true,
		created_at: '2026-08-07T12:00:00Z',
		updated_at: '2026-08-07T12:00:00Z',
		document
	};
}

describe('Image Editor conflict recovery', () => {
	it('preserves the pending local title with the complete local document', async () => {
		const local = response('source', 4, 'Pending café title').document;
		local.pages.push(blankImageEditorPage('Page 2'));
		const duplicate = vi.fn().mockResolvedValue(response('copy', 1, 'Campaign copy'));
		const saved = response('copy', 2, 'Pending café title');
		const save = vi.fn(
			async (
				_workspaceID: string,
				_id: string,
				_revision: number,
				_document: ImageEditorDocument
			) => saved
		);

		await expect(
			saveImageEditorConflictCopy('workspace-1', 'source', local, { duplicate, save })
		).resolves.toMatchObject({
			id: 'copy',
			revision: 2,
			document: { title: 'Pending café title' }
		});
		expect(duplicate).toHaveBeenCalledWith('workspace-1', 'source');
		expect(save).toHaveBeenCalledOnce();
		const [workspaceID, copyID, copyRevision, savedDocument] = save.mock.calls[0];
		expect(workspaceID).toBe('workspace-1');
		expect(copyID).toBe('copy');
		expect(copyRevision).toBe(1);
		expect(savedDocument.title).toBe('Pending café title');
		expect(savedDocument.pages.map((page) => page.name)).toEqual(['Page 1', 'Page 2']);
		expect(savedDocument.pages.map((page) => page.id)).not.toEqual(
			local.pages.map((page) => page.id)
		);
		expect(local.title).toBe('Pending café title');
	});

	it('does not attempt to save when the durable duplicate cannot be created', async () => {
		const duplicate = vi.fn().mockRejectedValue(new Error('offline'));
		const save = vi.fn();

		await expect(
			saveImageEditorConflictCopy(
				'workspace-1',
				'source',
				response('source', 4, 'Campaign').document,
				{ duplicate, save }
			)
		).rejects.toThrow('offline');
		expect(save).not.toHaveBeenCalled();
	});
});
