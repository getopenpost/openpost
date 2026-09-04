import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from 'vitest-browser-svelte';
import '../../../routes/layout.css';
import type { Project, SubComposition, TimelineItem, TimelineTrack } from '../project/types';
import { sequenceStore } from '../sequences/sequence-store.svelte';
import { timelineStore } from '../timeline/stores/timeline-store.svelte';
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
		editorKind: 'sequence',
		items: [shape('portrait-shape', 60)],
		tracks,
		transitions: [],
		fps: 30,
		width: 1080,
		height: 1920,
		durationInFrames: 60
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
});

describe('ExportDialog', () => {
	it('exports another sequence at its own dimensions without navigating away from Main', async () => {
		const project = projectFixture();
		sequenceStore.load(project.timeline!, project.metadata);
		const renderVideo = vi.fn(async () => ({
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
		await expect.element(screen.getByText('0:02 long')).toBeVisible();
		await expect.element(screen.getByRole('button', { name: 'Render now' })).toBeEnabled();
		await screen.getByRole('button', { name: 'Render now' }).click();

		await vi.waitFor(() => expect(renderVideo).toHaveBeenCalledOnce());
		const [renderedProject, options] = renderVideo.mock.calls[0]!;
		expect(renderedProject.name).toBe('Portrait cut');
		expect(renderedProject.metadata).toMatchObject({ width: 1080, height: 1920, fps: 30 });
		expect(renderedProject.timeline?.items[0]?.id).toBe('portrait-shape');
		expect(options).toMatchObject({ width: 1080, height: 1920 });
		expect(sequenceStore.activeSequenceId).toBeNull();
		expect(timelineStore.items[0]?.id).toBe('main-shape');
		expect(ondone).toHaveBeenCalledOnce();
	});
});
