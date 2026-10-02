import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import { get } from 'svelte/store';
import '../../../routes/layout.css';
import type { Project, SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import type { RenderExportOptions } from '../media/render-export';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
import { renderQueueStore } from '../export/render-queue-store';
import ExportDialog from './export-dialog.svelte';
import { getWorkspaceRoot, setWorkspaceRoot } from '../workspace-fs/root';
import { renderVideoExport } from '../media/render-execution';
import { loadProjectRenderQueue, saveProjectRenderQueue } from '../export/render-queue-persistence';

const tracks: TimelineTrack[] = [
	{
		id: 'visuals',
		name: 'Visuals',
		kind: 'video',
		height: 64,
		locked: false,
		visible: true,
		muted: false,
		solo: false,
		order: 0
	}
];

function shape(id: string, durationInFrames: number): TimelineItem {
	return {
		id,
		trackId: 'visuals',
		from: 0,
		durationInFrames,
		label: id,
		type: 'shape',
		shapeType: 'rectangle'
	};
}

function projectFixture(): Project {
	const portrait: SubComposition = {
		id: 'portrait',
		name: 'Portrait cut',
		editorKind: 'composite-2d',
		items: [shape('portrait-shape', 60)],
		tracks,
		transitions: [],
		fps: 30,
		width: 1080,
		height: 1920,
		durationInFrames: 300
	};
	return {
		id: 'project',
		name: 'Launch film',
		description: '',
		createdAt: 1,
		updatedAt: 1,
		duration: 4,
		metadata: {
			width: 1920,
			height: 1080,
			fps: 30,
			backgroundColor: '#111111'
		},
		timeline: {
			tracks,
			items: [shape('main-shape', 120)],
			transitions: [],
			compositions: [portrait],
			topLevelSequenceIds: [portrait.id]
		}
	};
}

beforeEach(() => {
	timelineStore.__resetForTesting();
	sequenceStore.reset();
	renderQueueStore.clearAll();
});

describe('ExportDialog', () => {
	it('adds the current range to the render queue', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();

		await vi.waitFor(() => expect(get(renderQueueStore).jobs).toHaveLength(1));
		expect(get(renderQueueStore).jobs[0]).toMatchObject({
			projectId: project.id,
			name: project.name,
			status: 'queued',
			settings: { range: { startFrame: 0, endFrame: 120 } }
		});
		await expect.element(screen.getByRole('button', { name: 'Exports (1)' })).toBeVisible();
	});

	it('keeps chosen resolution with quality when reopening the same project and persists exact queued dimensions', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Draft preview', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Resolution', exact: true }))
			.toHaveTextContent('854 × 480');
		await screen.getByRole('button', { name: 'Cancel export' }).click();
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Quality', exact: true }))
			.toHaveTextContent('Draft');
		await expect
			.element(screen.getByRole('button', { name: 'Resolution', exact: true }))
			.toHaveTextContent('854 × 480');
		await expect
			.element(screen.getByRole('button', { name: 'Draft preview', exact: true }))
			.toHaveAttribute('aria-pressed', 'true');
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();
		const previousRoot = getWorkspaceRoot();
		const opfs = await navigator.storage.getDirectory();
		const directory = `export-settings-${crypto.randomUUID()}`;
		setWorkspaceRoot(await opfs.getDirectoryHandle(directory, { create: true }));
		try {
			await saveProjectRenderQueue(project.id, get(renderQueueStore).jobs, true);
			renderQueueStore.clearAll();
			const saved = await loadProjectRenderQueue(project.id);
			expect(saved.jobs).toHaveLength(1);
			expect(saved.jobs[0]?.settings).toMatchObject({
				quality: 'draft',
				width: 854,
				height: 480,
				range: { startFrame: 0, endFrame: 120 }
			});
			renderQueueStore.hydrate(saved.jobs, saved.isPaused);
			expect(get(renderQueueStore).isPaused).toBe(true);
		} finally {
			setWorkspaceRoot(previousRoot);
			await opfs.removeEntry(directory, { recursive: true });
		}
		const otherProject = projectFixture();
		otherProject.id = 'other-project';
		otherProject.metadata.width = 1600;
		otherProject.metadata.height = 900;
		sequenceStore.load(otherProject.timeline!, otherProject.metadata);
		await screen.rerender({ project: otherProject });
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Resolution', exact: true }))
			.toHaveTextContent('1600 × 900');
	});

	it('distinguishes sequence size from fixed full HD and queues each explicit choice', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Resolution', exact: true }).click();
		await expect
			.element(screen.getByRole('option', { name: '1280 × 720', exact: true }))
			.toBeVisible();
		expect(
			Array.from(document.querySelectorAll('[role=option]')).filter(
				(option) => option.textContent?.trim() === '1920 × 1080'
			)
		).toHaveLength(1);
		await screen.getByRole('option', { name: 'Sequence size (1920 × 1080)', exact: true }).click();
		await screen.getByRole('button', { name: 'Sequences', exact: true }).click();
		await screen.getByRole('option', { name: 'Portrait cut', exact: true }).click();
		await expect
			.element(screen.getByRole('button', { name: 'Resolution', exact: true }))
			.toHaveTextContent('Sequence size (1080 × 1920)');
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();
		expect(get(renderQueueStore).jobs[0]?.settings).toMatchObject({ width: 1080, height: 1920 });
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Sequences', exact: true }).click();
		await screen.getByRole('option', { name: 'Portrait cut', exact: true }).click();
		await screen.getByRole('button', { name: 'Resolution', exact: true }).click();
		await expect
			.element(screen.getByRole('option', { name: 'Sequence size (1080 × 1920)', exact: true }))
			.toBeVisible();
		await screen.getByRole('option', { name: '1920 × 1080', exact: true }).click();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();
		expect(get(renderQueueStore).jobs).toHaveLength(2);
		expect(get(renderQueueStore).jobs[1]?.settings).toMatchObject({ width: 1920, height: 1080 });
		expect(get(renderQueueStore).jobs[1]?.snapshot).toMatchObject({ width: 1080, height: 1920 });
	});

	it('keeps the dialog open with a recovery step when queue submission fails', async () => {
		const project = projectFixture();
		Object.defineProperty(project.timeline!.items[0]!, 'unsupported', {
			value: 1n,
			enumerable: true
		});
		sequenceStore.load(project.timeline!, project.metadata);
		const onerror = vi.fn();
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror,
			probeCodec: vi.fn(async () => true)
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Add to queue' }).click();
		await screen.getByRole('menuitem', { name: 'Add current range' }).click();

		await expect
			.element(
				screen
					.getByRole('alert')
					.getByText('The render could not be added. Save the project, then try again.')
			)
			.toBeVisible();
		expect(get(renderQueueStore).jobs).toHaveLength(0);
		expect(onerror).toHaveBeenCalledOnce();
		await expect.element(screen.getByRole('heading', { name: 'Export video' })).toBeVisible();
	});

	it('shows only audio-relevant decisions for WAV and restores video settings afterward', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const screen = await render(ExportDialog, {
			project,
			ondone: vi.fn(),
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true)
		});
		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByText('WebM', { exact: true }).click();
		await screen.getByRole('option', { name: 'Audio only: WAV', exact: true }).click();
		await expect
			.element(screen.getByRole('heading', { name: 'Export', exact: true }))
			.toBeVisible();
		for (const name of ['Resolution', 'Quality', 'Subtitles', 'Codec']) {
			await expect
				.element(screen.getByRole('button', { name: new RegExp(name) }))
				.not.toBeInTheDocument();
		}
		await expect.element(screen.getByText('Resolution: 1920 × 1080')).not.toBeInTheDocument();
		await expect.element(screen.getByText('Audio only: WAV', { exact: true })).toBeVisible();
		await screen.getByText('Audio only: WAV', { exact: true }).click();
		await screen.getByRole('option', { name: 'WebM', exact: true }).click();
		await expect.element(screen.getByRole('heading', { name: 'Export video' })).toBeVisible();
		for (const name of ['Resolution', 'Quality', 'Subtitles', 'Codec']) {
			await expect.element(screen.getByRole('button', { name: new RegExp(name) })).toBeVisible();
		}
	});

	it('shows actual export progress without idle readiness and recovers on cancellation', async () => {
		const previousRoot = getWorkspaceRoot();
		const opfs = await navigator.storage.getDirectory();
		const directory = `export-progress-${crypto.randomUUID()}`;
		setWorkspaceRoot(await opfs.getDirectoryHandle(directory, { create: true }));
		const project = projectFixture();
		project.metadata.width = 480;
		project.metadata.height = 270;
		project.timeline!.compositions = [];
		project.timeline!.topLevelSequenceIds = [];
		sequenceStore.load(project.timeline!, project.metadata);
		const onerror = vi.fn();
		const ondone = vi.fn();
		const screen = await render(ExportDialog, {
			project,
			ondone,
			onerror,
			renderVideo: renderVideoExport
		});
		try {
			await screen.getByRole('button', { name: 'Render full video' }).click();
			await expect.element(screen.getByText('Ready to render', { exact: true })).toBeVisible();
			await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
			await screen.getByRole('button', { name: 'Render now' }).click();
			await expect
				.element(screen.getByRole('status').getByText('Rendering frames', { exact: true }))
				.toBeVisible();
			expect(screen.getByRole('dialog').element().textContent).not.toContain('Ready to render');
			await expect
				.element(screen.getByRole('progressbar', { name: 'Export progress' }))
				.toBeVisible();
		} finally {
			await screen.getByRole('button', { name: 'Cancel export' }).click();
			await expect.element(screen.getByText('Ready to render', { exact: true })).toBeVisible();
			setWorkspaceRoot(previousRoot);
			await opfs.removeEntry(directory, { recursive: true });
		}
		expect(onerror).not.toHaveBeenCalled();
		expect(ondone).not.toHaveBeenCalled();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
	}, 60_000);

	it('exports another sequence at its own dimensions without navigating away from Main', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const renderVideo = vi.fn(async (_project: Project, _options: RenderExportOptions = {}) => ({
			relPath: 'exports/portrait.webm',
			fileName: 'portrait.webm',
			blob: new Blob(['video'], { type: 'video/webm' })
		}));
		const ondone = vi.fn();
		const screen = await render(ExportDialog, {
			project,
			ondone,
			onerror: vi.fn(),
			probeCodec: vi.fn(async () => true),
			renderVideo
		});

		await screen.getByRole('button', { name: 'Render full video' }).click();
		await screen.getByRole('button', { name: 'Sequences' }).click();
		await screen.getByRole('option', { name: 'Portrait cut' }).click();

		await expect.element(screen.getByText('Resolution: 1080 × 1920')).toBeVisible();
		await expect.element(screen.getByText('0:10 long')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		await screen.getByRole('button', { name: 'Render now' }).click();

		await vi.waitFor(() => expect(renderVideo).toHaveBeenCalledOnce());
		const [renderedProject, options] = renderVideo.mock.calls[0]!;
		expect(renderedProject.name).toBe('Portrait cut');
		expect(renderedProject.metadata).toMatchObject({
			width: 1080,
			height: 1920,
			fps: 30
		});
		expect(renderedProject.timeline?.items[0]?.id).toBe('portrait-shape');
		expect(options).toMatchObject({
			width: 1080,
			height: 1920,
			range: { startFrame: 0, endFrame: 300 }
		});
		expect(sequenceStore.activeSequenceId).toBeNull();
		expect(timelineStore.items[0]?.id).toBe('main-shape');
		expect(ondone).toHaveBeenCalledOnce();
	});
});
