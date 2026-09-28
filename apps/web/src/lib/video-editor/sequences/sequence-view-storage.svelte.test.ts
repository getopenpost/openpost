import { afterEach, expect, it } from 'vitest';
import { readSequenceView, writeSequenceView } from './sequence-view-storage';

afterEach(() => localStorage.clear());
it('restores the playhead, timeline viewport and panel only in the same project and Workspace', () => {
	writeSequenceView('project-a', 'workspace-a', {
		activeSequenceId: 'motion',
		editSequenceId: null,
		currentFrame: 706,
		zoomLevel: 2.5,
		scrollPosition: 300,
		leftPanel: 'transcript'
	});
	expect(readSequenceView('project-a', 'workspace-a')).toMatchObject({
		currentFrame: 706,
		zoomLevel: 2.5,
		scrollPosition: 300,
		leftPanel: 'transcript'
	});
	expect(readSequenceView('project-b', 'workspace-a')).toBeNull();
	expect(readSequenceView('project-a', 'workspace-b')).toBeNull();
});
