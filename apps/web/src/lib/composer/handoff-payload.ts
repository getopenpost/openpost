import type { components } from '$lib/api/types';
import type { HandoffJSONValue } from '$lib/editor-handoff';
import type { PostItem, VariantPost } from '$lib/components/compose/draft-utils';
import type { ComposerSettings, ComposerSettingValue } from '$lib/components/compose/modes';

export interface ComposerHandoffPayload {
	posts: PostItem[];
	variants: Array<[string, Record<string, VariantPost>]>;
	active_post_index: number;
	selected_account_ids: string[];
	selected_social_set_id: string;
	requested_output_profiles: Record<string, string>;
	format_locked_by_account: Record<string, boolean>;
	schedule_overrides_by_account: Record<string, string>;
	active_variant_account_id: string | null;
	publication_id: string;
	link_url: string;
	settings_by_account: Record<string, ComposerSettings>;
	segment_settings_by_post: Record<string, Record<string, ComposerSettings>>;
	media_settings_by_account: Record<string, Record<string, ComposerSettings>>;
	media_alt_texts: Array<[string, string]>;
	media_mime_types: Array<[string, string]>;
	media_sizes: Array<[string, number]>;
	selected_date?: string;
	selected_time: string | null;
	random_delay_override: string;
	repost_override: components['schemas']['Override'];
	revision: number;
}

function valueFields(value: HandoffJSONValue | undefined): Map<string, HandoffJSONValue> {
	if (value === null || Array.isArray(value) || !(value instanceof Object)) return new Map();
	return new Map(Object.entries(value));
}

function stringValue(value: HandoffJSONValue | undefined): string | undefined {
	return String(value) === value ? String(value) : undefined;
}

function numberValue(value: HandoffJSONValue | undefined): number | undefined {
	return Number.isFinite(value) ? Number(value) : undefined;
}

function booleanValue(value: HandoffJSONValue | undefined): boolean | undefined {
	return Boolean(value) === value ? Boolean(value) : undefined;
}

function stringArray(value: HandoffJSONValue | undefined): string[] | undefined {
	if (!Array.isArray(value) || !value.every((item) => String(item) === item)) return undefined;
	return value.map(String);
}

function stringRecord(value: HandoffJSONValue | undefined): Record<string, string> {
	const entries: Array<[string, string]> = [];
	for (const [key, entry] of valueFields(value)) {
		const parsed = stringValue(entry);
		if (parsed !== undefined) entries.push([key, parsed]);
	}
	return Object.fromEntries(entries);
}

function booleanRecord(value: HandoffJSONValue | undefined): Record<string, boolean> {
	const entries: Array<[string, boolean]> = [];
	for (const [key, entry] of valueFields(value)) {
		const parsed = booleanValue(entry);
		if (parsed !== undefined) entries.push([key, parsed]);
	}
	return Object.fromEntries(entries);
}

export function parseComposerSettingValue(
	value: HandoffJSONValue | undefined
): ComposerSettingValue {
	if (value === null) return null;
	const string = stringValue(value);
	if (string !== undefined) return string;
	const number = numberValue(value);
	if (number !== undefined) return number;
	const boolean = booleanValue(value);
	if (boolean !== undefined) return boolean;
	if (Array.isArray(value)) {
		const strings = stringArray(value);
		if (strings) return strings;
		if (value.every(Number.isFinite)) return value.map(Number);
		if (value.every((item) => Boolean(item) === item)) return value.map(Boolean);
	}
	return '';
}

export function parseComposerSettings(value: HandoffJSONValue | undefined): ComposerSettings {
	return Object.fromEntries(
		[...valueFields(value)].map(([key, entry]) => [key, parseComposerSettingValue(entry)])
	);
}

function nestedComposerSettings(
	value: HandoffJSONValue | undefined
): Record<string, ComposerSettings> {
	return Object.fromEntries(
		[...valueFields(value)].map(([key, entry]) => [key, parseComposerSettings(entry)])
	);
}

function doubleNestedComposerSettings(
	value: HandoffJSONValue | undefined
): Record<string, Record<string, ComposerSettings>> {
	return Object.fromEntries(
		[...valueFields(value)].map(([key, entry]) => [key, nestedComposerSettings(entry)])
	);
}

function parsePost(value: HandoffJSONValue): PostItem | null {
	const fields = valueFields(value);
	const key = stringValue(fields.get('key'));
	const content = stringValue(fields.get('content'));
	const mediaIds = stringArray(fields.get('mediaIds'));
	if (!key || content === undefined || !mediaIds) return null;
	const post: PostItem = { key, content, mediaIds };
	const id = stringValue(fields.get('id'));
	if (id) post.id = id;
	return post;
}

function parsePosts(value: HandoffJSONValue | undefined): PostItem[] | null {
	if (!Array.isArray(value)) return null;
	const posts: PostItem[] = [];
	for (const entry of value) {
		const post = parsePost(entry);
		if (!post) return null;
		posts.push(post);
	}
	return posts.length > 0 ? posts : null;
}

function parseVariantPost(value: HandoffJSONValue): VariantPost | null {
	const fields = valueFields(value);
	const content = stringValue(fields.get('content'));
	const mediaIds = stringArray(fields.get('mediaIds'));
	if (content === undefined || !mediaIds) return null;
	const post: VariantPost = { content, mediaIds };
	const contentInherited = booleanValue(fields.get('contentInherited'));
	const mediaInherited = booleanValue(fields.get('mediaInherited'));
	if (contentInherited !== undefined) post.contentInherited = contentInherited;
	if (mediaInherited !== undefined) post.mediaInherited = mediaInherited;
	return post;
}

function parseVariants(
	value: HandoffJSONValue | undefined
): Array<[string, Record<string, VariantPost>]> | null {
	if (!Array.isArray(value)) return null;
	const variants: Array<[string, Record<string, VariantPost>]> = [];
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2) return null;
		const accountID = stringValue(entry[0]);
		if (!accountID) return null;
		const posts: Array<[string, VariantPost]> = [];
		for (const [postKey, postValue] of valueFields(entry[1])) {
			const post = parseVariantPost(postValue);
			if (!post) return null;
			posts.push([postKey, post]);
		}
		variants.push([accountID, Object.fromEntries(posts)]);
	}
	return variants;
}

function stringEntries(value: HandoffJSONValue | undefined): Array<[string, string]> {
	if (!Array.isArray(value)) return [];
	const entries: Array<[string, string]> = [];
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const key = stringValue(entry[0]);
		const item = stringValue(entry[1]);
		if (key && item !== undefined) entries.push([key, item]);
	}
	return entries;
}

function numberEntries(value: HandoffJSONValue | undefined): Array<[string, number]> {
	if (!Array.isArray(value)) return [];
	const entries: Array<[string, number]> = [];
	for (const entry of value) {
		if (!Array.isArray(entry) || entry.length !== 2) continue;
		const key = stringValue(entry[0]);
		const item = numberValue(entry[1]);
		if (key && item !== undefined) entries.push([key, item]);
	}
	return entries;
}

function repostRule(
	value: HandoffJSONValue | undefined
): components['schemas']['Rule'] | undefined {
	const fields = valueFields(value);
	const delaySeconds = numberValue(fields.get('delay_seconds'));
	const evaluationWindowSeconds = numberValue(fields.get('evaluation_window_seconds'));
	const minComments = numberValue(fields.get('min_comments'));
	const minLikes = numberValue(fields.get('min_likes'));
	const minReposts = numberValue(fields.get('min_reposts'));
	const minViews = numberValue(fields.get('min_views'));
	const plateauChecks = numberValue(fields.get('plateau_checks'));
	const requirePlateau = booleanValue(fields.get('require_plateau'));
	const thresholdMode = stringValue(fields.get('threshold_mode'));
	if (
		delaySeconds === undefined ||
		evaluationWindowSeconds === undefined ||
		minComments === undefined ||
		minLikes === undefined ||
		minReposts === undefined ||
		minViews === undefined ||
		plateauChecks === undefined ||
		requirePlateau === undefined ||
		(thresholdMode !== 'all' && thresholdMode !== 'any')
	) {
		return undefined;
	}
	return {
		delay_seconds: delaySeconds,
		evaluation_window_seconds: evaluationWindowSeconds,
		min_comments: minComments,
		min_likes: minLikes,
		min_reposts: minReposts,
		min_views: minViews,
		plateau_checks: plateauChecks,
		require_plateau: requirePlateau,
		threshold_mode: thresholdMode
	};
}

function repostOverride(value: HandoffJSONValue | undefined): components['schemas']['Override'] {
	const fields = valueFields(value);
	const mode = stringValue(fields.get('mode'));
	if (mode !== 'off' && mode !== 'custom') return { mode: 'inherit' };
	const override: components['schemas']['Override'] = { mode };
	const targets = stringArray(fields.get('target_account_ids'));
	if (targets) override.target_account_ids = targets;
	const rule = repostRule(fields.get('rule'));
	if (rule) override.rule = rule;
	return override;
}

export function parseComposerHandoffPayload(
	value: HandoffJSONValue
): ComposerHandoffPayload | null {
	const fields = valueFields(value);
	const posts = parsePosts(fields.get('posts'));
	const variants = parseVariants(fields.get('variants'));
	const activePostIndex = numberValue(fields.get('active_post_index'));
	const selectedAccountIDs = stringArray(fields.get('selected_account_ids'));
	const selectedSocialSetID = stringValue(fields.get('selected_social_set_id'));
	const activeVariantValue = fields.get('active_variant_account_id');
	const activeVariantAccountID =
		activeVariantValue === null ? null : stringValue(activeVariantValue);
	const publicationID = stringValue(fields.get('publication_id'));
	const linkURL = stringValue(fields.get('link_url'));
	const selectedTimeValue = fields.get('selected_time');
	const selectedTime = selectedTimeValue === null ? null : stringValue(selectedTimeValue);
	const randomDelayOverride = stringValue(fields.get('random_delay_override'));
	const revision = numberValue(fields.get('revision'));
	if (
		!posts ||
		!variants ||
		activePostIndex === undefined ||
		!selectedAccountIDs ||
		selectedSocialSetID === undefined ||
		activeVariantAccountID === undefined ||
		publicationID === undefined ||
		linkURL === undefined ||
		selectedTime === undefined ||
		randomDelayOverride === undefined ||
		revision === undefined
	) {
		return null;
	}
	const payload: ComposerHandoffPayload = {
		posts,
		variants,
		active_post_index: activePostIndex,
		selected_account_ids: selectedAccountIDs,
		selected_social_set_id: selectedSocialSetID,
		requested_output_profiles: stringRecord(fields.get('requested_output_profiles')),
		format_locked_by_account: booleanRecord(fields.get('format_locked_by_account')),
		schedule_overrides_by_account: stringRecord(fields.get('schedule_overrides_by_account')),
		active_variant_account_id: activeVariantAccountID,
		publication_id: publicationID,
		link_url: linkURL,
		settings_by_account: nestedComposerSettings(fields.get('settings_by_account')),
		segment_settings_by_post: doubleNestedComposerSettings(fields.get('segment_settings_by_post')),
		media_settings_by_account: doubleNestedComposerSettings(
			fields.get('media_settings_by_account')
		),
		media_alt_texts: stringEntries(fields.get('media_alt_texts')),
		media_mime_types: stringEntries(fields.get('media_mime_types')),
		media_sizes: numberEntries(fields.get('media_sizes')),
		selected_time: selectedTime,
		random_delay_override: randomDelayOverride,
		repost_override: repostOverride(fields.get('repost_override')),
		revision
	};
	const selectedDate = stringValue(fields.get('selected_date'));
	if (selectedDate) payload.selected_date = selectedDate;
	return payload;
}
