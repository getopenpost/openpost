import { effectiveVideoConstraints } from '$lib/video/constraints';
import type { VideoConstraint } from '$lib/video/types';

export type VideoVariantID = 'portrait' | 'feed-portrait' | 'square' | 'landscape';

export interface VideoHandoffTarget {
	account_id: string;
	rendition_id?: string;
	output_profile: string;
	aspect_ratios: string[];
}

export interface VideoHandoffPlan {
	primary_variant: VideoVariantID;
	required_variants: VideoVariantID[];
	variant_renditions: Record<VideoVariantID, string[]>;
	variant_accounts: Record<VideoVariantID, string[]>;
}

const variants: Array<{ id: VideoVariantID; ratio: number }> = [
	{ id: 'portrait', ratio: 9 / 16 },
	{ id: 'feed-portrait', ratio: 4 / 5 },
	{ id: 'square', ratio: 1 },
	{ id: 'landscape', ratio: 16 / 9 }
];

function ratioValue(value: string): number | null {
	const match = value.trim().match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)$/u);
	if (!match) return null;
	const width = Number(match[1]);
	const height = Number(match[2]);
	return width > 0 && height > 0 ? width / height : null;
}

function closestVariant(ratio: number): VideoVariantID {
	return variants.reduce((best, candidate) =>
		Math.abs(Math.log(candidate.ratio / ratio)) < Math.abs(Math.log(best.ratio / ratio))
			? candidate
			: best
	).id;
}

function profilePreference(outputProfile: string): VideoVariantID | null {
	const profile = outputProfile.toLowerCase();
	if (/(?:story|reel|short|tiktok)/u.test(profile)) return 'portrait';
	if (/(?:feed-portrait|portrait-feed)/u.test(profile)) return 'feed-portrait';
	if (/(?:youtube\.video|landscape)/u.test(profile)) return 'landscape';
	return null;
}

function chooseTargetVariant(target: VideoHandoffTarget, sourceRatio: number): VideoVariantID {
	const allowed = target.aspect_ratios
		.map(ratioValue)
		.filter((value): value is number => value !== null)
		.map(closestVariant);
	const candidates = variants.filter(
		(candidate) => allowed.length === 0 || allowed.includes(candidate.id)
	);
	const preferred = profilePreference(target.output_profile);
	return candidates.reduce((best, candidate) => {
		const score =
			Math.abs(Math.log(candidate.ratio / sourceRatio)) +
			(preferred && candidate.id !== preferred ? 2 : 0);
		const bestScore =
			Math.abs(Math.log(best.ratio / sourceRatio)) + (preferred && best.id !== preferred ? 2 : 0);
		return score < bestScore ? candidate : best;
	}).id;
}

export function planVideoComposerHandoff(
	targets: VideoHandoffTarget[],
	source: { width?: number; height?: number } = {}
): VideoHandoffPlan {
	const sourceRatio =
		(source.width ?? 0) > 0 && (source.height ?? 0) > 0 ? source.width! / source.height! : 9 / 16;
	const assignments = targets.map((target) => ({
		target,
		variant: chooseTargetVariant(target, sourceRatio)
	}));
	const required = Array.from(
		new Set(assignments.map((assignment) => assignment.variant))
	) as VideoVariantID[];
	if (required.length === 0) required.push(closestVariant(sourceRatio));
	const primary = required.reduce((best, candidate) => {
		const candidateRatio = variants.find((variant) => variant.id === candidate)?.ratio ?? 1;
		const bestRatio = variants.find((variant) => variant.id === best)?.ratio ?? 1;
		return Math.abs(Math.log(candidateRatio / sourceRatio)) <
			Math.abs(Math.log(bestRatio / sourceRatio))
			? candidate
			: best;
	});
	const variantRenditions = Object.fromEntries(
		variants.map(({ id }) => [
			id,
			assignments
				.filter((assignment) => assignment.variant === id)
				.flatMap((assignment) =>
					assignment.target.rendition_id ? [assignment.target.rendition_id] : []
				)
		])
	) as Record<VideoVariantID, string[]>;
	const variantAccounts = Object.fromEntries(
		variants.map(({ id }) => [
			id,
			assignments
				.filter((assignment) => assignment.variant === id)
				.map((assignment) => assignment.target.account_id)
		])
	) as Record<VideoVariantID, string[]>;
	return {
		primary_variant: primary,
		required_variants: required,
		variant_renditions: variantRenditions,
		variant_accounts: variantAccounts
	};
}

export function videoReturnConstraints(
	constraints: VideoConstraint[],
	plan: VideoHandoffPlan,
	extra: Record<string, unknown> = {}
): Record<string, unknown> {
	const effective = effectiveVideoConstraints(constraints);
	return {
		allowed_mimes: effective.allowedMIMEs,
		...(Number.isFinite(effective.maxDurationSeconds)
			? { max_duration_ms: Math.round(effective.maxDurationSeconds * 1_000) }
			: {}),
		...(Number.isFinite(effective.maxBytes) ? { max_file_size_bytes: effective.maxBytes } : {}),
		required_variants: plan.required_variants,
		rendition_ids: Object.values(plan.variant_renditions).flat(),
		...extra
	};
}

export function replaceOrAppendMediaID(
	current: string[],
	replaceID: string | undefined,
	replacementID: string,
	limit: number
): string[] {
	const next =
		replaceID && current.includes(replaceID)
			? current.map((id) => (id === replaceID ? replacementID : id))
			: [...current, replacementID];
	return Array.from(new Set(next.filter(Boolean))).slice(0, Math.max(1, limit));
}
