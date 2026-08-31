import { beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem, TimelineTrack } from '$lib/video-editor/project/types';
import { transitionsStore } from '$lib/video-editor/timeline/actions/transitions-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import TransitionPropertiesPanel from './transition-properties-panel.svelte';
import '../../../routes/layout.css';

function track(): TimelineTrack {
	return {
		id: 'video-track',
		name: 'Video',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	};
}

function clip(id: string, from: number, sourceStart: number, sourceEnd: number): TimelineItem {
	return {
		id,
		trackId: 'video-track',
		from,
		durationInFrames: 90,
		label: id,
		type: 'video',
		sourceStart,
		sourceEnd,
		sourceDuration: 360,
		sourceFps: 30
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore.setAll({
		tracks: [track()],
		items: [clip('outgoing', 0, 0, 90), clip('incoming', 90, 90, 180)],
		fps: 30
	});
	transitionsStore.setAll([
		{
			id: 'transition',
			type: 'crossfade',
			presentation: 'fade',
			timing: 'linear',
			durationInFrames: 30,
			alignment: 0.5,
			fromItemId: 'outgoing',
			toItemId: 'incoming'
		}
	]);
});

describe('TransitionPropertiesPanel', () => {
	it('selects the active transition and filters localized names', async () => {
		const screen = await render(TransitionPropertiesPanel, {
			transitionId: 'transition',
			onedit: vi.fn()
		});
		await page.screenshot({
			element: screen.container,
			path: '../../../../.svelte-kit/openpost-transition-properties.png'
		});
		expect(screen.getByRole('button', { name: 'Fade', exact: true }).element()).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		await screen.getByRole('searchbox', { name: 'Search transitions' }).fill('iris');
		expect(screen.getByRole('button', { name: 'Diamond iris', exact: true })).toBeVisible();
		await screen.getByRole('searchbox', { name: 'Search transitions' }).fill('diptocolordissolve');
		expect(screen.getByRole('button', { name: 'Dip to color', exact: true })).toBeVisible();

		await screen.getByRole('searchbox', { name: 'Search transitions' }).fill('not a preset');
		expect(screen.getByText('No transitions match this search.')).toBeVisible();
	});

	it('resets duration and individual renderer controls to registry defaults', async () => {
		transitionsStore.setAll([
			{
				...transitionsStore.list[0]!,
				presentation: 'filmGateSlip',
				durationInFrames: 12,
				properties: { slip: 0.2 }
			}
		]);
		const onedit = vi.fn();
		const screen = await render(TransitionPropertiesPanel, {
			transitionId: 'transition',
			onedit
		});

		await screen.getByRole('button', { name: 'Reset Transition duration' }).click();
		// The registry default is 30 frames; available source handles cap this pair at 22.
		expect(transitionsStore.list[0]?.durationInFrames).toBe(22);
		await screen.getByRole('button', { name: 'Reset Slip' }).click();
		expect(transitionsStore.list[0]?.properties?.slip).toBe(1);
		expect(commandHistory.undoStack).toHaveLength(2);
		expect(onedit).toHaveBeenCalledTimes(2);
	});

	it('switches renderer and writes its exact default controls as one edit', async () => {
		const onedit = vi.fn();
		const screen = await render(TransitionPropertiesPanel, {
			transitionId: 'transition',
			onedit
		});
		await screen.getByRole('button', { name: 'Film gate slip', exact: true }).click();

		expect(transitionsStore.list[0]).toMatchObject({
			presentation: 'filmGateSlip',
			type: 'crossfade',
			properties: {
				slip: 1,
				shake: 1,
				exposure: 0.85,
				gateWidth: 0.075,
				grain: 0.6,
				chroma: 0.55,
				roll: 0.75
			}
		});
		expect(commandHistory.getLastCommandType()).toBe('UPDATE_TRANSITION');
		expect(commandHistory.undoStack).toHaveLength(1);
		expect(onedit).toHaveBeenCalledOnce();

		commandHistory.undo();
		expect(transitionsStore.list[0]?.presentation).toBe('fade');
	});

	it('edits placement and removes the selected transition', async () => {
		const onedit = vi.fn();
		const onremove = vi.fn();
		const screen = await render(TransitionPropertiesPanel, {
			transitionId: 'transition',
			onedit,
			onremove
		});
		await screen.getByRole('button', { name: 'Before cut', exact: true }).click();
		expect(transitionsStore.list[0]).toMatchObject({ alignment: 1, durationInFrames: 30 });

		await screen.getByRole('button', { name: 'Remove transition', exact: true }).click();
		expect(transitionsStore.list).toEqual([]);
		expect(onremove).toHaveBeenCalledOnce();
		expect(onedit).toHaveBeenCalledTimes(2);
	});
});
