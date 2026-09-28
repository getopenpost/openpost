import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import TimelinePanel from './timeline-panel.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { createDefaultTracks } from '../project/defaults';

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
