export interface PostItem {
	id?: string;
	key: string;
	content: string;
	mediaIds: string[];
}

export interface VariantPost {
	content: string;
	mediaIds: string[];
	contentInherited?: boolean;
	mediaInherited?: boolean;
}

export type ThreadVariantMap = Record<string, Record<string, VariantPost>>;

export interface DecodedThreadDraft {
	posts: { key: string; content: string; mediaIds: string[] }[];
	variants: ThreadVariantMap;
}

export interface DraftLike {
	content: string;
	thread_draft?: string;
	media_ids?: string[] | null;
}

export interface DraftPresentation {
	title: string;
	postCount: number;
	isThread: boolean;
	hasMedia: boolean;
}

export const THREAD_DRAFT_PREFIX = '__openpost_thread__:';

type ThreadDraftJSONValue =
	| string
	| number
	| boolean
	| null
	| ThreadDraftJSONValue[]
	| { [key: string]: ThreadDraftJSONValue };

export function generatePostKey(): string {
	return Math.random().toString(36).substring(2, 10);
}

export function makeEmptyPost(): PostItem {
	return { key: generatePostKey(), content: '', mediaIds: [] };
}

export function encodeThreadDraft(posts: PostItem[], variants: ThreadVariantMap = {}): string {
	const data = {
		p: posts.map((p) => ({ k: p.key, c: p.content, m: p.mediaIds })),
		v: variants
	};
	return THREAD_DRAFT_PREFIX + JSON.stringify(data);
}

export function isThreadDraft(content: string): boolean {
	return content.startsWith(THREAD_DRAFT_PREFIX);
}

export function decodeThreadDraft(content: string): DecodedThreadDraft | null {
	try {
		const data: unknown = JSON.parse(content.slice(THREAD_DRAFT_PREFIX.length));
		if (Array.isArray(data)) {
			return {
				posts: data.map(parseThreadPost),
				variants: {}
			};
		}
		if (!isThreadDraftRecord(data) || !Array.isArray(data.p)) return null;
		return {
			posts: data.p.map(parseThreadPost),
			variants: isThreadDraftRecord(data.v)
				? Object.fromEntries(
						Object.entries(data.v).map(([accountId, value]) => [
							accountId,
							parseVariantValue(value)
						])
					)
				: {}
		};
	} catch {
		return null;
	}
}

export function getDraftPresentation(draft: DraftLike): DraftPresentation {
	const serializedThread =
		draft.thread_draft || (isThreadDraft(draft.content) ? draft.content : '');
	const decodedThread = serializedThread ? decodeThreadDraft(serializedThread) : null;
	const firstThreadPost = decodedThread?.posts[0]?.content.trim() ?? '';
	const fallbackContent = isThreadDraft(draft.content) ? '' : draft.content.trim();
	const postCount = decodedThread?.posts.length ?? 1;
	const isThread = Boolean(serializedThread);

	return {
		title: firstThreadPost || fallbackContent || (isThread ? 'Untitled thread' : 'Untitled post'),
		postCount,
		isThread,
		hasMedia:
			Boolean(draft.media_ids?.length) ||
			Boolean(decodedThread?.posts.some((post) => post.mediaIds.length > 0))
	};
}

function parseThreadPost(value: ThreadDraftJSONValue): DecodedThreadDraft['posts'][number] {
	if (!isThreadDraftRecord(value)) {
		return { key: generatePostKey(), content: '', mediaIds: [] };
	}
	return {
		key: typeof value.k === 'string' && value.k ? value.k : generatePostKey(),
		content: value.c === undefined || value.c === null ? '' : String(value.c),
		mediaIds: Array.isArray(value.m) ? value.m.map(String) : []
	};
}

function parseVariantValue(value: ThreadDraftJSONValue): Record<string, VariantPost> {
	if (Array.isArray(value)) {
		return Object.fromEntries(value.map((item, index) => [String(index), parseVariantPost(item)]));
	}
	if (!isThreadDraftRecord(value)) return {};
	return Object.fromEntries(
		Object.entries(value).map(([postKey, variant]) => [postKey, parseVariantPost(variant)])
	);
}

function parseVariantPost(value: ThreadDraftJSONValue): VariantPost {
	if (isThreadDraftRecord(value)) {
		const variant: VariantPost = {
			content: String(value.content ?? value.c ?? ''),
			mediaIds: Array.isArray(value.mediaIds)
				? value.mediaIds.map(String)
				: Array.isArray(value.m)
					? value.m.map(String)
					: []
		};
		if (value.contentInherited) variant.contentInherited = true;
		if (value.mediaInherited) variant.mediaInherited = true;
		return variant;
	}
	return {
		content: String(value ?? ''),
		mediaIds: []
	};
}

function isThreadDraftRecord(value: unknown): value is { [key: string]: ThreadDraftJSONValue } {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export function getDraftSnapshot(posts: PostItem[]): string {
	return JSON.stringify(posts.map((p) => ({ content: p.content, mediaIds: p.mediaIds })));
}

export function hasAnyContent(posts: PostItem[]): boolean {
	return posts.some((p) => p.content.trim().length > 0 || p.mediaIds.length > 0);
}
