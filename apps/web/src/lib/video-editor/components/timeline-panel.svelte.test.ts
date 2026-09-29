import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { tick } from 'svelte';
import { render } from 'vitest-browser-svelte';
import TimelinePanel from './timeline-panel.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import '../../../routes/layout.css';

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
