import { expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import TimelinePanel from './timeline-panel.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { mediaPool } from '../media/pool.svelte';
import { planMixdown } from '../media/render-plan';
import '../../../routes/layout.css';

it.each([1280, 320])(
	'detaches and relinks audio through the keyboard menu at %ipx',
	async (width) => {
		await page.viewport(width, 720);
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
		timelineStore._setTracks(createDefaultTracks());
		mediaPool.loadAll([
			{
				id: 'speech-media',
				storageType: 'cloud',
				remoteUrl: '/speech.mp4',
				fileName: 'speech.mp4',
				fileSize: 100,
				mimeType: 'video/mp4',
				duration: 4,
				width: 640,
				height: 360,
				fps: 30,
				codec: 'avc',
				audioCodec: 'aac',
				hasAudio: true,
				bitrate: 1000,
				tags: []
			}
		]);
		timelineStore._setItems([
			{
				id: 'speech',
				type: 'video',
				label: 'Speech',
				mediaId: 'speech-media',
				trackId: 'track-video-main',
				from: 30,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				sourceFps: 30,
				volume: 0.5,
				keyframes: { volume: { frames: [0, 59], values: [0.5, 0.8] } }
			}
		]);
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		screen.container.style.cssText = 'width:100%;height:650px;display:flex';
		try {
			await screen.getByRole('button', { name: /^Speech\. Drag/ }).click();
			await userEvent.keyboard('{Shift>}{F10}{/Shift}');
			await expect.element(page.getByRole('menuitem', { name: /^Copy/ })).toBeVisible();
			const detach = page.getByRole('menuitem', { name: 'Detach audio', exact: true });
			await expect
				.poll(() => detach.element().getBoundingClientRect().left)
				.toBeGreaterThanOrEqual(0);
			await expect
				.poll(() => detach.element().getBoundingClientRect().right)
				.toBeLessThanOrEqual(width);
			await detach.click();
			const audio = timelineStore.items.find((item) => item.type === 'audio')!;
			expect(audio).toMatchObject({
				from: 30,
				durationInFrames: 60,
				sourceStart: 30,
				sourceEnd: 90,
				volume: 0.5
			});
			expect(audio.linkedGroupId).toBe(timelineStore.itemById.get('speech')?.linkedGroupId);
			await screen
				.getByRole('button', { name: /^Speech\. Drag/ })
				.first()
				.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Unlink selected clips', exact: true }).click();
			expect(timelineStore.items.every((item) => !item.linkedGroupId)).toBe(true);
			expect(
				planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
			).toEqual([audio.id]);
			await screen
				.getByRole('button', { name: /^Speech\. Drag/ })
				.first()
				.click({ button: 'right' });
			await page.getByRole('menuitem', { name: 'Link selected clips', exact: true }).click();
			expect(timelineStore.itemById.get(audio.id)?.linkedGroupId).toBe(
				timelineStore.itemById.get('speech')?.linkedGroupId
			);
			commandHistory.undo();
			commandHistory.undo();
			commandHistory.undo();
			expect(timelineStore.items).toHaveLength(1);
			expect(
				planMixdown(timelineStore.items, timelineStore.tracks, 30).map((entry) => entry.itemId)
			).toEqual(['speech']);
		} finally {
			await screen.unmount();
			await page.viewport(1280, 900);
			mediaPool.clear();
			timelineStore.__resetForTesting();
			commandHistory.clearHistory();
		}
	}
);

it('selects clips with the select-all shortcut without selecting locked clips', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(
		createDefaultTracks().map((track) => ({
			...track,
			locked: track.id === 'track-video-overlay'
		}))
	);
	timelineStore._setItems(
		['first', 'second', 'locked'].map((id, index) => ({
			id,
			type: 'text',
			text: id,
			label: id,
			trackId: index === 2 ? 'track-video-overlay' : 'track-video-main',
			from: index * 60,
			durationInFrames: 30
		}))
	);
	try {
		const screen = await render(TimelinePanel, { onedit: vi.fn() });
		const first = screen.getByRole('button', { name: /^first\. Drag/ });
		await first.click();
		const modifier = navigator.platform.includes('Mac') ? 'Meta' : 'Control';
		await userEvent.keyboard(`{${modifier}>}a{/${modifier}}`);
		await expect
			.element(screen.getByRole('button', { name: /^second\. Drag/ }))
			.toHaveAttribute('aria-pressed', 'true');
		await expect
			.element(screen.getByRole('button', { name: /^locked\. Drag/ }))
			.toHaveAttribute('aria-pressed', 'false');
	} finally {
		timelineStore.__resetForTesting();
	}
});

it('shows fade handles only for the selected clip, including on hover', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	timelineStore._setItems(
		['first', 'second'].map((id, index) => ({
			id,
			type: 'video',
			label: id,
			trackId: 'track-video-main',
			from: index * 60,
			durationInFrames: 60
		}))
	);
	const screen = await render(TimelinePanel, { onedit: vi.fn() });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		await screen.getByRole('button', { name: /^first\. Drag/ }).click();
		await userEvent.hover(screen.getByRole('button', { name: /^second\. Drag/ }));
		await expect
			.poll(() => screen.getByRole('slider', { name: 'Adjust video fade in' }).all().length)
			.toBe(1);
		await screen.getByRole('button', { name: /^second\. Drag/ }).click();
		await expect
			.poll(() => screen.getByRole('slider', { name: 'Adjust video fade in' }).all().length)
			.toBe(1);
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});

it('reorders tracks by dragging their names and restores the order with one undo', async () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	timelineStore._setTracks(createDefaultTracks());
	const onedit = vi.fn();
	const screen = await render(TimelinePanel, { onedit });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		await screen
			.getByRole('button', { name: 'Visual 1', exact: true })
			.dropTo(screen.getByRole('button', { name: 'Visual 2', exact: true }));
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.name)
		).toEqual(['Visual 1', 'Visual 2', 'Audio']);
		expect(onedit).toHaveBeenCalledOnce();
		commandHistory.undo();
		expect(
			timelineStore.tracks.toSorted((a, b) => a.order - b.order).map((track) => track.name)
		).toEqual(['Visual 2', 'Visual 1', 'Audio']);
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
		commandHistory.clearHistory();
	}
});

it('keeps a compact row drag stable over a taller row and cancels without saving', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(
		createDefaultTracks()
			.reverse()
			.map((track) => ({
				...track,
				height: track.id === 'track-video-overlay' ? 48 : 96
			}))
	);
	const source = timelineStore.tracks;
	const onedit = vi.fn();
	const screen = await render(TimelinePanel, { onedit });
	screen.container.style.cssText = 'width:1000px;height:400px;display:flex';
	try {
		const handle = screen.getByRole('button', { name: 'Visual 2', exact: true }).element();
		const row = handle.closest<HTMLElement>('[data-track]')!;
		const top = row.getBoundingClientRect().top;
		const pointer = (type: string, target: EventTarget, y: number) =>
			target.dispatchEvent(
				new PointerEvent(type, {
					pointerId: 1,
					button: 0,
					bubbles: true,
					cancelable: true,
					clientY: top + y
				})
			);
		const rows = () =>
			[...screen.container.querySelectorAll<HTMLElement>('[data-track]')].map(
				(row) => row.dataset.track
			);
		pointer('pointerdown', handle, 12);
		pointer('pointermove', window, 80);
		await tick();
		expect(rows()).toEqual(['track-video-main', 'track-video-overlay', 'track-audio']);
		pointer('pointermove', window, 81);
		await tick();
		expect(rows()).toEqual(['track-video-main', 'track-video-overlay', 'track-audio']);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
		window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		pointer('pointerup', window, 81);
		await tick();
		expect(rows()).toEqual(['track-video-overlay', 'track-video-main', 'track-audio']);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
		pointer('pointerdown', handle, 12);
		pointer('pointermove', window, 80);
		await tick();
		pointer('pointermove', window, 20);
		await tick();
		pointer('pointerup', window, 20);
		expect(timelineStore.tracks).toBe(source);
		expect(onedit).not.toHaveBeenCalled();
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});

it('keeps focus on the track name after keyboard reordering', async () => {
	timelineStore.__resetForTesting();
	timelineStore._setTracks(createDefaultTracks());
	const screen = await render(TimelinePanel, { onedit: vi.fn() });
	try {
		const track = screen.getByRole('button', { name: 'Visual 2', exact: true });
		track.element().focus();
		await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
		expect(timelineStore.tracks.toSorted((a, b) => a.order - b.order)[1]!.name).toBe('Visual 2');
		await expect.element(track).toHaveFocus();
	} finally {
		await screen.unmount();
		timelineStore.__resetForTesting();
	}
});
