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
		metadata: { width: 1920, height: 1080, fps: 30, backgroundColor: '#111111' },
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
		expect(renderedProject.metadata).toMatchObject({ width: 1080, height: 1920, fps: 30 });
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
