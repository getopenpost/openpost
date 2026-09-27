import { describe, expect, it } from 'vitest';
import { chaptersFromMarkers } from './chapters';
import type { TimelineMarker } from '../project/types';
const marker = (frame: number, label: string, kind?: 'beat'): TimelineMarker => ({
	id: String(frame),
	frame,
	label,
	color: '#fff',
	kind
});
describe('export chapters', () => {
	it('sorts named markers, excludes beats and outside points, and collapses duplicate seconds', () => {
		expect(
			chaptersFromMarkers(
				[
					marker(600, 'End'),
					marker(330, ' Demo\npart  two '),
					marker(0, 'Intro'),
					marker(331, 'Duplicate'),
					marker(60, ''),
					marker(90, 'Beat', 'beat')
				],
				30,
				{ startFrame: 0, endFrame: 600 }
			)
		).toBe('00:00 Intro\n00:11 Demo part two');
	});
	it('rebases a trimmed export and carries the chapter in progress to zero', () => {
		expect(
			chaptersFromMarkers([marker(0, 'Intro'), marker(120, 'Setup'), marker(450, 'Demo')], 30, {
				startFrame: 300,
				endFrame: 900
			})
		).toBe('00:00 Setup\n00:05 Demo');
	});
	it('formats long exports and uses the selected sequence frame rate', () => {
		expect(
			chaptersFromMarkers([marker(0, 'Start'), marker(90000, 'Next')], 25, {
				startFrame: 0,
				endFrame: 100000
			})
		).toBe('00:00 Start\n1:00:00 Next');
	});
});
