import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import Fixture from './timeline-selection.fixture.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore._setSnapEnabled(false);
	timelineStore._setTracks([
		{
			id: 'visual',
			name: 'Visual',
			kind: 'video',
			height: 64,
			locked: false,
			visible: true,
			muted: false,
			solo: false,
			order: 0
		}
	]);
	timelineStore._setItems(
		['first', 'second', 'third'].map((id, index) => ({
			id,
			label: id,
			type: 'text',
			text: id,
			color: '#ffffff',
			trackId: 'visual',
			from: index * 120,
			durationInFrames: 90
		}))
	);
});
afterEach(() => timelineStore.__resetForTesting());

it('adds and removes clips with Shift-click', async () => {
	const screen = await render(Fixture, { onedit: vi.fn() });
	const first = screen.getByRole('button', { name: /^first\./ });
	const third = screen.getByRole('button', { name: /^third\./ });
	await first.click();
	await userEvent.keyboard('{Shift>}');
	await third.click();
	await userEvent.keyboard('{/Shift}');
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent('first,third');
	await userEvent.keyboard('{Shift>}');
	await third.click();
	await userEvent.keyboard('{/Shift}');
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent('first');
});

it('narrows a group on a plain click without authoring an edit', async () => {
	const onedit = vi.fn();
	const screen = await render(Fixture, { onedit });
	const first = screen.getByRole('button', { name: /^first\./ });
	const third = screen.getByRole('button', { name: /^third\./ });
	await first.click();
	await userEvent.keyboard('{Control>}');
	await third.click();
	await userEvent.keyboard('{/Control}');
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent('first,third');
	await first.click();
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent(/^first$/);
	expect(onedit).not.toHaveBeenCalled();
});

it('preserves a group through drag preview and cancellation, then commits it together', async () => {
	const onedit = vi.fn();
	const screen = await render(Fixture, { onedit });
	await screen.getByRole('button', { name: /^first\./ }).click();
	await userEvent.keyboard('{Control>}');
	await screen.getByRole('button', { name: /^third\./ }).click();
	await userEvent.keyboard('{/Control}');
	const clip = screen.getByRole('button', { name: /^first\./ }).element();
	const rect = clip.getBoundingClientRect();
	const x = rect.left + rect.width / 2;
	const y = rect.top + rect.height / 2;
	const pointer = (type: string, target: EventTarget, offset: number) =>
		target.dispatchEvent(
			new PointerEvent(type, {
				pointerId: 1,
				button: 0,
				bubbles: true,
				cancelable: true,
				clientX: x + offset,
				clientY: y
			})
		);
	pointer('pointerdown', clip, 0);
	pointer('pointermove', window, 8);
	await new Promise(requestAnimationFrame);
	expect(timelineStore.items[0]!.from).toBeGreaterThan(0);
	expect(onedit).not.toHaveBeenCalled();
	window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
	pointer('pointerup', window, 8);
	expect(timelineStore.items.map((item) => item.from)).toEqual([0, 120, 240]);
	expect(onedit).not.toHaveBeenCalled();
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent('first,third');
	pointer('pointerdown', clip, 0);
	pointer('pointermove', window, 8);
	await new Promise(requestAnimationFrame);
	expect(onedit).not.toHaveBeenCalled();
	pointer('pointerup', window, 8);
	expect(timelineStore.items[0]!.from).toBeGreaterThan(0);
	expect(timelineStore.items[1]!.from).toBe(120);
	expect(timelineStore.items[2]!.from - 240).toBe(timelineStore.items[0]!.from);
	expect(onedit).toHaveBeenCalledOnce();
	await expect.element(screen.getByLabelText('Selected clips')).toHaveTextContent('first,third');
});
