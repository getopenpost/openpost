import { afterEach, expect, it } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '$lib/video-editor/project/types';
import { transitionRegistry } from '$lib/video-editor/transitions';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import {
	addTransition,
	transitionsStore,
	updateTransition
} from '$lib/video-editor/timeline/actions/transitions.svelte';
import TransitionPropertiesPanel from './transition-properties-panel.svelte';

afterEach(() => {
	timelineStore.__resetForTesting();
	transitionsStore.clear();
	commandHistory.clearHistory();
});

it('resets changed transition parameters through the panel', async () => {
	const clip = (id: string, from: number): TimelineItem => ({
		id,
		trackId: 'track-video-main',
		from,
		durationInFrames: 60,
		label: id,
		type: 'video',
		mediaId: 'media-1',
		sourceStart: 30,
		sourceEnd: 90,
		sourceDuration: 120,
		sourceFps: 30
	});
	timelineStore._setItems([clip('left', 0), clip('right', 60)]);
	const id = addTransition('left', 'right', 'crossfade', 15, {
		presentation: 'blurDissolve'
	});
	const definition = transitionRegistry.getDefinition('blurDissolve');
	const parameter = definition?.parameters?.[0];
	if (!parameter || typeof parameter.defaultValue !== 'number') {
		throw new Error('Expected a numeric blur transition parameter');
	}
	const changedValue = parameter.defaultValue + 0.1;
	expect(updateTransition(id, { properties: { [parameter.key]: changedValue } })).toBe(true);

	const screen = await render(TransitionPropertiesPanel, { transitionId: id, onedit: () => {} });
	await screen.getByRole('button', { name: 'Reset effect controls' }).click();
	expect(transitionsStore.list[0]?.properties?.[parameter.key]).toBe(parameter.defaultValue);
});
