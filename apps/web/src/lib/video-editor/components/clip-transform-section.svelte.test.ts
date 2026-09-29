import { expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { resolveAnimatedItemLocalAt } from '../timeline/animated-properties';
import { autoKeyframeStore } from '../timeline/stores/auto-keyframe-store.svelte';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ClipTransformSection from './clip-transform-section.svelte';
import '../../../routes/layout.css';

it.each([280, 320, 390])('keeps transform values readable in a %ipx inspector', async (width) => {
	timelineStore._setItems([
		{
			id: 'clip',
			trackId: 'visual',
			from: 0,
			durationInFrames: 90,
			type: 'text',
			text: 'Clip',
			label: 'Clip',
			color: '#ffffff',
			transform: { width: 1920, height: 1080, anchorX: 960, anchorY: 540 }
		}
	]);
	const target = document.createElement('div');
	target.style.width = `${width}px`;
	document.body.append(target);
	try {
		const screen = await render(ClipTransformSection, {
			target,
			props: { itemId: 'clip', onedit: vi.fn() }
		});
		await screen.getByRole('button', { name: 'Anchor', exact: true }).click();
		for (const name of ['Width', 'Height', 'Anchor X', 'Anchor Y']) {
			const input = screen.getByRole('textbox', { name, exact: true }).element();
			if (!(input instanceof HTMLInputElement)) throw new Error(`${name} must be an input`);
			const style = getComputedStyle(input);
			const canvas = document.createElement('canvas');
			const context = canvas.getContext('2d')!;
			context.font = style.font;
			const contentWidth =
				input.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
			expect(contentWidth, `${name} must fit ${input.value}`).toBeGreaterThanOrEqual(
				context.measureText(input.value).width
			);
			expect(input.getBoundingClientRect().right).toBeLessThanOrEqual(
				target.getBoundingClientRect().right
			);
		}
	} finally {
		target.remove();
		timelineStore.__resetForTesting();
	}
});

it('captures the starting pose with the inspector diamond, then animates and undoes the next edit', async () => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
	autoKeyframeStore.reset();
	timelineStore._setItems([
		{
			id: 'clip',
			trackId: 'visual',
			from: 30,
			durationInFrames: 90,
			type: 'text',
			label: 'Text',
			text: 'Text',
			transform: { x: 100, y: 50 }
		}
	]);
	timelineStore._setCurrentFrame(30);
	const screen = await render(ClipTransformSection, { itemId: 'clip', onedit: vi.fn() });
	await screen
		.getByRole('button', {
			name: 'Add Horizontal position keyframe',
			exact: true
		})
		.click();
	expect(commandHistory.canUndo).toBe(true);
	timelineStore._setCurrentFrame(60);
	await screen.getByRole('textbox', { name: 'Horizontal position', exact: true }).fill('400');
	await userEvent.keyboard('{Enter}');
	timelineStore._setCurrentFrame(45);
	await expect
		.element(screen.getByRole('textbox', { name: 'Horizontal position', exact: true }))
		.toHaveValue('250');
	expect(resolveAnimatedItemLocalAt(timelineStore.itemById.get('clip')!, 45).transform?.x).toBe(
		250
	);
	commandHistory.undo();
	await expect
		.element(screen.getByRole('textbox', { name: 'Horizontal position', exact: true }))
		.toHaveValue('100');
	timelineStore.__resetForTesting();
	autoKeyframeStore.reset();
});
