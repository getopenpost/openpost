/* oxlint-disable anti-slop/require-safety-comment-for-type-assertion -- Browser test DOM queries narrow to concrete element types covered by the queries above. */
import { describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import type { TimelineItem } from '../project/types';
import TextToolsHarness from './on-canvas-tools-blur.fixture.svelte';

function textItem(): TimelineItem {
	return {
		id: 'text-1',
		trackId: 'track-1',
		from: 0,
		durationInFrames: 30,
		label: 'Title',
		type: 'text',
		text: 'Hello',
		transform: { x: 0, y: 0, width: 960, height: 200 }
	} as TimelineItem;
}

function hooks() {
	return {
		ontextediting: vi.fn(),
		oncommittext: vi.fn(),
		onedit: vi.fn()
	};
}

async function startTextSession(
	screen: Awaited<ReturnType<typeof render>>
): Promise<HTMLDivElement> {
	const moveButton = screen.container.querySelector(
		'[data-canvas-item-box] > button'
	) as HTMLButtonElement | null;
	expect(moveButton).not.toBe(null);
	moveButton!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	// The text session starts from an effect plus a focus frame, so the
	// editor appears asynchronously after the double click.
	await expect.element(screen.getByRole('textbox')).toBeVisible();
	return screen.getByRole('textbox').element() as HTMLDivElement;
}

describe('on-canvas text blur after the item disappears', () => {
	it('ends the session without throwing or committing', async () => {
		const seen = hooks();
		const item = textItem();
		const screen = await render(TextToolsHarness, { props: { item, hooks: seen } });
		const editor = await startTextSession(screen);
		editor.focus();
		// A dirty draft makes the teardown commit decision observable: without it
		// "no oncommittext" would also hold for a session that never changed.
		editor.textContent = 'Unsaved draft';
		editor.dispatchEvent(new InputEvent('input', { bubbles: true }));

		// The item is deleted mid-edit: the parent destroys the tools block
		// while the editor still holds focus, exactly like preview-player when
		// selectedResolved becomes undefined. Collect window errors from here:
		// the removal blur fires during the rerender flush below, and the late
		// blur after teardown must stay inside the same collection window.
		const windowErrors: unknown[] = [];
		const onWindowError = (event: ErrorEvent) => {
			windowErrors.push(event.error ?? event.message);
		};
		window.addEventListener('error', onWindowError);
		try {
			await screen.rerender({ item: undefined, hooks: seen });
			expect(screen.container.querySelector('[role="textbox"]')).toBe(null);
			await new Promise((resolve) => setTimeout(resolve, 100));

			// The browser fires blur as the focused node leaves the document. The
			// delegated listener still routes to the destroyed instance; Svelte
			// reports a handler failure asynchronously, so collect window errors
			// instead of relying on dispatchEvent to throw. Unguarded, this is
			// the production TypeError reading 'text'.
			// A second blur after teardown is a no-op: the session already ended.
			editor.dispatchEvent(new FocusEvent('blur'));
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(seen.oncommittext).not.toHaveBeenCalled();
			expect(seen.onedit).not.toHaveBeenCalled();
			expect(windowErrors).toEqual([]);
			expect(seen.ontextediting).toHaveBeenCalledWith(false);
		} finally {
			window.removeEventListener('error', onWindowError);
		}
	});

	it('still commits an edited value on blur while the item exists', async () => {
		const seen = hooks();
		const screen = await render(TextToolsHarness, {
			props: { item: textItem(), hooks: seen }
		});
		const editor = await startTextSession(screen);
		editor.textContent = 'Updated';
		editor.dispatchEvent(new InputEvent('input', { bubbles: true }));
		editor.dispatchEvent(new FocusEvent('blur'));

		expect(seen.oncommittext).toHaveBeenCalledWith('Updated');
		expect(seen.onedit).toHaveBeenCalledOnce();
	});
});
