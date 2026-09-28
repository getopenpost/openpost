import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import Fixture from './timeline-selection.fixture.svelte';
import '../../../routes/layout.css';

beforeEach(() => {
	timelineStore.__resetForTesting();
	timelineStore._setSnapEnabled(false);
	timelineStore._setScrollPosition(0);
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
afterEach(() => {
	timelineStore.__resetForTesting();
	window.scrollTo(0, 0);
});

it('opens the timeline menu near the viewport edge without scrolling or editing', async () => {
	const onedit = vi.fn();
	await page.viewport(1168, 600);
	const screen = await render(Fixture, { onedit, topSpace: 260 });
	await screen.getByRole('button', { name: 'Timeline: More actions', exact: true }).click();
	await expect
		.element(screen.getByRole('menuitem', { name: 'Add visual track', exact: true }))
		.toBeVisible();
	const menu = screen.getByRole('menu').element();
	await expect
		.poll(() => menu.getBoundingClientRect().bottom)
		.toBeLessThanOrEqual(window.innerHeight);
	expect(menu.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
	expect(window.scrollY).toBe(0);
	expect(timelineStore.tracks).toHaveLength(1);
	expect(onedit).not.toHaveBeenCalled();
});

it('leaves the center of a one-frame clip available for moving', async () => {
	timelineStore._setItems([{ ...timelineStore.items[0]!, durationInFrames: 1 }]);
	const screen = await render(Fixture, { onedit: vi.fn() });
	const clip = screen.getByRole('button', { name: /^first\./ }).element();
	const rect = clip.getBoundingClientRect();
	const target = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
	expect(target?.closest('button')).toBe(clip);
});

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

it('moves an unselected video from near its top corner without creating a fade', async () => {
	timelineStore._setItems([
		{
			...timelineStore.items[0]!,
			type: 'video',
			mediaId: 'corner-test-media',
			sourceStart: 0,
			sourceEnd: 90,
			sourceFps: 30
		}
	]);
	const screen = await render(Fixture, { onedit: vi.fn() });
	const clip = screen.getByRole('button', { name: /^first\./ }).element();
	const rect = clip.getBoundingClientRect();
	const x = rect.left + 12;
	const y = rect.top + 6;
	const target = document.elementFromPoint(x, y)!;
	expect(target.closest('button')).toBe(clip);
	const pointer = (type: string, receiver: EventTarget, offset: number) =>
		receiver.dispatchEvent(
			new PointerEvent(type, {
				pointerId: 7,
				button: 0,
				bubbles: true,
				cancelable: true,
				clientX: x + offset,
				clientY: y
			})
		);
	pointer('pointerdown', target, 0);
	pointer('pointermove', window, 40);
	await new Promise(requestAnimationFrame);
	pointer('pointerup', window, 40);
	expect(timelineStore.items[0]!.from).toBeGreaterThan(0);
	expect(timelineStore.items[0]!.fadeIn ?? 0).toBe(0);
});

it('restores and records the visible timeline position without authoring an edit', async () => {
	timelineStore._setItems([{ ...timelineStore.items[0]!, from: 1200 }]);
	timelineStore._setScrollPosition(250);
	const onedit = vi.fn();
	const screen = await render(Fixture, { onedit });
	const viewport = screen.getByRole('region', { name: 'Timeline', exact: true }).element();
	await expect.poll(() => viewport.scrollLeft).toBe(250);
	viewport.scrollLeft = 500;
	viewport.dispatchEvent(new Event('scroll'));
	await expect.poll(() => timelineStore.scrollPosition).toBe(500);
	expect(onedit).not.toHaveBeenCalled();
});
