import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import type { Project, TimelineItem, TimelineTrack } from '../project/types';
import { mediaPool } from '../media/pool.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import ExportDialog from './export-dialog.svelte';
import { renderQueueStore } from '../export/render-queue-store';
import type {
	AudioExportOptions,
	RenderExportOptions,
	RenderExportResult
} from '../media/render-export';
import type {
	ImageSequenceExecutionJob,
	ImageSequenceExecutionOutcome
} from '../media/render-execution';
import '../../../routes/layout.css';

const track: TimelineTrack = {
	id: 'video-track',
	name: 'Video',
	kind: 'video',
	height: 64,
	locked: false,
	visible: true,
	muted: false,
	solo: false,
	order: 0
};

const item: TimelineItem = {
	id: 'video',
	trackId: track.id,
	from: 0,
	durationInFrames: 300,
	label: 'Interview',
	type: 'video',
	mediaId: 'media'
};

const project: Project = {
	id: 'project',
	name: 'Interview',
	description: '',
	createdAt: 0,
	updatedAt: 0,
	duration: 10,
	metadata: { width: 1920, height: 1080, fps: 30 },
	timeline: { tracks: [track], items: [item] }
};

beforeEach(() => {
	mediaPool.clear();
	renderQueueStore.hydrate([], false);
	mediaPool.upsert(
		{
			id: 'media',
			storageType: 'workspace',
			fileName: 'interview.mp4',
			fileSize: 100,
			mimeType: 'video/mp4',
			duration: 10,
			width: 1920,
			height: 1080,
			fps: 30,
			codec: 'avc',
			bitrate: 1,
			tags: ['video']
		},
		'ready'
	);
	timelineStore.__resetForTesting();
	timelineStore.setAll({ tracks: [track], items: [item], fps: 30, currentFrame: 0 });
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe('ExportDialog', () => {
	it('shows the live render phase and cancels the immediate export', async () => {
		await page.viewport(320, 720);
		let renderSignal: AbortSignal | undefined;
		const renderVideo = vi.fn(
			async (_project: Project, options: RenderExportOptions = {}): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'rendering',
					framesDone: 45,
					totalFrames: 300,
					progress: 0.15
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderVideo
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Rendering frames')).toBeVisible();
		await expect.element(screen.getByText('Frame 45 / 300')).toBeVisible();
		await expect.element(screen.getByText('15%')).toBeVisible();
		expect(screen.getByRole('dialog').element().scrollWidth).toBeLessThanOrEqual(
			screen.getByRole('dialog').element().clientWidth
		);
		await page.viewport(390, 720);
		expect(screen.getByRole('dialog').element().scrollWidth).toBeLessThanOrEqual(
			screen.getByRole('dialog').element().clientWidth
		);

		await userEvent.click(screen.getByRole('button', { name: 'Cancel export' }).element());
		expect(renderSignal?.aborted).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		expect(renderVideo).toHaveBeenCalledOnce();
	});

	it('forwards audio encoding progress to the immediate export view', async () => {
		let renderSignal: AbortSignal | undefined;
		const renderAudio = vi.fn(
			async (_project: Project, options: AudioExportOptions): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'encoding',
					framesDone: 180,
					totalFrames: 300,
					progress: 0.6
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderAudio
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByText('WebM', { exact: true }).click();
		await screen.getByRole('option', { name: 'Audio only: MP3' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Encoding output')).toBeVisible();
		await expect.element(screen.getByText('60%')).toBeVisible();
		await screen.getByRole('button', { name: 'Cancel export' }).click();
		expect(renderSignal?.aborted).toBe(true);
		expect(renderAudio).toHaveBeenCalledOnce();
	});

	it('downloads a ZIP when the workspace save is unavailable', async () => {
		const blob = new Blob(['zip'], { type: 'application/zip' });
		const renderSequence = vi.fn(
			async (_job: ImageSequenceExecutionJob): Promise<ImageSequenceExecutionOutcome> => ({
				renderPath: 'main-thread',
				result: {
					kind: 'zip',
					fileName: 'Interview.zip',
					relPath: null,
					blob,
					frameCount: 300,
					totalBytes: blob.size,
					savedToWorkspace: false
				}
			})
		);
		const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:sequence');
		const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
		const ondone = vi.fn();
		const screen = await render(ExportDialog, {
			project,
			ondone,
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderSequence
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByText('WebM', { exact: true }).click();
		await screen.getByRole('option', { name: 'PNG sequence' }).click();
		if (screen.getByText('Folder', { exact: true }).query()) {
			await screen.getByText('Folder', { exact: true }).click();
			await screen.getByRole('option', { name: 'ZIP file' }).click();
		}
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		await screen.getByRole('button', { name: 'Render now' }).click();

		await vi.waitFor(() => expect(renderSequence).toHaveBeenCalledOnce());
		expect(createObjectURL).toHaveBeenCalledWith(blob);
		expect(click).toHaveBeenCalledOnce();
		expect(ondone).toHaveBeenCalledWith({
			relPath: 'download:Interview.zip',
			fileName: 'Interview.zip',
			blob
		});
	});

	it('shows live readiness, blocks missing sources, and fits a phone-width viewport', async () => {
		await page.viewport(320, 720);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		const dialog = screen.getByRole('dialog').element();
		expect(dialog.scrollWidth).toBeLessThanOrEqual(dialog.clientWidth);
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();
		expect(get(renderQueueStore).jobs).toHaveLength(1);
		const queuedJob = get(renderQueueStore).jobs[0];
		if (!queuedJob) throw new Error('Expected one queued render');
		expect(renderQueueStore.markRendering(queuedJob.id)).toBe(true);
		renderQueueStore.updateProgress(queuedJob.id, {
			phase: 'encoding',
			framesDone: 225,
			totalFrames: 300,
			progress: 0.75
		});
		const liveItem = timelineStore.itemById.get('video');
		if (!liveItem) throw new Error('Expected the live video item');
		liveItem.label = 'Changed later';
		expect(get(renderQueueStore).jobs[0]?.snapshot.items[0]?.label).toBe('Interview');
		await screen.getByRole('button', { name: 'Exports (1)' }).click();
		await expect.element(screen.getByText('Interview')).toBeVisible();
		await expect.element(screen.getByText('Encoding output')).toBeVisible();
		await expect.element(screen.getByText('75%')).toBeVisible();
		const queueDialog = screen.getByRole('dialog').element();
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
		await page.viewport(1280, 720);
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();

		mediaPool.setStatus('media', 'failed', 'File moved');
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Fix these issues before exporting')).toBeVisible();
		await expect.element(screen.getByText('Relink 1 missing or unreadable sources.')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeDisabled();
	});

	it('queues one shared frozen render snapshot per marker span', async () => {
		await page.viewport(320, 720);
		timelineStore.setAll({
			tracks: [track],
			items: [item],
			markers: [{ id: 'middle', frame: 150, label: 'Middle', color: '#d97746' }],
			fps: 30,
			currentFrame: 0
		});
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'One segment per marker' }).click();

		const jobs = get(renderQueueStore).jobs;
		expect(jobs.map((job) => job.settings.range)).toEqual([
			{ startFrame: 0, endFrame: 150 },
			{ startFrame: 150, endFrame: 300 }
		]);
		expect(jobs[0]?.snapshot).toBe(jobs[1]?.snapshot);
		await screen.getByRole('button', { name: 'Exports (2)' }).click();
		await expect.element(screen.getByText('Interview - Part 1')).toBeVisible();
		await expect.element(screen.getByText('Interview - Part 2')).toBeVisible();
		const queueDialog = screen.getByRole('dialog').element();
		expect(queueDialog.scrollWidth).toBeLessThanOrEqual(queueDialog.clientWidth);
	});

	it('allows fixed segments when the unsplit render exceeds the memory limit', async () => {
		await page.viewport(320, 720);
		const longItem = { ...item, durationInFrames: 72_000 };
		const longProject = {
			...project,
			duration: 2_400,
			timeline: { tracks: [track], items: [longItem] }
		};
		timelineStore.setAll({
			tracks: [track],
			items: [longItem],
			fps: 30,
			currentFrame: 0
		});
		const screen = await render(ExportDialog, {
			project: longProject,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect.element(screen.getByRole('button', { name: 'Add to queue' })).toBeEnabled();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeDisabled();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Every 60 seconds' }).click();

		const jobs = get(renderQueueStore).jobs;
		expect(jobs).toHaveLength(40);
		expect(jobs[0]?.settings.range).toEqual({ startFrame: 0, endFrame: 1_800 });
		expect(jobs[39]?.settings.range).toEqual({ startFrame: 70_200, endFrame: 72_000 });
		expect(new Set(jobs.map((job) => job.snapshot))).toHaveLength(1);
	});
	it('traps focus inside the export dialog', async () => {
		await page.viewport(1280, 720);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		const trigger = screen.getByRole('button', { name: 'Render full video' });
		await trigger.click();
		const dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await vi.waitFor(() => {
			expect(dialog.element().contains(document.activeElement)).toBe(true);
		});

		// Tab should keep focus inside dialog
		await userEvent.keyboard('{Tab}');
		expect(dialog.element().contains(document.activeElement)).toBe(true);
		await userEvent.keyboard('{Tab}');
		expect(dialog.element().contains(document.activeElement)).toBe(true);
		// Shift+Tab should also stay inside
		await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
		expect(dialog.element().contains(document.activeElement)).toBe(true);

		// background trigger should not receive focus while dialog open
		expect(document.activeElement).not.toBe(trigger.element());
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).not.toBeInTheDocument();
	});

	it('Escape closes idle dialog and returns focus, but is blocked while rendering', async () => {
		await page.viewport(1280, 720);
		let renderSignal: AbortSignal | undefined;
		const renderVideo = vi.fn(
			async (_project: Project, options: RenderExportOptions = {}): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'rendering',
					framesDone: 10,
					totalFrames: 300,
					progress: 0.03
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderVideo
		});

		const trigger = screen.getByRole('button', { name: 'Render full video' });
		await trigger.click();
		let dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();

		// Escape should close when idle and restore focus
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger.element());

		// reopen and start rendering
		await trigger.click();
		dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Rendering frames')).toBeVisible();

		// Escape while rendering should be ignored
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).toBeVisible();
		expect(renderSignal?.aborted).toBe(false);

		// Cancel restores idle state and Escape then works
		await screen.getByRole('button', { name: 'Cancel export' }).click();
		expect(renderSignal?.aborted).toBe(true);
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(dialog).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger.element());
	});

	it('overlay click closes idle dialog and restores focus, but is blocked while rendering', async () => {
		await page.viewport(1280, 720);
		let renderSignal: AbortSignal | undefined;
		const renderVideo = vi.fn(
			async (_project: Project, options: RenderExportOptions = {}): Promise<RenderExportResult> => {
				renderSignal = options.signal;
				options.onProgress?.({
					phase: 'rendering',
					framesDone: 10,
					totalFrames: 300,
					progress: 0.03
				});
				return await new Promise((_resolve, reject) => {
					options.signal?.addEventListener(
						'abort',
						() => reject(new DOMException('Export cancelled', 'AbortError')),
						{ once: true }
					);
				});
			}
		);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderVideo
		});

		const trigger = screen.getByRole('button', { name: 'Render full video' });
		await trigger.click();
		let dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		const getOverlay = () =>
			// SAFETY: overlay has stable data-slot when dialog is open
			document.querySelector('[data-slot="dialog-overlay"]') as HTMLElement | null;
		const clickOverlay = async (overlay: HTMLElement) => {
			await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
			const pointer = {
				bubbles: true,
				composed: true,
				pointerType: 'mouse',
				pointerId: 1,
				isPrimary: true,
				button: 0,
				clientX: 1,
				clientY: 1
			};
			overlay.dispatchEvent(new PointerEvent('pointerdown', { ...pointer, buttons: 1 }));
			overlay.dispatchEvent(new PointerEvent('pointerup', { ...pointer, buttons: 0 }));
			overlay.dispatchEvent(new MouseEvent('click', pointer));
		};

		let overlay = getOverlay();
		expect(overlay).not.toBeNull();
		await clickOverlay(overlay!);
		await vi.waitFor(() => {
			expect(document.querySelector('[data-slot="dialog-content"]')).toBeNull();
		});
		await expect.element(dialog).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger.element());

		// rendering blocks overlay dismiss
		await trigger.click();
		dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await screen.getByRole('button', { name: 'Render now' }).click();
		await expect.element(screen.getByText('Rendering frames')).toBeVisible();
		overlay = getOverlay();
		expect(overlay).not.toBeNull();
		await clickOverlay(overlay!);
		await Promise.resolve();
		await expect.element(dialog).toBeVisible();
		expect(renderSignal?.aborted).toBe(false);

		// cleanup - cancel export to return to idle, then verify still open
		screen.getByRole('button', { name: 'Cancel export' }).element().click();
		await expect.element(screen.getByText('Ready to render')).toBeVisible();
		await userEvent.keyboard('{Escape}');
		await expect.element(screen.getByRole('dialog')).not.toBeInTheDocument();
	});

	it('Cancel button restores focus to trigger when idle', async () => {
		await page.viewport(1280, 720);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});
		const trigger = screen.getByRole('button', { name: 'Render full video' });
		await trigger.click();
		const dialog = screen.getByRole('dialog');
		await expect.element(dialog).toBeVisible();
		await screen.getByRole('button', { name: 'Cancel export' }).click();
		await expect.element(dialog).not.toBeInTheDocument();
		expect(document.activeElement).toBe(trigger.element());
	});
});
