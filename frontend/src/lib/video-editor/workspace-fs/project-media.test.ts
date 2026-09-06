import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { collectProjectTimelineMediaIds } from './project-media';

describe('project media references', () => {
	it('retains project-owned fonts used by text and spans', () => {
		const project = createBlankProject();
		project.timeline!.items = [
			{
				id: 'title',
				trackId: 'track',
				from: 0,
				durationInFrames: 30,
				label: 'Title',
				type: 'text',
				fontAssetId: 'font-title',
				textSpans: [{ text: 'Launch', fontAssetId: 'font-span' }]
			}
		];

		expect(collectProjectTimelineMediaIds(project)).toEqual(['font-title', 'font-span']);
	});

	it('retains reusable project font assets even when no text currently uses them', () => {
		const project = createBlankProject();
		project.fontAssets = [
			{
				id: 'font-library',
				family: 'Launch Sans',
				weight: 400,
				style: 'normal'
			}
		];

		expect(collectProjectTimelineMediaIds(project)).toEqual(['font-library']);
	});
});
