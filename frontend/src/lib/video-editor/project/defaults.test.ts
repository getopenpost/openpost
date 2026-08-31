import { afterEach, describe, expect, it } from 'vitest';
import { setLocale } from '$lib/paraglide/runtime';
import {
	createBlankProject,
	createDefaultTracks,
	migrateProjectDocument,
	normalizeProject,
	CURRENT_SCHEMA_VERSION
} from './defaults';
import type { Project } from './types';

afterEach(() => setLocale('en', { reload: false }));

describe('createBlankProject', () => {
	it('creates a normalized 1080p30 project with default tracks', () => {
		const project = createBlankProject('My cut');
		expect(project.name).toBe('My cut');
		expect(project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
		expect(project.metadata).toMatchObject({
			width: 1920,
			height: 1080,
			fps: 30
		});
		expect(project.timeline?.tracks.map((t) => t.id)).toEqual([
			'track-video-overlay',
			'track-video-main',
			'track-audio'
		]);
		expect(project.timeline?.items).toEqual([]);
		expect(project.animationPresets).toEqual([]);
	});

	it('creates a project with explicit canvas settings', () => {
		const project = createBlankProject('Vertical cut', {
			width: 1080,
			height: 1920,
			fps: 60
		});
		expect(project.metadata).toMatchObject({
			width: 1080,
			height: 1920,
			fps: 60
		});
	});

	it('rejects invalid canvas settings at the project boundary', () => {
		expect(() =>
			createBlankProject('Invalid', {
				width: 200,
				height: 1080,
				fps: 29
			})
		).toThrow(RangeError);
	});

	it('generates unique ids', () => {
		expect(createBlankProject().id).not.toBe(createBlankProject().id);
	});

	it('creates project and repair copy in the active locale', () => {
		setLocale('pt', { reload: false });
		const project = createBlankProject();
		expect(project.name).toBe('Projeto sem título');
		expect(project.timeline?.tracks.map((track) => track.name)).toEqual([
			'Sobreposição',
			'Vídeo',
			'Áudio'
		]);

		// SAFETY: This fixture deliberately simulates a stored project that predates the timeline field.
		delete (project as Partial<Project>).timeline;
		expect(normalizeProject(project).warnings).toContainEqual({
			code: 'TIMELINE_MISSING',
			message: 'Este projeto não tinha uma linha temporal, por isso o OpenPost criou uma vazia.'
		});
	});
});

describe('migrateProjectDocument', () => {
	it('normalizes a missing timeline', () => {
		const stored = createBlankProject();
		// SAFETY: test fixture is a complete Project minus the optional timeline.
		delete (stored as Partial<Project>).timeline;
		const result = migrateProjectDocument(stored);
		expect(result.project.timeline?.tracks.length).toBeGreaterThan(0);
		expect(result.warnings.some((w) => w.code === 'TIMELINE_MISSING')).toBe(true);
	});

	it('adds a video track when only audio tracks exist', () => {
		const stored = createBlankProject();
		stored.timeline!.tracks = stored.timeline!.tracks.filter((t) => t.kind === 'audio');
		const { project } = normalizeProject(stored);
		expect(project.timeline!.tracks.some((t) => t.kind !== 'audio')).toBe(true);
	});

	it('preserves valid track groups and repairs empty or orphaned hierarchy on load', () => {
		const stored = createBlankProject();
		const [child, loose] = stored.timeline!.tracks;
		stored.timeline!.tracks = [
			{
				...child!,
				id: 'group',
				name: 'Visuals',
				kind: undefined,
				isGroup: true,
				height: 72
			},
			{ ...child!, parentTrackId: 'group' },
			{ ...loose!, id: 'orphan', parentTrackId: 'missing' },
			{ ...loose!, id: 'empty', isGroup: true, kind: undefined }
		];
		const result = normalizeProject(stored);
		expect(
			result.project.timeline!.tracks.find((track) => track.id === child!.id)?.parentTrackId
		).toBe('group');
		expect(
			result.project.timeline!.tracks.find((track) => track.id === 'orphan')?.parentTrackId
		).toBeUndefined();
		expect(result.project.timeline!.tracks.some((track) => track.id === 'empty')).toBe(false);
		expect(result.warnings.some((warning) => warning.code === 'TRACK_GROUPS_REPAIRED')).toBe(true);
	});

	it('clamps invalid trim-path and taper values on load', () => {
		const stored = createBlankProject();
		stored.timeline!.items = [
			{
				id: 'shape',
				trackId: 'track-video-overlay',
				from: 0,
				durationInFrames: 30,
				label: 'Shape',
				type: 'shape',
				trimPathStart: -25,
				trimPathEnd: 125,
				trimPathOffset: 720,
				taperStartWidth: 250,
				taperEndLength: -10
			}
		];

		const result = normalizeProject(stored);
		expect(result.project.timeline!.items[0]).toMatchObject({
			trimPathStart: 0,
			trimPathEnd: 100,
			trimPathOffset: 360,
			taperStartWidth: 200,
			taperEndLength: 0
		});
		expect(result.warnings.some((warning) => warning.code === 'SHAPE_STYLES_REPAIRED')).toBe(true);
	});

	it('flags future schema versions instead of failing', () => {
		const stored = createBlankProject();
		stored.schemaVersion = CURRENT_SCHEMA_VERSION + 5;
		stored.timeline!.topLevelSequenceIds = ['unknown-future-sequence'];
		const result = migrateProjectDocument(stored);
		expect(result.project.schemaVersion).toBe(CURRENT_SCHEMA_VERSION + 5);
		expect(result.project).toBe(stored);
		expect(result.project.timeline?.topLevelSequenceIds).toEqual(['unknown-future-sequence']);
		expect(result.migrated).toBe(false);
		expect(result.warnings.some((w) => w.code === 'FUTURE_SCHEMA')).toBe(true);
		expect(result.appliedMigrations).toEqual([]);
	});

	it('applies every required migration in order', () => {
		const stored = createBlankProject();
		stored.schemaVersion = 1;
		stored.timeline!.tracks = [
			{ ...createDefaultTracks()[0]!, id: 'later', order: 9 },
			{ ...createDefaultTracks()[1]!, id: 'earlier', order: 2 }
		];
		stored.timeline!.items = [
			{
				id: 'clip',
				trackId: 'earlier',
				from: 0,
				durationInFrames: 30,
				label: 'Clip',
				type: 'video'
			}
		];
		stored.timeline!.transitions = [
			{
				id: 'transition',
				type: 'crossfade',
				durationInFrames: 10,
				fromItemId: 'clip',
				toItemId: 'clip'
			}
		];
		stored.timeline!.compositions = [
			{
				id: 'sequence',
				name: 'Sequence',
				tracks: [
					{ ...createDefaultTracks()[0]!, id: 'nested-later', order: 8 },
					{ ...createDefaultTracks()[1]!, id: 'nested-earlier', order: 1 }
				],
				items: [
					{
						id: 'nested-clip',
						trackId: 'nested-earlier',
						from: 0,
						durationInFrames: 30,
						label: 'Nested clip',
						type: 'video'
					}
				],
				transitions: [],
				fps: 30,
				width: 1920,
				height: 1080,
				durationInFrames: 30
			}
		];

		const result = migrateProjectDocument(stored);
		expect(result.appliedMigrations).toEqual([2, 3, 4, 5, 6]);
		expect(result.project.timeline?.tracks.map((track) => [track.id, track.order])).toEqual([
			['earlier', 0],
			['later', 1]
		]);
		expect(result.project.timeline?.items[0]?.originId).toBe('clip');
		expect(result.project.timeline?.transitions?.[0]?.alignment).toBe(0.5);
		expect(
			result.project.timeline?.compositions?.[0]?.tracks.map((track) => [track.id, track.order])
		).toEqual([
			['nested-earlier', 0],
			['nested-later', 1]
		]);
		expect(result.project.timeline?.compositions?.[0]?.items[0]?.originId).toBe('nested-clip');
	});

	it('is idempotent', () => {
		const first = migrateProjectDocument(createBlankProject());
		const second = migrateProjectDocument(first.project);
		expect(second.warnings).toEqual([]);
		expect(second.appliedMigrations).toEqual([]);
		expect(second.migrated).toBe(false);
	});
});

describe('createDefaultTracks', () => {
	it('orders overlay above main video above audio', () => {
		const tracks = createDefaultTracks();
		expect(tracks.map((t) => t.order)).toEqual([0, 1, 2]);
	});
});
