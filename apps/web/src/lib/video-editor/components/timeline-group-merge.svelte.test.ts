import type {} from '@vitest/browser-playwright';
import { expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { cdp, page, userEvent } from 'vitest/browser';
import { createBlankProject, createDefaultTracks } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createTrackGroup } from '../timeline/actions/tracks';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { createProject, getProject } from '../workspace-fs/projects';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '$lib/themes/builtins';
import '../../../routes/layout.css';
import TimelinePanel from './timeline-panel.svelte';

it('explains replaced group names before merging and restores structure through Undo', async () => {
	const project = createBlankProject('Named track groups');
	const tracks = createDefaultTracks();
	tracks.push({
		...tracks.find((track) => track.kind === 'audio')!,
		id: 'audio-second',
		name: 'Audio2',
		order: 3
	});
	project.timeline = { ...project.timeline!, tracks };
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	sequenceStore.load(project.timeline, project.metadata);
	const titles = createTrackGroup(['track-video-main', 'track-video-overlay'], 'Titles')!;
	const sound = createTrackGroup(['track-audio', 'audio-second'], 'Sound')!;
	commandHistory.clearHistory();
	const edited = vi.fn();
	const screen = await render(TimelinePanel, { onedit: edited });
	screen.container.style.cssText = 'width:100%;height:650px;display:flex';
	const theme = new WebThemeRuntime();
	const more = screen.getByRole('button', { name: 'Timeline: More actions', exact: true });
	const label = 'Merge tracks into one group (replaces group names)';
	try {
		await more.click();
		await expect
			.element(page.getByRole('menuitem', { name: 'Group selected tracks', exact: true }))
			.toBeDisabled();
		await userEvent.keyboard('{Escape}');
		await screen.getByRole('button', { name: 'Titles', exact: true }).click();
		await more.click();
		await expect.element(page.getByRole('menuitem', { name: label, exact: true })).toBeDisabled();
		await userEvent.keyboard('{Escape}');
		await userEvent.keyboard('{Shift>}');
		await screen.getByRole('button', { name: 'Sound', exact: true }).click();
		await userEvent.keyboard('{/Shift}');
		await more.click();
		await expect.element(page.getByRole('menuitem', { name: label, exact: true })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		for (const scheme of ['light', 'dark'] as const) {
			await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
			for (const width of [1280, 390, 320]) {
				await page.viewport(width, 844);
				await cdp().send('Emulation.setTouchEmulationEnabled', {
					enabled: width !== 1280,
					maxTouchPoints: 1
				});
				await expect.poll(() => matchMedia('(pointer:coarse)').matches).toBe(width !== 1280);
				await more.click();
				const merge = page.getByRole('menuitem', { name: label, exact: true });
				await expect.element(merge).toBeVisible();
				expect(merge.element().getBoundingClientRect().right).toBeLessThanOrEqual(width);
				expect(merge.element().getBoundingClientRect().left).toBeGreaterThanOrEqual(0);
				await page.screenshot({ path: `tge001-${scheme}-${width}.png` });
				await userEvent.keyboard('{Escape}');
			}
		}
		await more.click();
		const merge = page.getByRole('menuitem', { name: label, exact: true });
		merge.element().focus();
		await userEvent.keyboard('{Enter}');
		expect(timelineStore.tracks.filter((track) => track.isGroup)).toHaveLength(1);
		expect(timelineStore.tracks.some((track) => track.id === titles || track.id === sound)).toBe(
			false
		);
		expect(timelineStore.tracks.filter((track) => !track.isGroup)).toHaveLength(4);
		expect(edited).toHaveBeenCalledTimes(1);
		commandHistory.undo();
		expect(
			timelineStore.tracks.filter((track) => track.isGroup).map((track) => track.name)
		).toEqual(['Titles', 'Sound']);
		expect(timelineStore.tracks.filter((track) => track.parentTrackId === titles)).toHaveLength(2);
		expect(timelineStore.tracks.filter((track) => track.parentTrackId === sound)).toHaveLength(2);
		commandHistory.redo();
		const previous = getWorkspaceRoot();
		const opfs = await navigator.storage.getDirectory();
		const name = `group-merge-${crypto.randomUUID()}`;
		try {
			setWorkspaceRoot(await opfs.getDirectoryHandle(name, { create: true }));
			await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
			const loaded = (await getProject(project.id))!;
			sequenceStore.reset();
			sequenceStore.load(loaded.timeline!, loaded.metadata);
			expect(timelineStore.tracks.filter((track) => track.isGroup)).toHaveLength(1);
			expect(
				new Set(
					timelineStore.tracks.filter((track) => !track.isGroup).map((track) => track.parentTrackId)
				).size
			).toBe(1);
		} finally {
			setWorkspaceRoot(previous);
			await opfs.removeEntry(name, { recursive: true });
		}
	} finally {
		await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
		await screen.unmount();
		theme.clear(document.documentElement);
		sequenceStore.reset();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});
