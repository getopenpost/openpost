import type { VideoConstraint, VideoMetadata } from './types';

const DEFAULT_UPLOAD_LIMIT = 5 * 1024 * 1024 * 1024;

export interface EffectiveVideoConstraints {
	maxBytes: number;
	maxDurationSeconds: number;
	allowedMIMEs: string[];
	aspectRatios: string[];
}

export function effectiveVideoConstraints(
	constraints: VideoConstraint[]
): EffectiveVideoConstraints {
	const maxBytes = minimumPositive(
		constraints.map((constraint) => constraint.max_size_bytes),
		DEFAULT_UPLOAD_LIMIT
	);
	const maxDurationSeconds = minimumPositive(
		constraints.map((constraint) => constraint.max_duration_seconds),
		Number.POSITIVE_INFINITY
	);
	const allowedMIMEs =
		constraints.length === 0
			? ['video/mp4']
			: intersect(
					constraints.map((constraint) =>
						(constraint.allowed_mimes ?? []).filter((mime) => mime.startsWith('video/'))
					)
				);
	const aspectRatios = intersect(
		constraints
			.map((constraint) => constraint.aspect_ratios ?? [])
			.filter((ratios) => ratios.length > 0)
	);

	return {
		maxBytes,
		maxDurationSeconds,
		allowedMIMEs: allowedMIMEs.length > 0 ? allowedMIMEs : ['video/mp4'],
		aspectRatios
	};
}

export function isCanonicalPlatformVideo(metadata: VideoMetadata): boolean {
	return (
		metadata.mimeType === 'video/mp4' &&
		metadata.videoCodec === 'avc' &&
		(metadata.audioCodec === null || metadata.audioCodec === 'aac')
	);
}

export function formatBytes(bytes: number): string {
	if (!Number.isFinite(bytes)) return 'the platform limit';
	if (bytes < 1024) return `${Math.max(0, Math.round(bytes))} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
	if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

function minimumPositive(values: Array<number | undefined>, fallback: number): number {
	const candidates = values.filter(
		(value): value is number => Number.isFinite(value) && Number(value) > 0
	);
	return candidates.length > 0 ? Math.min(...candidates) : fallback;
}

function intersect(groups: string[][]): string[] {
	if (groups.length === 0) return [];
	return groups
		.slice(1)
		.reduce((common, group) => common.filter((item) => group.includes(item)), [...groups[0]]);
}
