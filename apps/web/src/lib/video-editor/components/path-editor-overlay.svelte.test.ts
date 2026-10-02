import type {} from '@vitest/browser-playwright';
import { afterEach, expect, it, vi } from 'vitest';
import { cdp, page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import OnCanvasTools from './on-canvas-tools.svelte';
import '../../../routes/layout.css';

afterEach(async () => {
	await cdp().send('Emulation.setTouchEmulationEnabled', { enabled: false });
	commandHistory.clearHistory();
	timelineStore.__resetForTesting();
	editorSession.project = null;
});

it.each([386, 320].flatMap((width) => ['mask', 'path'].map((context) => ({ width, context }))))(
	'keeps $context controls within a $width px preview and keyboard keys through More',
	async ({ width, context }) => {
		await page.viewport(width === 320 ? 320 : 1280, 900);
		await cdp().send('Emulation.setTouchEmulationEnabled', {
			enabled: width === 320,
			maxTouchPoints: 1
		});
		await expect.poll(() => matchMedia('(pointer:coarse)').matches).toBe(width === 320);
		const project = createBlankProject('Mask toolbar');
		project.timeline!.items = [
			{
				id: 'mask',
				type: 'shape',
				shapeType: 'path',
				label: 'Mask',
				isMask: context === 'mask',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 60,
				pathClosed: true,
				transform: { width: 800, height: 600, rotation: 25 },
				pathVertices: [
					[0.1, 0.1],
					[0.9, 0.1],
					[0.9, 0.9],
					[0.1, 0.9]
				].map(([x, y]) => ({
					position: [x, y],
					inHandle: [0, 0],
					outHandle: [0, 0]
				}))
			}
		];
		editorSession.project = project;
		sequenceStore.load(project.timeline!, project.metadata);
		const item = timelineStore.itemById.get('mask')!;
		const geometry = structuredClone(project.timeline!.items[0].pathVertices);
		const screen = await render(OnCanvasTools, {
			item,
			canvasWidth: 1920,
			canvasHeight: 1080,
			currentFrame: 0,
			ontransformdraft: vi.fn(),
			oncropdraft: vi.fn(),
			oncornerpindraft: vi.fn(),
			ontextediting: vi.fn(),
			oncommitvalues: vi.fn(),
			oncommitposition: vi.fn(),
			oncreatespatial: vi.fn(),
			oncommitspatial: vi.fn(),
			oncommittext: vi.fn(),
			oncommitcornerpin: vi.fn(),
			onseek: vi.fn(),
			onedit: vi.fn()
		});
		screen.container.style.cssText = `position:relative;width:${width}px;height:260px;overflow:hidden`;
		await screen
			.getByRole('button', { name: context === 'mask' ? 'Edit mask' : 'Edit path', exact: true })
			.click();
		await expect
			.element(
				screen.getByRole('toolbar', {
					name: context === 'mask' ? 'Edit mask' : 'Edit path',
					exact: true
				})
			)
			.toBeVisible();
		const family = screen
			.getByRole('toolbar', { name: 'On-canvas editing tools', exact: true })
			.element()
			.getBoundingClientRect();
		const maskToolbar = screen
			.getByRole('toolbar', { name: context === 'mask' ? 'Edit mask' : 'Edit path', exact: true })
			.element()
			.getBoundingClientRect();
		expect(maskToolbar.top >= family.bottom || maskToolbar.bottom <= family.top).toBe(true);
		const bounds = screen.container.getBoundingClientRect();
		const buttons = [...screen.container.querySelectorAll('button')];
		expect(buttons.length).toBeGreaterThan(0);
		for (const button of buttons) {
			const rect = button.getBoundingClientRect();
			expect(
				rect.left,
				button.textContent ?? button.getAttribute('aria-label') ?? ''
			).toBeGreaterThanOrEqual(bounds.left);
			expect(
				rect.right,
				button.textContent ?? button.getAttribute('aria-label') ?? ''
			).toBeLessThanOrEqual(bounds.right);
			expect(rect.top).toBeGreaterThanOrEqual(bounds.top);
			expect(rect.bottom).toBeLessThanOrEqual(bounds.bottom);
			if (width === 320) {
				expect(rect.width).toBeGreaterThanOrEqual(44);
				expect(rect.height).toBeGreaterThanOrEqual(44);
			}
		}
		const more = screen.getByRole('button', { name: 'More actions', exact: true });
		more.element().focus();
		await userEvent.keyboard('{Enter}');
		const key = screen.getByRole('menuitem', { name: 'Key all', exact: true });
		await expect.element(key).toBeVisible();
		key.element().focus();
		await userEvent.keyboard('{Enter}');
		await expect
			.poll(() => timelineStore.itemById.get('mask')!.keyframes?.['pathVertex:0:positionX'])
			.toMatchObject({ frames: [0], values: [0.1] });
		expect(timelineStore.itemById.get('mask')!.pathVertices).toEqual(geometry);
		commandHistory.undo();
		await expect
			.poll(() => timelineStore.itemById.get('mask')!.keyframes?.['pathVertex:0:positionX'])
			.toBeUndefined();
		await screen.unmount();
	}
);
