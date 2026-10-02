import { afterEach, expect, it, vi } from 'vitest';
import { commands, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { resolveBuiltInTheme, WebThemeRuntime } from '$lib/themes';
import { m } from '$lib/paraglide/messages';
import PanelResizeHandle from './panel-resize-handle.svelte';
import MarkerListPopover from '$lib/video-editor/components/marker-list-popover.svelte';
import { timelineStore } from '$lib/video-editor/timeline/stores/timeline-store.svelte';
import { commandHistory } from '$lib/video-editor/timeline/commands/command-store.svelte';
import { addMarker } from '$lib/video-editor/timeline/actions/items';
import '../../routes/layout.css';

afterEach(() => {
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

it.each([
	{ scheme: 'light', width: 1280 },
	{ scheme: 'dark', width: 1280 },
	{ scheme: 'light', width: 390 },
	{ scheme: 'dark', width: 320 }
] as const)(
	'keeps marker Clear reachable at $width pixels in $scheme',
	async ({ scheme, width }) => {
		await page.viewport(width, 720);
		const runtime = new WebThemeRuntime();
		await runtime.apply(resolveBuiltInTheme('workshop', scheme), document.documentElement);
		addMarker(60);
		commandHistory.clearHistory();
		const popover = await render(MarkerListPopover, { onedit: vi.fn(), onselect: vi.fn() });
		popover.container.style.cssText = `position:fixed;left:${width >= 1024 ? 400 : 24}px;top:400px`;
		const handle = await render(PanelResizeHandle, {
			edge: 'top',
			value: 260,
			minimum: 120,
			maximum: 500,
			defaultValue: 260,
			label: 'Timeline',
			onresize: vi.fn()
		});
		try {
			await popover
				.getByRole('button', { name: m.video_editor_marker_list_count({ count: 1 }) })
				.click();
			const clear = page.getByRole('button', {
				name: m.video_editor_marker_list_clear(),
				exact: true
			});
			await expect.element(clear).toBeVisible();
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			const bounds = clear.element().getBoundingClientRect();
			handle.container.style.cssText = `position:absolute;left:${bounds.left}px;top:${bounds.top + bounds.height / 2}px;width:${bounds.width}px;height:0`;
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			const separator = handle.getByRole('separator', { includeHidden: true }).element();
			if (width >= 1024) {
				expect(separator.checkVisibility()).toBe(true);
				expect(separator.getBoundingClientRect().top).toBeLessThan(bounds.top + bounds.height / 2);
				expect(separator.getBoundingClientRect().bottom).toBeGreaterThan(
					bounds.top + bounds.height / 2
				);
			} else expect(separator.checkVisibility()).toBe(false);

			// Force skips actionability retries, but still sends a native pointer at the visible button.
			await clear.click({ force: true });
			expect(timelineStore.markers).toHaveLength(0);
			commandHistory.undo();
			expect(timelineStore.markers).toHaveLength(1);
			commandHistory.redo();
			expect(timelineStore.markers).toHaveLength(0);
		} finally {
			await popover.unmount();
			await handle.unmount();
			runtime.clear(document.documentElement);
		}
	}
);

it.each(['top', 'right'] as const)(
	'still resizes the uncovered %s edge by pointer and keyboard',
	async (edge) => {
		await page.viewport(1280, 720);
		const onresize = vi.fn();
		const oncommit = vi.fn();
		const screen = await render(PanelResizeHandle, {
			edge,
			value: 260,
			minimum: 120,
			maximum: 500,
			defaultValue: 260,
			label: 'Panel',
			onresize,
			oncommit
		});
		screen.container.style.cssText = 'position:fixed;top:200px;left:200px;width:200px;height:200px';
		await commands.dragPointer(
			'[role="separator"][aria-label="Panel"]',
			edge === 'right' ? 32 : 0,
			edge === 'top' ? -32 : 0
		);
		expect(onresize).toHaveBeenLastCalledWith(292);
		expect(oncommit).toHaveBeenLastCalledWith(292);
		await screen.getByRole('separator', { name: 'Panel' }).element().focus();
		await userEvent.keyboard(edge === 'right' ? '{ArrowRight}' : '{ArrowUp}');
		expect(onresize).toHaveBeenLastCalledWith(276);
		expect(oncommit).toHaveBeenLastCalledWith(276);
	}
);
