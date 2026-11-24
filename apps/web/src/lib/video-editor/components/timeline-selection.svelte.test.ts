import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import Fixture from './timeline-selection.fixture.svelte';
import '../../../routes/layout.css';

beforeEach(async () => {
	await page.viewport(1168, 600);
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
	document.documentElement.classList.remove('dark');
	timelineStore.__resetForTesting();
	window.scrollTo(0, 0);
});

it.each([320, 390, 1168].flatMap((width) => [false, true].map((dark) => ({ width, dark }))))(
	'keeps narrow clip move and trim targets usable at $width px with dark=$dark',
	async ({ width, dark }) => {
		await page.viewport(width, 600);
		document.documentElement.classList.toggle('dark', dark);
		timelineStore._setItems([{ ...timelineStore.items[0]!, durationInFrames: 6 }]);
		const screen = await render(Fixture, { onedit: vi.fn() });
		const clip = screen.getByRole('button', { name: /^first\./ }).element();
		const rect = clip.getBoundingClientRect();
		expect(
			document
				.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
				?.closest('button')
		).toBe(clip);
		for (const name of ['Trim clip start', 'Trim clip end']) {
			const handle = screen.getByRole('button', { name, exact: true }).element();
			const bounds = handle.getBoundingClientRect();
			expect(
				document
					.elementFromPoint(bounds.left + bounds.width / 2, bounds.top + bounds.height / 2)
					?.closest('button')
			).toBe(handle);
		}
		await page.screenshot({
			path: `__screenshots__/timeline-center-${width}-${dark}.png`
		});
		const header = document.querySelector<HTMLElement>('[data-track-header]')!;
		await userEvent.hover(header);
		const more = screen.getByRole('button', {
			name: 'More track actions',
			exact: true
		});
		expect(more.element().getBoundingClientRect().right).toBeLessThanOrEqual(
			header.getBoundingClientRect().right
		);
		await more.click();
		await expect.element(screen.getByRole('menu')).toBeVisible();
		await userEvent.keyboard('{Escape}');
	}
);

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
