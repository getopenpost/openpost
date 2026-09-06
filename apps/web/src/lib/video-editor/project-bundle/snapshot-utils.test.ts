import { describe, expect, it } from 'vitest';
import { createBlankProject } from '../project/defaults';
import { PROJECT_SNAPSHOT_VERSION, type ProjectSnapshot } from './snapshot-types';
import {
	computeSnapshotChecksum,
	sanitizeSnapshotFileName,
	validateProjectSnapshot,
	verifySnapshotChecksum
} from './snapshot-utils';

function snapshot(): ProjectSnapshot {
	return {
		version: PROJECT_SNAPSHOT_VERSION,
		exportedAt: '2026-08-24T00:00:00.000Z',
		editorVersion: 'test',
		project: createBlankProject('Launch'),
		mediaReferences: []
	};
}

describe('project snapshot validation', () => {
	it('accepts every current timeline item kind and preserves transition presentations', () => {
		const candidate = snapshot();
		const trackId = candidate.project.timeline!.tracks[0]!.id;
		const itemKinds = [
			'video',
			'audio',
			'image',
			'lottie',
			'text',
			'subtitle',
			'shape',
			'adjustment',
			'controller',
			'composition'
		] as const;
		candidate.project.timeline!.items = itemKinds.map((type, index) => ({
			id: `item-${type}`,
			trackId,
			from: index * 30,
			durationInFrames: 30,
			label: type,
			type
		}));
		candidate.project.timeline!.transitions = [
			{
				id: 'transition-x-wipe',
				type: 'crossfade',
				presentation: 'xWipe',
				timing: 'ease-in-out',
				durationInFrames: 12,
				fromItemId: 'item-video',
				toItemId: 'item-image'
			}
		];

		const result = validateProjectSnapshot(candidate);

		expect(result.errors).toEqual([]);
		expect(result.snapshot?.project.timeline?.items.map((item) => item.type)).toEqual(itemKinds);
		expect(result.snapshot?.project.timeline?.transitions?.[0]?.presentation).toBe('xWipe');
	});

	it('rejects malformed timeline data with a useful path', () => {
		const candidate = snapshot();
		candidate.project.timeline!.items = [
			{
				id: '',
				trackId: '',
				from: -1,
				durationInFrames: -2,
				label: 'bad',
				type: 'video'
			}
		];
		const result = validateProjectSnapshot(candidate);
		expect(result.snapshot).toBeUndefined();
		expect(result.errors.some((error) => error.startsWith('project.timeline.items.0.id:'))).toBe(
			true
		);
		expect(
			result.errors.some((error) => error.startsWith('project.timeline.items.0.durationInFrames:'))
		).toBe(true);
	});

	it('detects changes to a signed snapshot', async () => {
		const candidate = snapshot();
		candidate.checksum = await computeSnapshotChecksum(candidate);
		expect(await verifySnapshotChecksum(candidate)).toBe(true);
		candidate.project.name = 'Changed';
		expect(await verifySnapshotChecksum(candidate)).toBe(false);
	});

	it('creates safe OpenPost snapshot filenames', () => {
		expect(sanitizeSnapshotFileName('Launch: Q3 / Final')).toBe('Launch_ Q3 _ Final.openpost.json');
	});
});
