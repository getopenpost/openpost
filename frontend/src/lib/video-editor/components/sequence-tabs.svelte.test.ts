import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { createEmptyTimeline } from '$lib/video-editor/project/defaults';
import type { SubComposition } from '$lib/video-editor/project/types';
import { sequenceStore } from '$lib/video-editor/sequences/sequence-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import SequenceTabs from './sequence-tabs.svelte';

function composition(id: string, name: string): SubComposition {
	return {
		id,
		name,
		items: [],
		tracks: [],
		transitions: [],
		fps: 30,
		width: 1920,
		height: 1080,
		durationInFrames: 0
	};
}

beforeEach(() => {
	commandHistory.clearHistory();
	sequenceStore.reset();
	sequenceStore.load(createEmptyTimeline(), { width: 1920, height: 1080, fps: 30 });
	sequenceStore.addComposition(composition('alpha', 'Alpha'), true);
	sequenceStore.addComposition(composition('beta', 'Beta'), true);
});

afterEach(() => sequenceStore.reset());

describe('SequenceTabs', () => {
	it('runs sequence actions from the tab context menu', async () => {
		const onedit = vi.fn();
		const onswitch = vi.fn();
		const screen = await render(SequenceTabs, { onedit, onswitch });
		const openMenu = (name: string) => {
			const trigger = screen.getByRole('group', { name, exact: true }).element();
			trigger.dispatchEvent(
				new MouseEvent('contextmenu', {
					bubbles: true,
					cancelable: true,
					clientX: 80,
					clientY: 40
				})
			);
		};

		openMenu('Beta');
		await screen.getByRole('menuitem', { name: 'Move left' }).click();
		expect(sequenceStore.topLevelSequenceIds).toEqual(['beta', 'alpha']);

		openMenu('Beta');
		await screen.getByRole('menuitem', { name: 'Duplicate' }).click();
		const duplicate = sequenceStore.compositions.find((entry) => entry.name === 'Beta copy');
		expect(duplicate).toBeDefined();
		expect(sequenceStore.activeSequenceId).toBe(duplicate?.id);

		openMenu('Beta');
		await screen.getByRole('menuitem', { name: 'Rename' }).click();
		await vi.waitFor(() =>
			expect(screen.container.querySelector<HTMLInputElement>('input')).not.toBeNull()
		);
		const rename = screen.container.querySelector<HTMLInputElement>('input');
		expect(rename).not.toBeNull();
		if (!rename) return;
		rename.value = 'B roll';
		rename.dispatchEvent(new InputEvent('input', { bubbles: true }));
		rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await vi.waitFor(() => expect(sequenceStore.compositionById.get('beta')?.name).toBe('B roll'));

		openMenu('B roll');
		await screen.getByRole('menuitem', { name: 'Open sequence' }).click();
		expect(sequenceStore.activeSequenceId).toBe('beta');

		openMenu('B roll');
		await screen.getByRole('menuitem', { name: 'Close tab' }).click();
		expect(sequenceStore.topLevelSequenceIds).not.toContain('beta');
		expect(sequenceStore.compositionById.get('beta')?.name).toBe('B roll');
		expect(onedit).toHaveBeenCalledTimes(4);
		expect(onswitch).toHaveBeenCalledTimes(3);
	});

	it('switches, reorders, renames, adds, and closes tabs in Chromium', async () => {
		const onedit = vi.fn();
		const onswitch = vi.fn();
		const screen = await render(SequenceTabs, { onedit, onswitch });

		await screen.getByRole('button', { name: 'Alpha', exact: true }).click();
		expect(sequenceStore.activeSequenceId).toBe('alpha');
		expect(onswitch).toHaveBeenCalledTimes(1);

		const alpha = screen.getByRole('button', { name: 'Alpha', exact: true }).element();
		alpha.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'ArrowRight', altKey: true, bubbles: true })
		);
		expect(sequenceStore.topLevelSequenceIds).toEqual(['beta', 'alpha']);

		screen
			.getByRole('button', { name: 'Alpha', exact: true })
			.element()
			.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await vi.waitFor(() =>
			expect(screen.container.querySelector<HTMLInputElement>('input')).not.toBeNull()
		);
		const rename = screen.container.querySelector<HTMLInputElement>('input');
		expect(rename).not.toBeNull();
		if (!rename) return;
		rename.value = 'Opening';
		rename.dispatchEvent(new InputEvent('input', { bubbles: true }));
		rename.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		await expect
			.element(screen.getByRole('button', { name: 'Opening', exact: true }))
			.toBeVisible();
		expect(sequenceStore.compositionById.get('alpha')?.name).toBe('Opening');

		await screen.getByRole('button', { name: 'New sequence' }).click();
		expect(sequenceStore.compositions).toHaveLength(3);
		expect(sequenceStore.activeSequenceId).not.toBe('alpha');

		await screen.getByRole('button', { name: 'Close tab: Beta' }).click();
		expect(sequenceStore.topLevelSequenceIds).not.toContain('beta');
		expect(onedit).toHaveBeenCalled();
	});
});
