import { beforeEach, describe, expect, it } from 'vitest';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createBlankProject } from './defaults';
import type { SubComposition } from './types';
import {
	resetProjectCanvasDimensions,
	swapProjectCanvasDimensions,
	updateProjectCanvas
} from './canvas-settings';

describe('project canvas settings', () => {
	beforeEach(() => {
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		const project = createBlankProject('Canvas');
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
	});

	it('updates, swaps, resets, and restores project metadata through history', () => {
		expect(updateProjectCanvas({ width: 1080, height: 1920, backgroundColor: '#123456' })).toBe(
			true
		);
		expect(editorSession.project?.metadata).toEqual({
			width: 1080,
			height: 1920,
			fps: 30,
			backgroundColor: '#123456'
		});
		expect(swapProjectCanvasDimensions()).toBe(true);
		expect(editorSession.project?.metadata).toMatchObject({ width: 1920, height: 1080 });
		commandHistory.undo();
		expect(editorSession.project?.metadata).toMatchObject({ width: 1080, height: 1920 });
		commandHistory.redo();
		expect(editorSession.project?.metadata).toMatchObject({ width: 1920, height: 1080 });
		expect(resetProjectCanvasDimensions()).toBe(false);
	});

	it('rejects invalid values without history', () => {
		expect(updateProjectCanvas({ width: 319 })).toBe(false);
		expect(updateProjectCanvas({ height: 4321 })).toBe(false);
		expect(updateProjectCanvas({ backgroundColor: 'red' })).toBe(false);
		expect(commandHistory.undoStack).toHaveLength(0);
	});

	it('does not change the project canvas from a nested sequence', () => {
		const nested: SubComposition = {
			id: 'nested',
			name: 'Nested',
			items: [],
			tracks: [],
			transitions: [],
			fps: 30,
			width: 1080,
			height: 1920,
			durationInFrames: 0
		};
		sequenceStore.addComposition(nested, true);
		sequenceStore.switchTo(nested.id);

		expect(updateProjectCanvas({ width: 1280 })).toBe(false);
		expect(editorSession.project?.metadata.width).toBe(1920);
		expect(commandHistory.undoStack).toHaveLength(0);
	});
});
