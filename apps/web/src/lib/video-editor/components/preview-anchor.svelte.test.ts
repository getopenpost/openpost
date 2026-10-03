import { expect, it } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import PreviewPlayer from './preview-player.svelte';
import { createBlankProject } from '../project/defaults';
import { editorSession } from '../editor.svelte';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { setCurrentFrame } from '../timeline/actions/items';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import '../../../routes/layout.css';

// Downsampling rotated white glyphs can leave only antialiased gray pixels.
// Against this fixture's black backdrop, half-intensity pixels still mark the glyphs.
const MIN_LETTER_CHANNEL = 128;

it.each([
	{ composited: false, scaled: false, width: 1280, dark: false },
	{ composited: true, scaled: false, width: 1280, dark: true },
	{ composited: false, scaled: true, width: 390, dark: true },
	{ composited: true, scaled: true, width: 320, dark: false }
])(
	'moving a rotated title anchor preserves visible pose %j',
	async ({ composited, scaled, width, dark }) => {
		const root = await navigator.storage.getDirectory();
		const dir = `anchor-pose-${crypto.randomUUID()}`;
		const prior = getWorkspaceRoot();
		setWorkspaceRoot(await root.getDirectoryHandle(dir, { create: true }));
		await page.viewport(width, 850);
		document.documentElement.classList.toggle('dark', dark);
		const project = createBlankProject('Anchor pose');
		if (!project.timeline) throw new Error('Blank project has no timeline');
		const track = project.timeline.tracks[0]!.id;
		project.timeline.tracks.push({
			...project.timeline.tracks[0]!,
			id: 'background-track',
			name: 'Background',
			order: 2
		});
		project.timeline.items = [
			{
				id: 'title',
				type: 'text',
				label: 'Title',
				text: 'Anchor',
				fontFamily: 'Arial',
				fontSize: 60,
				color: '#ffffff',
				trackId: track,
				from: 0,
				durationInFrames: 90,
				transform: {
					x: 0,
					y: 0,
					width: 600,
					height: 100,
					anchorX: 300,
					anchorY: 50,
					rotation: scaled ? 37 : 90,
					scaleX: scaled ? 1.3 : 1,
					scaleY: scaled ? 0.7 : 1,
					flipHorizontal: scaled
				}
			}
		];
		if (composited)
			project.timeline.items.push({
				id: 'background',
				type: 'background',
				label: 'Background',
				trackId: 'background-track',
				from: 0,
				durationInFrames: 90,
				background: {
					kind: 'pattern',
					pattern: 'dots',
					foreground: '#000000',
					background: '#000000',
					scale: 1,
					rotation: 0,
					offsetX: 0,
					offsetY: 0,
					density: 1,
					foregroundOpacity: 1
				}
			});
		editorSession.project = project;
		sequenceStore.load(project.timeline, project.metadata);
		commandHistory.clearHistory();
		let screen = await render(PreviewPlayer, {
			selectedItemId: 'title',
			selectedItemIds: ['title'],
			onedit: () => {}
		});
		screen.container.style.cssText = 'display:flex;width:min(100%,1000px);height:650px';
		function letterBounds() {
			const canvas = screen.container.querySelector<HTMLCanvasElement>(
				composited ? '[data-stacked-preview]' : '[data-preview-item="title"] canvas'
			);
			if (!canvas) return null;
			const context = canvas.getContext('2d');
			if (!context) return null;
			const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
			let left = canvas.width,
				right = -1,
				top = canvas.height,
				bottom = -1,
				count = 0;
			for (let offset = 0; offset < data.length; offset += 4) {
				if (
					data[offset]! < MIN_LETTER_CHANNEL ||
					data[offset + 1]! < MIN_LETTER_CHANNEL ||
					data[offset + 2]! < MIN_LETTER_CHANNEL ||
					data[offset + 3]! < 128
				)
					continue;
				const pixel = offset / 4,
					x = pixel % canvas.width,
					y = Math.floor(pixel / canvas.width);
				left = Math.min(left, x);
				right = Math.max(right, x);
				top = Math.min(top, y);
				bottom = Math.max(bottom, y);
				count++;
			}
			if (count === 0) return null;
			if (!composited) {
				const origin = screen.container.getBoundingClientRect();
				const rect = screen.container
					.querySelector<HTMLElement>('[data-preview-item="title"]')!
					.getBoundingClientRect();
				return {
					left: Math.round(rect.left - origin.left),
					right: Math.round(rect.right - origin.left),
					top: Math.round(rect.top - origin.top),
					bottom: Math.round(rect.bottom - origin.top)
				};
			}
			return { left, right, top, bottom };
		}
		try {
			await expect.poll(letterBounds).not.toBeNull();
			const before = letterBounds();
			await screen.getByRole('button', { name: 'Anchor', exact: true }).click();
			const handle = screen.getByRole('button', { name: 'Move anchor point', exact: true });
			handle.element().focus();
			await userEvent.keyboard(
				'{Shift>}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{ArrowRight}{/Shift}'
			);
			expect(timelineStore.itemById.get('title')?.transform?.anchorY).not.toBe(50);
			setCurrentFrame(1);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			await expect.poll(letterBounds).toEqual(before);
			await page.screenshot({
				path: `__screenshots__/vsd001-anchor-after-${composited}-${scaled}.png`
			});
			commandHistory.undo();
			setCurrentFrame(2);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			await expect.poll(letterBounds).toEqual(before);
			commandHistory.redo();
			setCurrentFrame(3);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			await expect.poll(letterBounds).toEqual(before);
			await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
			await screen.unmount();
			screen.container.remove();
			sequenceStore.reset();
			timelineStore.__resetForTesting();
			const saved = await getProject(project.id);
			expect(
				saved?.timeline?.items.find((item) => item.id === 'title')?.transform?.anchorY
			).not.toBe(50);
			if (!saved?.timeline) throw new Error('Saved project has no timeline');
			editorSession.project = saved;
			sequenceStore.load(saved.timeline, saved.metadata);
			screen = await render(PreviewPlayer, {
				selectedItemId: 'title',
				selectedItemIds: ['title'],
				onedit: () => {}
			});
			screen.container.style.cssText = 'display:flex;width:min(100%,1000px);height:650px';
			setCurrentFrame(4);
			await new Promise<void>((resolve) =>
				requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
			);
			await expect.poll(letterBounds).toEqual(before);
		} finally {
			await screen.unmount();
			screen.container.remove();
			commandHistory.clearHistory();
			sequenceStore.reset();
			timelineStore.__resetForTesting();
			editorSession.project = null;
			document.documentElement.classList.remove('dark');
			setWorkspaceRoot(prior);
			await root.removeEntry(dir, { recursive: true }).catch(() => {});
		}
	}
);
