import { afterEach, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { page, userEvent } from 'vitest/browser';
import { createBlankProject } from '../project/defaults';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { commandHistory } from '../timeline/commands/command-store.svelte';
import { toggleTrackLock } from '../timeline/actions/tracks';
import { WebThemeRuntime } from '$lib/themes/runtime';
import { resolveBuiltInTheme } from '$lib/themes/builtins';
import { toast } from 'svelte-sonner';
import { createProject, getProject } from '../workspace-fs/projects';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import '../../../routes/layout.css';
import demoVideoURL from '../../../../../../tests/app/fixtures/product-screenshots/study-sos-demo.mp4?url';
import { mediaPool } from '../media/pool.svelte';
import SourceMonitor from './source-monitor.svelte';

afterEach(() => {
	mediaPool.clear();
	sequenceStore.reset();
	timelineStore.__resetForTesting();
	commandHistory.clearHistory();
});

async function renderSource(
	remoteUrl = 'data:audio/wav;base64,UklGRgQAAABXQVZF',
	preferredTrackId?: string
) {
	mediaPool.upsert(
		{
			id: 'source',
			fileName: 'source.mp4',
			fileSize: 1,
			mimeType: 'video/mp4',
			duration: 8,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			audioCodec: 'aac',
			bitrate: 1,
			storageType: 'cloud',
			remoteUrl,
			tags: ['video']
		},
		'ready'
	);
	return render(SourceMonitor, {
		mediaId: 'source',
		preferredTrackId,
		onclose: vi.fn(),
		onedit: vi.fn()
	});
}

it('places crossed marks at the playhead and keeps a nonempty source range', async () => {
	const screen = await renderSource();
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark in', exact: true }).click();
	await screen.getByRole('button', { name: 'Go to start', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark out', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '1');
	await expect
		.element(screen.getByRole('slider', { name: 'Source in point' }))
		.toHaveAttribute('aria-valuenow', '0');
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await screen.getByRole('button', { name: 'Mark in', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source in point' }))
		.toHaveAttribute('aria-valuenow', '239');
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '240');
});

it('lets source sliders own native keyboard range and position adjustments', async () => {
	const screen = await renderSource();
	const position = screen.getByRole('slider', { name: 'Source position' });
	const start = screen.getByRole('slider', { name: 'Source in point' });
	const end = screen.getByRole('slider', { name: 'Source out point' });
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	position.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '0');
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{End}');
	await expect.element(position).toHaveAttribute('aria-valuenow', '239');
	start.element().focus();
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{End}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '239');
	await userEvent.keyboard('{Home}');
	await expect.element(start).toHaveAttribute('aria-valuenow', '0');
	end.element().focus();
	await userEvent.keyboard('{Home}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '1');
	await userEvent.keyboard('{ArrowRight}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '2');
	await userEvent.keyboard('{End}');
	await expect.element(end).toHaveAttribute('aria-valuenow', '240');
});

it('keeps paused native video seeks outside the marked range', async () => {
	const screen = await renderSource(demoVideoURL);
	const source = screen.getByRole('region', { name: 'Source', exact: true }).element();
	await vi.waitFor(
		() => {
			expect(source.querySelector('video')?.readyState ?? 0).toBeGreaterThanOrEqual(2);
		},
		{ timeout: 5000 }
	);
	const video = source.querySelector('video')!;
	await screen.getByRole('button', { name: 'Mark out', exact: true }).click();
	await expect
		.element(screen.getByRole('slider', { name: 'Source out point' }))
		.toHaveAttribute('aria-valuenow', '1');
	const updated = new Promise<void>((resolve) =>
		video.addEventListener('timeupdate', () => resolve(), { once: true })
	);
	await screen.getByRole('button', { name: 'Go to end', exact: true }).click();
	await updated;
	await expect
		.element(screen.getByRole('slider', { name: 'Source position' }))
		.toHaveAttribute('aria-valuenow', '239');
	expect(video.paused).toBe(true);
	expect(video.currentTime).toBeCloseTo(239 / 30, 2);
	const outPoint = screen.getByRole('slider', { name: 'Source out point' });
	outPoint.element().focus();
	await userEvent.keyboard('{ArrowRight>29/}');
	await expect.element(outPoint).toHaveAttribute('aria-valuenow', '30');
	await screen.getByRole('button', { name: 'Play', exact: true }).click();
	await vi.waitFor(() => expect(video.played.length).toBeGreaterThan(0));
	await vi.waitFor(() => expect(video.paused).toBe(true), { timeout: 3000 });
	await expect
		.element(screen.getByRole('slider', { name: 'Source position' }))
		.toHaveAttribute('aria-valuenow', '29');
	expect(video.currentTime).toBeCloseTo(29 / 30, 2);
});

for (const target of [
	{ kind: 'Video', id: 'track-video-overlay', name: 'Visual 2', other: 'Audio' },
	{ kind: 'Audio', id: 'track-audio', name: 'Audio', other: 'Video' }
]) {
	it(`retains the named ${target.kind} destination when locked and preserves edit rejection`, async () => {
		const project = createBlankProject('Source target');
		sequenceStore.load(project.timeline!, project.metadata);
		let screen = await renderSource(demoVideoURL);
		const theme = new WebThemeRuntime();
		try {
			await screen.getByRole('checkbox', { name: target.other, exact: true }).click();
			let destination = screen.getByRole('button', {
				name: `${target.kind} destination track`,
				exact: true
			});
			await destination.click();
			await page.getByRole('option', { name: target.name, exact: true }).click();
			await expect.element(destination).toHaveTextContent(target.name);
			toggleTrackLock(target.id);
			await expect.element(destination).toHaveTextContent(target.name);
			const historySize = commandHistory.undoStack.length;
			const previousToasts = new Set(toast.getActiveToasts().map((entry) => entry.id));
			await screen.getByRole('button', { name: /^Insert edit/ }).click();
			await screen.getByRole('button', { name: /^Overwrite edit/ }).click();
			expect(timelineStore.items).toHaveLength(0);
			expect(commandHistory.undoStack).toHaveLength(historySize);
			expect(
				toast.getActiveToasts().filter((entry) => !previousToasts.has(entry.id))
			).toMatchObject([
				{ type: 'error', title: 'Unlock the selected destination track before editing.' },
				{ type: 'error', title: 'Unlock the selected destination track before editing.' }
			]);
			await destination.click();
			await expect
				.element(page.getByRole('option', { name: target.name, exact: true }))
				.toHaveAttribute('aria-disabled', 'true');
			await userEvent.keyboard('{Escape}');
			commandHistory.undo();
			await destination.click();
			await expect
				.element(page.getByRole('option', { name: target.name, exact: true }))
				.not.toHaveAttribute('aria-disabled', 'true');
			await userEvent.keyboard('{Escape}');
			commandHistory.redo();
			await expect.element(destination).toHaveTextContent(target.name);
			await screen.unmount();
			const previousRoot = getWorkspaceRoot();
			const opfs = await navigator.storage.getDirectory();
			const name = `source-target-${crypto.randomUUID()}`;
			setWorkspaceRoot(await opfs.getDirectoryHandle(name, { create: true }));
			try {
				await createProject({ ...project, timeline: sequenceStore.projectTimeline() });
				sequenceStore.reset();
				const loaded = (await getProject(project.id))!;
				sequenceStore.load(loaded.timeline!, loaded.metadata);
			} finally {
				setWorkspaceRoot(previousRoot);
				await opfs.removeEntry(name, { recursive: true });
			}
			expect(timelineStore.tracks.find((track) => track.id === target.id)?.locked).toBe(true);
			screen = await renderSource(demoVideoURL, target.id);
			destination = screen.getByRole('button', {
				name: `${target.kind} destination track`,
				exact: true
			});
			await expect.element(destination).toHaveTextContent(target.name);
			for (const scheme of ['light', 'dark'] as const) {
				await theme.apply(resolveBuiltInTheme('dither', scheme), document.documentElement);
				for (const width of [1280, 390, 320]) {
					await page.viewport(width, 844);
					screen.container.style.maxWidth = '500px';
					destination.element().focus();
					await expect.element(destination).toHaveFocus();
					await expect.element(destination).toHaveTextContent(target.name);
					await page.screenshot({ path: `vlt001-${target.kind}-${scheme}-${width}.png` });
				}
			}
		} finally {
			await screen.unmount();
			theme.clear(document.documentElement);
		}
	}, 30_000);
}
