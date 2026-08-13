import { describe, expect, it, vi } from 'vitest';
import type { LocalAssetIndex, RecordingManifest, StorageBudget } from './types';
import {
	calculateStorageBudget,
	executeDisposableAssetCleanup,
	normalizeRecordingManifest,
	normalizeLocalAssetIndex,
	planDisposableAssetCleanup,
	projectPath,
	recoverVideoStorageBudget,
	refreshLocalAssetAccess,
	validateProjectPath
} from './storage';

const DAY_MS = 24 * 60 * 60 * 1_000;

function asset(
	id: string,
	lastAccessedAt: string,
	overrides: Partial<LocalAssetIndex> = {}
): LocalAssetIndex {
	return {
		id,
		project_id: 'project',
		source_id: 'source',
		path: `projects/project/proxies/${id}.webm`,
		kind: 'proxy',
		size_bytes: 10,
		created_at: '2026-07-01T00:00:00.000Z',
		updated_at: '2026-07-02T00:00:00.000Z',
		last_accessed_at: lastAccessedAt,
		disposable: true,
		...overrides
	};
}

describe('OpenPost Video Editor storage budget', () => {
	it('reserves twenty percent transient headroom', () => {
		const budget = calculateStorageBudget(100, 1_300, 1_000);
		expect(budget.headroom_bytes).toBe(200);
		expect(budget.can_continue).toBe(true);
	});

	it('fails closed when quota information is unavailable', () => {
		expect(calculateStorageBudget(0, 0, 1).can_continue).toBe(false);
	});
});

describe('OpenPost Video Editor OPFS paths', () => {
	it('builds a scoped project path', () => {
		expect(projectPath('project 1', 'sources', 'source one.mp4')).toBe(
			'projects/project-1/sources/source-one.mp4'
		);
	});

	it('rejects traversal and paths outside projects', () => {
		expect(() => validateProjectPath('projects/a/sources/../secret')).toThrow();
		expect(() => validateProjectPath('other/a/sources/file')).toThrow();
	});
});

describe('OpenPost Video Editor disposable cache lifecycle', () => {
	it('migrates legacy indexes to last-access semantics and refreshes reads', () => {
		const legacy = normalizeLocalAssetIndex({
			id: 'legacy',
			project_id: 'project',
			source_id: 'source',
			path: 'projects/project/proxies/legacy.webm',
			kind: 'proxy',
			size_bytes: 10,
			created_at: '2026-07-01T00:00:00.000Z',
			updated_at: '2026-07-02T00:00:00.000Z',
			disposable: true
		});
		expect(legacy.last_accessed_at).toBe(legacy.updated_at);

		const now = Date.parse('2026-08-09T12:00:00.000Z');
		const refreshed = refreshLocalAssetAccess(legacy, now, 0);
		expect(refreshed.last_accessed_at).toBe('2026-08-09T12:00:00.000Z');
		expect(refreshLocalAssetAccess(refreshed, now + 1_000).last_accessed_at).toBe(
			refreshed.last_accessed_at
		);
	});

	it('expires by last access while protecting recent, active, and referenced assets', () => {
		const now = Date.parse('2026-08-09T12:00:00.000Z');
		const expired = asset('expired', new Date(now - 8 * DAY_MS).toISOString());
		const recent = asset('recent', new Date(now - DAY_MS).toISOString());
		const active = asset('active', new Date(now - 10 * DAY_MS).toISOString(), {
			project_id: 'active-project',
			path: 'projects/active-project/proxies/active.webm'
		});
		const referenced = asset('referenced', new Date(now - 10 * DAY_MS).toISOString());
		const permanent = asset('permanent', new Date(now - 10 * DAY_MS).toISOString(), {
			disposable: false
		});

		expect(
			planDisposableAssetCleanup([recent, active, referenced, permanent, expired], {
				now,
				protectedProjectIDs: ['active-project'],
				protectedPaths: [referenced.path]
			}).map((candidate) => candidate.id)
		).toEqual(['expired']);
	});

	it('bounds pressure cleanup and selects least-recently-used assets first', () => {
		const assets = [
			asset('newest', '2026-08-09T00:00:00.000Z'),
			asset('oldest', '2026-08-01T00:00:00.000Z'),
			asset('middle', '2026-08-05T00:00:00.000Z')
		];
		expect(
			planDisposableAssetCleanup(assets, {
				mode: 'pressure',
				targetBytes: 20,
				maxAssets: 2,
				maxBytes: 20
			}).map((candidate) => candidate.id)
		).toEqual(['oldest', 'middle']);
	});

	it('finishes the current deletion and stops before the next asset when interrupted', async () => {
		const controller = new AbortController();
		const remove = vi.fn(async () => {
			controller.abort();
			return true;
		});
		const result = await executeDisposableAssetCleanup(
			[asset('first', '2026-08-01T00:00:00.000Z'), asset('second', '2026-08-02T00:00:00.000Z')],
			remove,
			controller.signal
		);

		expect(remove).toHaveBeenCalledTimes(1);
		expect(result).toMatchObject({
			removed_count: 1,
			removed_bytes: 10,
			interrupted: true
		});
	});

	it('re-estimates quota after a bounded pressure cleanup', async () => {
		const budgets: StorageBudget[] = [
			calculateStorageBudget(950, 1_000, 100),
			calculateStorageBudget(800, 1_000, 100)
		];
		const estimate = vi.fn(async () => budgets.shift()!);
		const cleanup = vi.fn(async () => ({
			planned_count: 1,
			removed_count: 1,
			removed_bytes: 70,
			skipped_active_count: 0,
			failed_count: 0,
			interrupted: false
		}));

		const recovered = await recoverVideoStorageBudget(
			100,
			{ protectedProjectIDs: ['open-project'] },
			{ estimate, cleanup }
		);

		expect(recovered.can_continue).toBe(true);
		expect(estimate).toHaveBeenCalledTimes(2);
		expect(cleanup).toHaveBeenCalledWith(
			expect.objectContaining({
				mode: 'pressure',
				targetBytes: 70,
				protectedProjectIDs: ['open-project']
			})
		);
	});

	it('does not delete caches when the browser withholds quota information', async () => {
		const cleanup = vi.fn();
		const unavailable = calculateStorageBudget(0, 0, 100);
		const result = await recoverVideoStorageBudget(
			100,
			{},
			{ estimate: async () => unavailable, cleanup }
		);

		expect(result).toBe(unavailable);
		expect(cleanup).not.toHaveBeenCalled();
	});
});

describe('OpenPost Video Editor recording manifest migration', () => {
	it('keeps nonzero track offsets separate from media duration', () => {
		const manifest = normalizeRecordingManifest({
			manifest_version: 2,
			id: 'recording',
			project_id: 'project',
			created_at: '2026-07-30T00:00:00.000Z',
			updated_at: '2026-07-30T00:00:00.000Z',
			session_epoch_ms: 1_000,
			session_started_at: 1_000,
			last_flushed_at: 1_000,
			flush_sequence: 2,
			finalization_state: 'complete',
			state: 'complete',
			events: [],
			tracks: [
				{
					id: 'camera',
					kind: 'camera',
					path: 'projects/project/recordings/camera.webm',
					mime_type: 'video/webm',
					session_start_offset_us: 4_000_000,
					start_offset_us: 14_000_000,
					duration_us: 6_000_000,
					bytes_written: 10,
					verified_byte_length: 10,
					last_chunk_index: 0,
					last_chunk_timestamp_us: 10_000_000,
					chunks: [],
					segments: [],
					state: 'complete'
				}
			]
		} satisfies RecordingManifest);

		expect(manifest.tracks[0]?.session_start_offset_us).toBe(4_000_000);
		expect(manifest.tracks[0]?.start_offset_us).toBe(14_000_000);
		expect(manifest.tracks[0]?.duration_us).toBe(6_000_000);
	});

	it('builds a recoverable segment for a development V1 manifest', () => {
		const manifest = normalizeRecordingManifest({
			manifest_version: 1,
			id: 'recording',
			project_id: 'project',
			created_at: '2026-07-30T00:00:00.000Z',
			updated_at: '2026-07-30T00:00:00.000Z',
			session_started_at: 1_000,
			last_flushed_at: 1_000,
			state: 'recording',
			tracks: [
				{
					id: 'screen',
					kind: 'screen',
					path: 'projects/project/recordings/screen.webm',
					mime_type: 'video/webm',
					start_offset_us: 2_000_000,
					duration_us: 3_000_000,
					bytes_written: 10,
					last_chunk_index: -1,
					last_chunk_timestamp_us: 3_000_000,
					chunks: [],
					state: 'interrupted'
				}
			]
		} as unknown as RecordingManifest);

		expect(manifest.manifest_version).toBe(2);
		expect(manifest.finalization_state).toBe('open');
		expect(manifest.tracks[0]?.segments).toEqual([
			expect.objectContaining({
				session_start_us: 2_000_000,
				session_end_us: 5_000_000,
				media_end_us: 3_000_000,
				reason_started: 'recovery'
			})
		]);
	});
});
