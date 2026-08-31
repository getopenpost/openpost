import { describe, expect, it } from 'vitest';
import { createBlankProject } from './defaults';
import {
	buildProjectDetailsUpdate,
	isValidProjectDetails,
	projectDetailsChanged
} from './project-details';

describe('project details', () => {
	it('builds a bounded update while preserving unrelated metadata', () => {
		const project = createBlankProject('Draft');
		project.metadata.backgroundColor = '#123456';
		project.timeline!.items = [
			{
				id: 'clip',
				trackId: 'track-video-main',
				from: 10,
				durationInFrames: 110,
				label: 'Clip',
				type: 'video'
			}
		];

		const update = buildProjectDetailsUpdate(project, {
			name: '  Launch cut  ',
			description: '  Approved vertical edit  ',
			width: 1080,
			height: 1920,
			fps: 60
		});

		expect(update).toEqual({
			name: 'Launch cut',
			description: 'Approved vertical edit',
			metadata: { width: 1080, height: 1920, fps: 60, backgroundColor: '#123456' },
			duration: 2
		});
		expect(projectDetailsChanged(project, update!)).toBe(true);
	});

	it('rejects blank, oversized, and unsupported values', () => {
		expect(
			isValidProjectDetails({ name: ' ', description: '', width: 1920, height: 1080, fps: 30 })
		).toBe(false);
		expect(
			isValidProjectDetails({
				name: 'Project',
				description: 'x'.repeat(501),
				width: 1920,
				height: 1080,
				fps: 30
			})
		).toBe(false);
		expect(
			isValidProjectDetails({
				name: 'Project',
				description: '',
				width: 1920,
				height: 1080,
				fps: 29
			})
		).toBe(false);
		expect(
			isValidProjectDetails({
				name: 'Legacy high frame rate',
				description: '',
				width: 1920,
				height: 1080,
				fps: 120
			})
		).toBe(true);
	});
});
