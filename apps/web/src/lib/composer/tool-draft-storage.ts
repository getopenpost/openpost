import { createStore, del, get, keys, set } from 'idb-keyval';
import { z } from 'zod';
import { draftTransferSchema, type ToolDraft } from '@openpost/draft-transfer';
import { uploadMediaFile } from '$lib/media-upload-client';

const retentionMS = 24 * 60 * 60 * 1000;
const mediaReceiptSchema = z.object({
	id: z.string(),
	mime_type: z.string(),
	size: z.number(),
	alt_text: z.string()
});
const recordSchema = z.object({
	draft: draftTransferSchema,
	expires: z.number(),
	actor: z.string().optional(),
	workspace: z.string().optional(),
	uploads: z.array(mediaReceiptSchema).default([])
});
export interface PreparedToolDraft {
	parts: string[];
	link: string;
	poll: ToolDraft['poll'];
	media: z.infer<typeof mediaReceiptSchema>[];
}
let store: ReturnType<typeof createStore> | undefined;

function draftStore() {
	return (store ??= createStore('openpost-tool-drafts', 'drafts'));
}

export async function readToolDraft(token: string): Promise<ToolDraft | null> {
	if (!z.uuid().safeParse(token).success) return null;
	const record = recordSchema.safeParse(await get(token, draftStore()));
	if (!record.success || record.data.expires < Date.now()) {
		await del(token, draftStore());
		return null;
	}
	return record.data.draft;
}

export async function storeToolDraft(token: string, draft: ToolDraft): Promise<void> {
	for (const key of await keys(draftStore())) {
		const record = recordSchema.safeParse(await get(key, draftStore()));
		if (!record.success || record.data.expires < Date.now()) await del(key, draftStore());
	}
	await set(token, { draft, expires: Date.now() + retentionMS }, draftStore());
}

export async function removeToolDraft(token: string): Promise<void> {
	await del(token, draftStore());
}

export async function prepareToolDraft(
	token: string,
	actor: string,
	workspace: string,
	signal: AbortSignal
): Promise<PreparedToolDraft | null> {
	return navigator.locks.request(`openpost:tool-draft:${token}`, { signal }, () =>
		prepareLockedToolDraft(token, actor, workspace, signal)
	);
}

async function prepareLockedToolDraft(
	token: string,
	actor: string,
	workspace: string,
	signal: AbortSignal
): Promise<PreparedToolDraft | null> {
	const draft = await readToolDraft(token);
	if (!draft) return null;
	const record = recordSchema.parse(await get(token, draftStore()));
	if (
		(record.actor && record.actor !== actor) ||
		(record.workspace && record.workspace !== workspace)
	) {
		throw new Error('tool_draft_workspace_changed');
	}
	record.actor = actor;
	record.workspace = workspace;
	await set(token, record, draftStore());
	for (const attachment of draft.files.slice(record.uploads.length)) {
		signal.throwIfAborted();
		const result = await uploadMediaFile({
			workspaceId: workspace,
			file: attachment.file,
			altText: attachment.alt,
			signal
		});
		record.uploads.push({
			id: result.id,
			mime_type: result.mime_type || attachment.file.type,
			size: result.size || attachment.file.size,
			alt_text: result.alt_text || attachment.alt
		});
		await set(token, record, draftStore());
	}
	signal.throwIfAborted();
	return { parts: draft.parts, link: draft.link, poll: draft.poll, media: record.uploads };
}
