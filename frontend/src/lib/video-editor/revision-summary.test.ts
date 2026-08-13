import { createBlankVideoProject } from '@openpost/video-project';
import { describe, expect, it } from 'vitest';
import { summarizeVideoEditorRevision, videoEditorRevisionHasChanges } from './revision-summary';

describe('OpenPost Video Editor revision summaries', () => {
	it('reports changes in the document domains users edit', () => {
		const current = createBlankVideoProject('Current');
		const target = structuredClone(current);
		target.title = 'Target';
		target.export_defaults.video_bitrate += 1_000_000;
		target.markers.push({ id: 'marker', time_us: 0, label: 'Start', color: '#ffffff' });

		const summary = summarizeVideoEditorRevision(current, target);
		expect(summary).toMatchObject({
			titleChanged: true,
			exportSettingsChanged: true,
			sourcesAdded: 0,
			primaryItemsChanged: 1
		});
		expect(videoEditorRevisionHasChanges(summary)).toBe(true);
	});

	it('recognizes an identical project', () => {
		const current = createBlankVideoProject('Same');
		expect(videoEditorRevisionHasChanges(summarizeVideoEditorRevision(current, current))).toBe(
			false
		);
	});

	it('keeps a cover-only revision restorable', () => {
		const current = createBlankVideoProject('Same document');
		const summary = summarizeVideoEditorRevision(current, current, {
			currentCoverSourceID: 'current-cover-source',
			targetCoverSourceID: 'target-cover-source'
		});
		expect(summary.coverChanged).toBe(true);
		expect(videoEditorRevisionHasChanges(summary)).toBe(true);
	});

	it('keeps timeline and track reorder-only revisions restorable', () => {
		const current = createBlankVideoProject('Ordered');
		current.sources = {
			first: {
				id: 'first',
				kind: 'video',
				locator: { type: 'openpost-media', media_id: 'media-first' },
				original_name: 'first.mp4',
				mime_type: 'video/mp4',
				size_bytes: 1,
				duration_us: 1_000_000,
				width: 100,
				height: 100,
				rotation: 0
			},
			second: {
				id: 'second',
				kind: 'video',
				locator: { type: 'openpost-media', media_id: 'media-second' },
				original_name: 'second.mp4',
				mime_type: 'video/mp4',
				size_bytes: 1,
				duration_us: 1_000_000,
				width: 100,
				height: 100,
				rotation: 0
			}
		};
		current.primary_sequence = [
			{ id: 'first-gap', kind: 'gap', duration_us: 1_000_000 },
			{ id: 'second-gap', kind: 'gap', duration_us: 1_000_000 }
		];
		current.visual_tracks = [
			{ id: 'back-track', name: 'Back', locked: false, hidden: false, items: [] },
			{ id: 'front-track', name: 'Front', locked: false, hidden: false, items: [] }
		];
		const target = structuredClone(current);
		target.primary_sequence.reverse();
		target.visual_tracks.reverse();

		const summary = summarizeVideoEditorRevision(current, target);
		expect(summary.primaryItemsChanged).toBe(2);
		expect(summary.visualItemsChanged).toBe(2);
		expect(videoEditorRevisionHasChanges(summary)).toBe(true);
	});
});
