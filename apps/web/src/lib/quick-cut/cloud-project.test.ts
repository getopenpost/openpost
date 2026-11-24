import { describe, expect, it, vi } from 'vitest';
import type { CloudVideoProject } from '$lib/video-editor/cloud/project-repository';
import { createNewProject } from './project';
import type { QuickCutSource } from './types';
import {
	quickCutCloudDocument,
	loadQuickCutCloudProject,
	syncQuickCutCloudProject,
	type QuickCutCloudDocument,
	type QuickCutCloudRepository
} from './cloud-project';

function source(id: string, file?: File): QuickCutSource {
	const result: QuickCutSource = {
		id,
		name: `${id}.mp4`,
		size: file?.size ?? 5,
		mimeType: 'video/mp4',
		duration: 3,
		width: 1920,
		height: 1080,
		videoCodec: 'avc1',
		audioCodec: 'aac',
		sampleRate: 48_000,
		channels: 2,
		rotation: 0,
		fps: 30,
		keyframeTimestamps: [0],
		keyframeState: 'known',
		videoStreams: [],
		audioStreams: []
	};
	if (file) result.file = file;
	return result;
}

function remote(document: QuickCutCloudDocument): CloudVideoProject<QuickCutCloudDocument> {
	return {
		id: document.id,
		workspaceId: 'workspace-1',
		name: document.name,
		headRevision: 1,
		document,
		syncStatus: 'synced',
		attentionReason: '',
		trashedAt: '',
		updatedAt: '2026-09-06T00:00:00Z'
	};
}

describe('Quick Cut cloud projects', () => {
	it('creates once, uploads only missing source assets, and saves later edits', async () => {
		const first = source('source-1', new File(['first'], 'source-1.mp4', { type: 'video/mp4' }));
		const second = source('source-2', new File(['second'], 'source-2.mp4', { type: 'video/mp4' }));
		first.transcript = {
			audioTrackIndex: 0,
			words: [{ text: 'Private source words', start: 0, end: 0.5 }]
		};
		const project = createNewProject([first, second]);
		const initialDocument = quickCutCloudDocument(project);
		const cloudProject = remote(initialDocument);
		const createWithId = vi.fn().mockResolvedValue(cloudProject);
		const save = vi.fn().mockResolvedValue(undefined);
		const reserveAsset = vi.fn().mockResolvedValue('reservation-2');
		const repository = {
			workspaceId: 'workspace-1',
			createWithId,
			save,
			listMedia: vi.fn().mockResolvedValue([{ id: 'source-1' }]),
			reserveAsset
		} satisfies QuickCutCloudRepository;
		const upload = vi.fn().mockResolvedValue(undefined);

		const session = await syncQuickCutCloudProject(repository, null, project, [first, second], {
			hash: vi.fn().mockResolvedValue('b'.repeat(64)),
			upload
		});
		expect(createWithId).toHaveBeenCalledOnce();
		expect(createWithId.mock.calls[0]![2].timeline.sources[0]).not.toHaveProperty('transcript');
		expect(first.transcript.words[0].text).toBe('Private source words');
		expect(reserveAsset).toHaveBeenCalledWith(project.id, {
			stableMediaId: 'source-2',
			fileName: 'source-2.mp4',
			mimeType: 'video/mp4',
			size: 6,
			sha256: 'b'.repeat(64)
		});
		expect(upload).toHaveBeenCalledOnce();

		project.merge = true;
		await syncQuickCutCloudProject(repository, session, project, [first, second], {
			hash: vi.fn(),
			upload
		});
		expect(createWithId).toHaveBeenCalledOnce();
		expect(upload).toHaveBeenCalledOnce();
		expect(save.mock.calls.at(-1)![1].timeline.sources[0]).not.toHaveProperty('transcript');
		expect(save).toHaveBeenLastCalledWith(
			cloudProject,
			expect.objectContaining({
				settings: expect.objectContaining({ merge: true })
			})
		);
	});

	it('hydrates required originals only when a cloud project is opened', async () => {
		const project = createNewProject([source('source-1')]);
		const cloudProject = remote(quickCutCloudDocument(project));
		const download = vi.fn().mockResolvedValue(new Blob(['video'], { type: 'video/mp4' }));
		const repository = {
			workspaceId: 'workspace-1',
			listSummaries: vi.fn(),
			get: vi.fn().mockResolvedValue(cloudProject),
			createWithId: vi.fn(),
			save: vi.fn(),
			listMedia: vi
				.fn()
				.mockResolvedValue([{ id: 'source-1', remoteUrl: '/api/v1/media/source-1/content' }]),
			reserveAsset: vi.fn()
		};

		const opened = await loadQuickCutCloudProject(repository, project.id, {
			download
		});
		expect(download).toHaveBeenCalledWith('/api/v1/media/source-1/content');
		expect(opened.sources[0]?.file).toMatchObject({
			name: 'source-1.mp4',
			size: 5
		});
		expect(opened.session.availableAssetIds).toEqual(new Set(['source-1']));
	});
});
