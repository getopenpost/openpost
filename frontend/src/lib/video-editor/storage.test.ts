import { describe, expect, it } from 'vitest';
import type { RecordingManifest } from './types';
import {
	calculateStorageBudget,
	normalizeRecordingManifest,
	projectPath,
	validateProjectPath
} from './storage';

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
