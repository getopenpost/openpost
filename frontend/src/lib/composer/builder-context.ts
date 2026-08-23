export interface BuilderClaimContext {
	text: string;
	status: string;
}

export interface BuilderMediaContext {
	treatment: string;
	role: string;
	brief: string;
}

export interface BuilderVoiceContext {
	accountId: string;
	id: string;
	name: string;
	revision: number;
}

export interface BuilderDestinationContext {
	accountId: string;
	platform: string;
	objective: string;
	archetype: string;
	outputProfile: string;
	preview: string;
	media: BuilderMediaContext;
}

export interface BuilderSkippedContext {
	accountId: string;
	platform: string;
	reason: string;
}

export interface BuilderReviewFlagContext {
	accountId: string;
	field: string;
	severity: string;
	message: string;
}

export interface BuilderContext {
	buildId: string;
	voiceProfileId: string;
	route: string;
	thesis: string;
	angle: string;
	voices: BuilderVoiceContext[];
	claims: BuilderClaimContext[];
	media: BuilderMediaContext;
	destinations: BuilderDestinationContext[];
	skipped: BuilderSkippedContext[];
	reviewFlags: BuilderReviewFlagContext[];
}

interface RawBuilderMetadata {
	builder?: unknown;
}

interface RawBuilderContext {
	build_id?: unknown;
	voice_profile_id?: unknown;
	route?: unknown;
	thesis?: unknown;
	angle?: unknown;
	voices?: unknown;
	claims?: unknown;
	media?: unknown;
	destinations?: unknown;
	skipped?: unknown;
	review_flags?: unknown;
}

interface RawVoiceContext {
	account_id?: unknown;
	id?: unknown;
	name?: unknown;
	revision?: unknown;
}

interface RawClaimContext {
	text?: unknown;
	status?: unknown;
}

interface RawMediaContext {
	treatment?: unknown;
	role?: unknown;
	brief?: unknown;
}

interface RawDestinationContext {
	account_id?: unknown;
	platform?: unknown;
	objective?: unknown;
	archetype?: unknown;
	output_profile?: unknown;
	preview?: unknown;
	media?: unknown;
}

interface RawSkippedContext {
	account_id?: unknown;
	platform?: unknown;
	reason?: unknown;
}

interface RawReviewFlagContext {
	account_id?: unknown;
	field?: unknown;
	severity?: unknown;
	message?: unknown;
}

export function parseBuilderContext(metadata: unknown): BuilderContext | null {
	const root = parseObject<RawBuilderMetadata>(metadata);
	const builder = parseObject<RawBuilderContext>(root?.builder);
	if (!builder || !parseText(builder.build_id)) return null;
	return {
		buildId: parseText(builder.build_id),
		voiceProfileId: parseText(builder.voice_profile_id),
		route: parseText(builder.route),
		thesis: parseText(builder.thesis),
		angle: parseText(builder.angle),
		voices: parseArray(builder.voices).flatMap((value) => {
			const voice = parseObject<RawVoiceContext>(value);
			const accountId = parseText(voice?.account_id);
			const name = parseText(voice?.name);
			if (!accountId || !name) return [];
			return [
				{
					accountId,
					id: parseText(voice?.id),
					name,
					revision: parseNonnegativeInteger(voice?.revision)
				}
			];
		}),
		claims: parseArray(builder.claims).flatMap((value) => {
			const claim = parseObject<RawClaimContext>(value);
			const claimText = parseText(claim?.text);
			return claimText ? [{ text: claimText, status: parseText(claim?.status) }] : [];
		}),
		media: parseMedia(builder.media),
		destinations: parseArray(builder.destinations).flatMap((value) => {
			const destination = parseObject<RawDestinationContext>(value);
			const accountId = parseText(destination?.account_id);
			const platform = parseText(destination?.platform);
			if (!accountId || !platform) return [];
			return [
				{
					accountId,
					platform,
					objective: parseText(destination?.objective),
					archetype: parseText(destination?.archetype),
					outputProfile: parseText(destination?.output_profile),
					preview: parseText(destination?.preview),
					media: parseMedia(destination?.media)
				}
			];
		}),
		skipped: parseArray(builder.skipped).flatMap((value) => {
			const skipped = parseObject<RawSkippedContext>(value);
			const accountId = parseText(skipped?.account_id);
			const platform = parseText(skipped?.platform);
			if (!accountId || !platform) return [];
			return [{ accountId, platform, reason: parseText(skipped?.reason) }];
		}),
		reviewFlags: parseArray(builder.review_flags).flatMap((value) => {
			const flag = parseObject<RawReviewFlagContext>(value);
			const message = parseText(flag?.message);
			if (!message) return [];
			return [
				{
					accountId: parseText(flag?.account_id),
					field: parseText(flag?.field),
					severity: parseText(flag?.severity),
					message
				}
			];
		})
	};
}

function parseObject<T extends object>(value: unknown): T | null {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return null;
	// SAFETY: Callers supply a closed raw interface whose properties remain unknown until parsed below.
	return value as T;
}

function parseArray(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function parseText(value: unknown): string {
	return typeof value === 'string' ? value.trim() : '';
}

function parseNonnegativeInteger(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : 0;
}

function parseMedia(value: unknown): BuilderMediaContext {
	const source = parseObject<RawMediaContext>(value);
	return {
		treatment: parseText(source?.treatment),
		role: parseText(source?.role),
		brief: parseText(source?.brief)
	};
}
