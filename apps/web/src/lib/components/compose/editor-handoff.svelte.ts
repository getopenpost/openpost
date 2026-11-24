import { replaceState, goto } from '$app/navigation';
import { resolveAppPath } from '$lib/app-path';
import { m } from '$lib/paraglide/messages';
import { clearEditorHandoff, storeEditorHandoff, loadEditorHandoff } from '$lib/editor-handoff';
import { type SettingDefinition } from './composer-host';
import { type ComposerCoverTarget } from '$lib/composer/handoff-payload';
import {
	captureQueryMutationSession,
	queryMutationSessionIsCurrent
} from '$lib/query/authorization-boundary';
import { uploadMediaFile } from '$lib/media-upload-client';
import {
	createImageEditorDesign,
	createImageEditorReturnToken,
	consumeImageEditorReturnToken
} from '$lib/image-editor/api';
import { ComposerSessionError } from '$lib/composer/session';
import { composerErrorMessage } from '$lib/composer/error-presentation';
import { type MediaPickerVideoSelection } from '$lib/media-picker';
import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
import type { ComposerHost } from './composer-host';
import type { ComposerMedia } from './media.svelte';

type EditorHandoffHost = Pick<
	ComposerHost,
	| 'composerDestroyed'
	| 'pageURL'
	| 'selectedWorkspaceId'
	| 'publicationId'
	| 'error'
	| 'saveGeneration'
	| 'saveMutationViewIsCurrent'
	| 'sessionFor'
	| 'canonicalPublicationForHandoff'
	| 'composerHandoffPayload'
	| 'restoreComposerHandoff'
	| 'saveDraft'
	| 'resolveCapabilities'
	| 'scheduleAutoSave'
	| 'selectedAccounts'
	| 'settingsAccount'
	| 'settingsAccountId'
	| 'settingsDialogOpen'
	| 'visibleSettings'
	| 'updateAccountSetting'
	| 'posts'
	| 'activePost'
	| 'activePostIndex'
	| 'isThread'
	| 'composerMediaLimit'
	| 'mediaPickerOpen'
	| 'mediaPickerPostIndex'
	| 'getVariantMediaIds'
	| 'getEditorContentForPost'
	| 'getEditorMediaIdsForPost'
	| 'mergeMediaIds'
>;

/**
 * Round trips between the composer and the Image or Video Editor: saving before leaving, carrying
 * a recovery snapshot and return token, attaching returned media or covers, and clearing the URL.
 */
export class ComposerEditorHandoff {
	private readonly host: EditorHandoffHost;
	private readonly media: ComposerMedia;
	private appliedInitialMediaKey = $state('');

	private finishVideoEditorMediaHandoff = () => {
		const clean = new URL(this.host.pageURL);
		clean.searchParams.delete('media_id');
		clean.searchParams.delete('workspace_id');
		replaceState(resolveAppPath(`${clean.pathname}${clean.search}${clean.hash}`), {});
	};

	applyInitialMediaHandoff = async (mediaIds: string[]) => {
		const incoming = this.host.mergeMediaIds([], mediaIds);
		if (!this.host.selectedWorkspaceId || incoming.length === 0) return;
		const handoffKey = `${this.host.selectedWorkspaceId}|${incoming.join(',')}`;
		if (handoffKey === this.appliedInitialMediaKey) return;
		this.appliedInitialMediaKey = handoffKey;

		const targetIndex = Math.max(
			0,
			Math.min(this.host.activePostIndex, this.host.posts.length - 1)
		);
		const targetPost = this.host.posts[targetIndex];
		if (!targetPost) return;
		const current = this.host.getEditorMediaIdsForPost(targetPost);
		const next = this.host.mergeMediaIds(current, incoming);
		const added = next.filter((id) => !current.includes(id));
		if (incoming.some((id) => !next.includes(id))) {
			this.host.error = m.media_upload_too_many({ maximum: this.host.composerMediaLimit });
		}
		if (added.length > 0) {
			const context = this.media.imagePreparationContext,
				target = this.media.pasteMediaTargetForPost(targetPost);
			const postContext = this.host.getEditorContentForPost(targetPost);
			if (!target) return;
			const prepared = await this.media.prepareNewImageIds(added, this.host.selectedWorkspaceId);
			if (!prepared || context !== this.media.imagePreparationContext) return;
			this.media.setPasteTargetMediaIds(target, [...current, ...prepared]);
			void this.media.generateMissingMediaAltText(prepared, postContext);
		}
		this.finishVideoEditorMediaHandoff();
	};

	private composerHandoffReturnURL = (): URL => {
		const returnURL = new URL(
			this.host.publicationId
				? resolveAppPath(`/publications/${encodeURIComponent(this.host.publicationId)}`)
				: this.host.pageURL,
			this.host.pageURL
		);
		for (const key of ['image_editor_return', 'editor_handoff_cancelled']) {
			returnURL.searchParams.delete(key);
		}
		return returnURL;
	};

	private finishEditorHandoff = (token: string): void => {
		clearEditorHandoff(token);
		const clean = new URL(this.host.pageURL);
		clean.searchParams.delete('image_editor_return');
		clean.searchParams.delete('editor_handoff_cancelled');
		replaceState(resolveAppPath(`${clean.pathname}${clean.search}${clean.hash}`), {});
	};

	private requireSavedComposerBeforeHandoff = async (): Promise<void> => {
		const saved = await this.host.saveDraft({ allowEmpty: true });
		if (!saved) throw new Error(this.host.error || m.compose_save_draft_failed());
	};

	openImageEditorFromComposer = async () => {
		return this.openStillEditorFromComposer('image');
	};

	openTemplateEditorFromComposer = async () => {
		return this.openStillEditorFromComposer('template');
	};

	editDestinationCover = async (
		setting: SettingDefinition,
		file: File,
		metadata: { sourceMediaId: string; timestampMs: number }
	) => {
		const account = this.host.settingsAccount;
		const post = this.host.activePost;
		if (!account || !post) return;
		if (setting.key !== 'thumbnail_media_id' && setting.key !== 'cover_media_id') return;
		this.host.mediaPickerPostIndex = this.host.activePostIndex;
		await this.openStillEditorFromComposer('image', {
			file,
			target: {
				account_id: account.id,
				post_key: post.key,
				setting_key: setting.key,
				source_media_id: metadata.sourceMediaId
			}
		});
	};

	private openStillEditorFromComposer = async (
		editor: 'image' | 'template',
		cover?: { file: File; target: ComposerCoverTarget }
	) => {
		if (!this.host.selectedWorkspaceId) return;
		const workspaceId = this.host.selectedWorkspaceId;
		const generation = this.host.saveGeneration;
		const mutationSession = captureQueryMutationSession();
		this.host.mediaPickerOpen = false;
		await this.requireSavedComposerBeforeHandoff();
		if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
		const returnURL = this.composerHandoffReturnURL();
		let designID = '';
		if (cover) {
			const source = this.host.posts.find((post) => post.key === cover.target.post_key);
			if (
				!source ||
				!(
					this.host.getVariantMediaIds(cover.target.account_id, source.key) ?? source.mediaIds
				).includes(cover.target.source_media_id)
			) {
				throw new Error(m.compose_cover_target_changed());
			}
			const uploaded = await uploadMediaFile({
				workspaceId,
				file: cover.file,
				parentMediaId: cover.target.source_media_id
			});
			if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
			const bitmap = await createImageBitmap(cover.file);
			const size = { width_px: bitmap.width, height_px: bitmap.height };
			bitmap.close();
			const design = await createImageEditorDesign(workspaceId, {
				title: m.compose_cover_design_title(),
				preset_key: 'custom',
				...size,
				source_media_id: uploaded.id
			});
			if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
			designID = design.id;
		}
		const purpose = cover
			? 'destination_cover'
			: this.host.isThread
				? 'thread_segment'
				: 'post_media';
		const token = await createImageEditorReturnToken({
			workspace_id: workspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose,
			max_selection: cover ? 1 : this.host.composerMediaLimit,
			constraints: {
				max_count: cover ? 1 : this.host.composerMediaLimit,
				allowed_mimes: cover
					? ['image/png', 'image/jpeg']
					: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
				thread_segment: this.host.mediaPickerPostIndex
			}
		});
		if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
		const binding = (
			await this.host.sessionFor(workspaceId, this.host.publicationId)
		).bindEditorHandoff(token.token);
		if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
		storeEditorHandoff(token.token, {
			version: 2,
			editor: 'image',
			workspace_id: binding.workspaceId,
			publication_id: binding.publicationId,
			publication_revision: binding.revision,
			return_token: binding.returnToken,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose,
			created_at: new Date().toISOString(),
			expires_at: token.expires_at,
			payload: {
				...this.host.composerHandoffPayload(),
				...(cover && { cover_target: cover.target })
			}
		});
		await goto(
			resolveAppPath(
				`${designID ? `/image-editor/${encodeURIComponent(designID)}` : editor === 'template' ? '/templates' : '/image-editor/new'}?workspace=${encodeURIComponent(workspaceId)}&return_token=${encodeURIComponent(token.token)}`
			)
		);
	};

	restoreImageEditorReturn = async () => {
		if (!this.host.pageURL) return;
		const token = this.host.pageURL.searchParams.get('image_editor_return');
		if (!token) return;
		const generation = this.host.saveGeneration;
		const mutationSession = captureQueryMutationSession();
		try {
			const snapshot = loadEditorHandoff(token, 'image');
			if (!snapshot) throw new ComposerSessionError('image_editor_return_inactive');
			if (snapshot.purpose === 'destination_cover') {
				const current = await this.host.canonicalPublicationForHandoff();
				if (
					!this.host.saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id)
				)
					return;
				if (
					!current ||
					current.id !== snapshot.publication_id ||
					current.revision !== snapshot.publication_revision
				) {
					throw new Error(m.compose_cover_target_changed());
				}
			}
			const payload = await this.host.restoreComposerHandoff(snapshot, token);
			if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id))
				return;
			if (this.host.pageURL.searchParams.get('editor_handoff_cancelled') === '1') {
				this.finishEditorHandoff(token);
				if (payload.cover_target) {
					this.host.settingsAccountId = payload.cover_target.account_id;
					this.host.settingsDialogOpen = true;
				}
				return;
			}
			const result = await consumeImageEditorReturnToken(token);
			if (!this.host.saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id))
				return;
			if (snapshot.workspace_id !== result.workspace_id) {
				throw new ComposerSessionError('image_editor_return_workspace_mismatch');
			}
			if (snapshot.purpose === 'destination_cover' && !payload.cover_target)
				throw new Error(m.compose_cover_target_changed());
			if (payload.cover_target) {
				const target = payload.cover_target;
				const account = this.host.selectedAccounts.find(
					(account) => account.id === target.account_id
				);
				const source = this.host.posts.find((post) => post.key === target.post_key);
				const definition =
					account &&
					this.host.visibleSettings(account).find((field) => field.key === target.setting_key);
				if (
					snapshot.purpose !== 'destination_cover' ||
					result.purpose !== snapshot.purpose ||
					result.media_ids.length !== 1 ||
					!account ||
					!source ||
					!definition ||
					definition.control !== 'media_picker' ||
					definition.unavailable_reason ||
					!(this.host.getVariantMediaIds(account.id, source.key) ?? source.mediaIds).includes(
						target.source_media_id
					)
				) {
					throw new Error(m.compose_cover_target_changed());
				}
				this.host.activePostIndex = this.host.posts.indexOf(source);
				this.host.updateAccountSetting(account, target.setting_key, result.media_ids[0]);
				this.finishEditorHandoff(token);
				this.host.settingsAccountId = account.id;
				this.host.settingsDialogOpen = true;
				return;
			}
			const targetIndex = Math.max(
				0,
				Math.min(
					Number(result.constraints.thread_segment ?? this.host.activePostIndex),
					Math.max(0, this.host.posts.length - 1)
				)
			);
			const context = this.media.imagePreparationContext,
				target = this.media.pasteMediaTargetForPost(this.host.posts[targetIndex]);
			const postContext = this.host.getEditorContentForPost(this.host.posts[targetIndex]);
			if (!target) return;
			const current = [...this.media.mediaIdsForPasteTarget(target)];
			const prepared = await this.media.prepareNewImageIds(result.media_ids, result.workspace_id);
			if (!prepared || context !== this.media.imagePreparationContext) return;
			this.media.setPasteTargetMediaIds(target, [...current, ...prepared]);
			void this.media.generateMissingMediaAltText(prepared, postContext);
			this.host.scheduleAutoSave();
			this.finishEditorHandoff(token);
			this.notifyImageEditorReturn(result.media_ids.length);
		} catch (cause) {
			if (
				this.host.composerDestroyed ||
				generation !== this.host.saveGeneration ||
				!queryMutationSessionIsCurrent(mutationSession)
			) {
				return;
			}
			this.finishEditorHandoff(token);
			this.host.error =
				cause instanceof Error
					? m.compose_image_editor_return_error({ detail: composerErrorMessage(cause) })
					: m.compose_image_editor_return_recovery();
		}
	};

	openVideoEditorFromComposer = async (selectedVideo?: MediaPickerVideoSelection) => {
		if (!this.host.selectedWorkspaceId) return;
		this.host.mediaPickerOpen = false;
		await this.requireSavedComposerBeforeHandoff();
		await this.host.resolveCapabilities();
		const publication = await this.host.canonicalPublicationForHandoff();
		const query = new URLSearchParams({
			return: publication?.id ?? this.host.publicationId
		});
		if (selectedVideo) query.set('source', `media:${selectedVideo.id}`);
		await goto(resolveAppPath(`/video-editor/new?${query.toString()}`));
	};

	private notifyImageEditorReturn = (count: number) => {
		this.host.error = '';
		if (count > 0) soundPreferences.play('success');
	};

	constructor(host: EditorHandoffHost, media: ComposerMedia) {
		this.host = host;
		this.media = media;
	}
}
