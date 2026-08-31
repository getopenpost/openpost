import type { Project, ProjectTimeline, TimelineItem, TimelineTrack } from './types';

export const CURRENT_SCHEMA_VERSION = 6;

export interface ProjectMigration {
	version: number;
	description: string;
	migrate(project: Project): Project;
}

function renumberTracks(tracks: TimelineTrack[]): TimelineTrack[] {
	return tracks
		.map((track, index) => ({ track, index }))
		.sort((left, right) => {
			const byOrder = (left.track.order ?? left.index) - (right.track.order ?? right.index);
			return byOrder || left.index - right.index;
		})
		.map(({ track }, order) => ({ ...track, order }));
}

function backfillOriginIds(items: TimelineItem[]): TimelineItem[] {
	return items.map((item) => (item.originId ? item : { ...item, originId: item.id }));
}

function migrateTimelineIdentity(timeline: ProjectTimeline): ProjectTimeline {
	return {
		...timeline,
		tracks: renumberTracks(timeline.tracks),
		items: backfillOriginIds(timeline.items),
		transitions: timeline.transitions?.map((transition) => ({
			...transition,
			alignment: transition.alignment ?? 0.5
		})),
		compositions: timeline.compositions?.map((composition) => ({
			...composition,
			tracks: renumberTracks(composition.tracks),
			items: backfillOriginIds(composition.items),
			transitions: composition.transitions.map((transition) => ({
				...transition,
				alignment: transition.alignment ?? 0.5
			}))
		}))
	};
}

const CROP_KEYFRAME_PROPERTIES = [
	'cropLeft',
	'cropRight',
	'cropTop',
	'cropBottom',
	'cropSoftness'
] as const;

function migrateCropKeyframesToPixels(
	items: TimelineItem[],
	projectWidth: number,
	projectHeight: number
): TimelineItem[] {
	return items.map((item) => {
		if (!item.keyframes) return item;
		const width = Math.max(
			1,
			item.compositionWidth ?? item.sourceWidth ?? item.transform?.width ?? projectWidth
		);
		const height = Math.max(
			1,
			item.compositionHeight ?? item.sourceHeight ?? item.transform?.height ?? projectHeight
		);
		const softnessDimension = Math.min(width, height);
		let changed = false;
		const keyframes = { ...item.keyframes };
		for (const property of CROP_KEYFRAME_PROPERTIES) {
			const track = item.keyframes[property];
			if (!track) continue;
			const dimension =
				property === 'cropLeft' || property === 'cropRight'
					? width
					: property === 'cropTop' || property === 'cropBottom'
						? height
						: softnessDimension;
			const values = track.values.map((value) => {
				// The old inspector and canvas gizmo wrote ratios. Values outside the
				// ratio range could only have come from the pixel-labelled graph editor.
				if (Math.abs(value) > 1) return value;
				changed = true;
				return value * dimension;
			});
			keyframes[property] = { ...track, values };
		}
		return changed ? { ...item, keyframes } : item;
	});
}

/**
 * Append-only project migrations keyed by their target version. Never change
 * an existing migration after release. Add the next version instead.
 */
const PROJECT_MIGRATIONS: ReadonlyMap<number, ProjectMigration> = new Map([
	[
		2,
		{
			version: 2,
			description: 'Add reusable sequence storage',
			migrate: (project) => project
		}
	],
	[
		3,
		{
			version: 3,
			description: 'Stabilize timeline identities and transition alignment',
			migrate: (project) =>
				project.timeline
					? { ...project, timeline: migrateTimelineIdentity(project.timeline) }
					: project
		}
	],
	[
		4,
		{
			version: 4,
			description: 'Add procedural background items with clone-safe defaults',
			migrate: (project) => {
				if (!project.timeline) return project;
				const patchItems = (items: TimelineItem[]): TimelineItem[] =>
					items.map((item) =>
						item.type === 'background' && !item.background
							? {
									...item,
									background: {
										kind: 'mesh-gradient',
										colors: ['#ff7a18', '#af002d', '#319197', '#1a1a2e'],
										smoothness: 0.55,
										rotation: 0,
										scale: 1,
										offsetX: 0,
										offsetY: 0
									}
								}
							: item
					);
				return {
					...project,
					timeline: {
						...project.timeline,
						items: patchItems(project.timeline.items),
						compositions: project.timeline.compositions?.map((c) => ({
							...c,
							items: patchItems(c.items)
						}))
					}
				};
			}
		}
	],
	[
		5,
		{
			version: 5,
			description: 'Identify the OpenPost project schema family',
			migrate: (project) => ({ ...project, schemaFamily: 'openpost' })
		}
	],
	[
		6,
		{
			version: 6,
			description: 'Store crop keyframes in source pixels',
			migrate: (project) => {
				if (!project.timeline) return project;
				return {
					...project,
					timeline: {
						...project.timeline,
						items: migrateCropKeyframesToPixels(
							project.timeline.items,
							project.metadata.width,
							project.metadata.height
						),
						compositions: project.timeline.compositions?.map((composition) => ({
							...composition,
							items: migrateCropKeyframesToPixels(
								composition.items,
								composition.width,
								composition.height
							)
						}))
					}
				};
			}
		}
	]
]);

export function getMigrationsToApply(fromVersion: number, toVersion: number): ProjectMigration[] {
	const migrations: ProjectMigration[] = [];
	for (let version = fromVersion + 1; version <= toVersion; version += 1) {
		const migration = PROJECT_MIGRATIONS.get(version);
		if (!migration) throw new Error(`Missing project migration for schema ${version}`);
		migrations.push(migration);
	}
	return migrations;
}
