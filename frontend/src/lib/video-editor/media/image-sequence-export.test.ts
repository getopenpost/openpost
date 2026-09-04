import { describe, expect, it } from 'vitest';
import {
	formatSequenceFileName,
	sanitizeSequenceBaseName,
	resolveSequenceRange,
	estimateSequenceBytes,
	isZipFallbackSafe,
	ZIP_MAX_FRAMES
} from './image-sequence-export';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';

function projectWithDuration(frameCount: number, fps = 30): Project {
	const track: TimelineTrack = {
		id: 't',
		name: 'Video',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
	const item: TimelineItem = {
		id: 'i',
		trackId: track.id,
		from: 0,
		durationInFrames: frameCount,
		label: 'Clip',
		type: 'shape',
		shapeType: 'rectangle',
		fillEnabled: true,
		fillColor: '#ff0000',
		transform: { width: 16, height: 16 }
	};
	return {
		id: 'p',
		name: 'My Project',
		description: '',
		createdAt: 0,
		updatedAt: 0,
		duration: frameCount / fps,
		metadata: { width: 16, height: 16, fps },
		timeline: { tracks: [track], items: [item] }
	};
}

describe('image sequence naming and ranges', () => {
	it('sanitizes base names and preserves fallback', () => {
		expect(sanitizeSequenceBaseName('My Project')).toBe('My Project');
		expect(sanitizeSequenceBaseName('')).toBe('sequence');
		expect(sanitizeSequenceBaseName('a/b:c')).toBe('a_b_c');
	});

	it('estimates bytes and gates ZIP fallback correctly', () => {
		expect(isZipFallbackSafe('png', 1920, 1080, 10)).toBe(true);
		expect(isZipFallbackSafe('webp', 1920, 1080, 10)).toBe(true);
		expect(isZipFallbackSafe('png', 1920, 1080, ZIP_MAX_FRAMES + 1)).toBe(false);
		expect(isZipFallbackSafe('jpeg', 3840, 2160, 2000)).toBe(false);
		expect(estimateSequenceBytes('png', 16, 16, 2)).toBeGreaterThan(0);
		expect(estimateSequenceBytes('jpeg', 16, 16, 2)).toBeLessThan(
			estimateSequenceBytes('png', 16, 16, 2)
		);
		expect(estimateSequenceBytes('webp', 16, 16, 2)).toBeGreaterThan(
			estimateSequenceBytes('jpeg', 16, 16, 2)
		);
		expect(estimateSequenceBytes('webp', 16, 16, 2)).toBeLessThan(
			estimateSequenceBytes('png', 16, 16, 2)
		);
	});
});
