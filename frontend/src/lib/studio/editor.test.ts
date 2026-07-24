import { describe, expect, it } from 'vitest';
import { blankStudioDocument } from './document';
import { StudioEditor } from './editor.svelte';
import type { StudioDocumentResponse, StudioPreset } from './types';

const preset: StudioPreset = {
	key: 'instagram-square',
	name: 'Instagram square',
	width_px: 1080,
	height_px: 1080,
	default_format: 'png',
	profiles: ['instagram']
};

function response(): StudioDocumentResponse {
	return {
		id: 'design-1',
		workspace_id: 'workspace-1',
		created_by_id: 'user-1',
		revision: 1,
		can_edit: true,
		created_at: '2026-07-24T10:00:00Z',
		updated_at: '2026-07-24T10:00:00Z',
		document: blankStudioDocument(preset)
	};
}

describe('Studio editor viewport fitting', () => {
	it('keeps useful canvas space in short landscape viewports', () => {
		const editor = new StudioEditor();
		editor.load(response());

		editor.fitZoom(300, 220);

		expect(editor.zoom).toBeCloseTo((220 - 35.2) / 1080);
		expect(editor.panX).toBe(0);
		expect(editor.panY).toBe(0);
	});

	it('retains the full desktop pasteboard padding', () => {
		const editor = new StudioEditor();
		editor.load(response());

		editor.fitZoom(1200, 900);

		expect(editor.zoom).toBeCloseTo((900 - 80) / 1080);
	});
});
