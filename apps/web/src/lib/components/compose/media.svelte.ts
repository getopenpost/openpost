import { SvelteMap, SvelteSet } from 'svelte/reactivity';
import {
	type PasteMediaUploadItem,
	ComposerSessionMediaQueue,
	firstFailedPasteMediaUpload,
	type PasteMediaUploadTarget,
	pasteMediaTargetKey,
	type PastedImageRejectionReason,
	availablePasteMediaSlots,
	selectPastedImageFiles
} from '$lib/composer/media-queue';
import { type MediaUploadResult, uploadMediaFile } from '$lib/media-upload-client';
import { optimizeStoredImage, fitStoredImage } from '$lib/media/image-preparation';
import { m } from '$lib/paraglide/messages';
import {
	generateImageAltText,
	resolveImageCaptionRetryContext,
	boundImageCaptionPostContext
} from '$lib/image-caption';
import { queryMediaMetadata } from '$lib/query/media';
import { getLocaleTag } from '$lib/i18n';
import {
	type PostItem,
	arraysEqual,
	normalizeVariantRecord,
	makeVariantRecord
} from './draft-utils';
import { captureQueryMutationSession } from '$lib/query/authorization-boundary';
import { type SocialAccount } from '$lib/api/client';
import { fittedImageSettings } from './image-settings';
import { mediaFileSignature } from '$lib/media-input';
import { uniqueIssueMessages } from './validation';
import { parseComposerSettingOptionalString } from './modes';
import type { ComposerHost } from './composer-host';

type MediaHost = Pick<
	ComposerHost,
	| 'composerDestroyed'
	| 'selectedWorkspaceId'
	| 'isSubmitting'
	| 'error'
	| 'validationIssues'
	| 'saveGeneration'
	| 'saveMutationViewIsCurrent'
	| 'selectedAccountIds'
	| 'requestedOutputProfiles'
	| 'formatLockedByAccount'
	| 'settingsByAccount'
	| 'segmentSettingsByPost'
	| 'mediaSettingsByAccount'
	| 'resolvedCapabilities'
	| 'posts'
	| 'activePostIndex'
	| 'variants'
	| 'activeVariantAccountId'
	| 'composerMediaLimit'
	| 'mediaPickerOpen'
	| 'mediaPickerPostIndex'
	| 'mediaPickerInitialFiles'
	| 'mediaPickerInitialMode'
	| 'clearPickerMeme'
	| 'settingsForAccount'
	| 'getVariantContent'
	| 'getVariantMediaIds'
	| 'getEditorContentForPost'
	| 'getEditorMediaIdsForPost'
	| 'mergeMediaIds'
	| 'setEditorMediaIds'
	| 'scheduleAutoSave'
	| 'scheduleCapabilityResolve'
	| 'startFirstComposition'
>;

/**
 * Composer attachments: media metadata, paste and drop uploads, provider image preparation, and
 * alt-text captioning. Authored media IDs stay on posts and variants owned by the composer.
 */
export class ComposerMedia {
	private readonly host: MediaHost;

	isDraggingFile = $state(false);

	mediaAltTexts = $state<Map<string, string>>(new Map());

	mediaPreviewMetadata = new SvelteMap<
		string,
		{ aspectRatio?: number; poster?: string; width?: number; height?: number }
	>();

	mediaMimeTypes = $state<Map<string, string>>(new Map());

	mediaSizes = $state<Map<string, number>>(new Map());

	pasteMediaUploads = $state.raw<PasteMediaUploadItem[]>([]);

	pasteMediaFeedback = $state.raw<{ targetKey: string; messages: string[] } | null>(null);

	pasteMediaAnnouncement = $state('');

	imagePreparationNotice = $state('');

	fittingImageId = $state('');

	readonly imagePreparationSources = new SvelteMap<string, string>();

	readonly losslessPreparedImageIds = new Set<string>();

	readonly imagePreparationRequests = new Set<AbortController>();

	private pendingImagePreparationContext = $state<string | null>(null);

	readonly pasteMediaUploadQueue = new ComposerSessionMediaQueue<MediaUploadResult>({
		upload: async ({ file, target, signal, onProgress }) => {
			const uploaded = await uploadMediaFile({
				workspaceId: target.workspaceId,
				file,
				source: 'upload',
				retentionClass: 'temporary',
				signal,
				onProgress: (progress) => onProgress(progress.fraction)
			});
			if (uploaded.mime_type !== 'image/png') return uploaded;
			try {
				const optimized = await optimizeStoredImage(uploaded.id, signal);
				return optimized ?? uploaded;
			} catch {
				signal.throwIfAborted();
				return uploaded;
			}
		},
		onComplete: (upload, result) => this.completePastedMediaUpload(upload, result),
		onChange: (items) => (this.pasteMediaUploads = items),
		errorMessage: (cause) =>
			cause instanceof Error && cause.message ? cause.message : m.compose_upload_failed(),
		maxConcurrentUploads: 3
	});

	readonly captioningMediaIds = new SvelteSet<string>();

	readonly failedCaptionMediaIds = new SvelteSet<string>();

	private readonly suppressedCaptionMediaIds = new SvelteSet<string>();

	readonly captionRequests = new SvelteMap<string, AbortController>();

	readonly pendingCaptionResults = new Map<string, ReturnType<typeof generateImageAltText>>();

	private readonly accountCaptionSuppressions = new Map<string, Set<string>>();

	readonly captionPostContexts = new SvelteMap<string, string>();

	editingAltMediaId = $state<string | null>(null);

	previewMediaOpen = $state(false);

	readonly imagePreparationContext = $derived.by(() =>
		JSON.stringify({
			accounts: this.host.selectedAccountIds,
			profiles: this.host.requestedOutputProfiles,
			locked: this.host.formatLockedByAccount,
			settings: this.host.settingsByAccount,
			segments: this.host.segmentSettingsByPost,
			media: this.host.posts.map((post) => ({
				key: post.key,
				ids: post.mediaIds,
				accounts: this.host.selectedAccountIds.map((id) => {
					const variant = this.host.variants.get(id)?.[post.key];
					return {
						id,
						inherited: variant?.mediaInherited ?? true,
						ids: variant?.mediaInherited === false ? variant.mediaIds : post.mediaIds
					};
				})
			}))
		})
	);

	pasteMediaUploadBlocker = (): string => {
		if (this.pasteMediaUploads.length === 0) return '';
		const failedUpload = firstFailedPasteMediaUpload(this.pasteMediaUploads);
		return (
			failedUpload?.error ||
			m.media_uploaded_progress({ done: 0, total: this.pasteMediaUploads.length })
		);
	};

	pasteMediaUploadIssue = (): string => {
		const failedUpload = firstFailedPasteMediaUpload(this.pasteMediaUploads);
		return failedUpload?.error || (failedUpload ? m.compose_upload_failed() : '');
	};

	hydrateMediaMetadata = async (workspaceId: string, mediaIds: string[], force = false) => {
		const requestedIds = Array.from(new Set(mediaIds.filter(Boolean)));
		const missingIds = force
			? requestedIds
			: requestedIds.filter(
					(id) =>
						!this.mediaMimeTypes.has(id) ||
						!this.mediaSizes.has(id) ||
						!this.mediaPreviewMetadata.has(id)
				);
		if (!workspaceId || missingIds.length === 0) return;

		try {
			const mediaData = (await queryMediaMetadata(workspaceId, missingIds, { force })).media;
			if (this.host.composerDestroyed || workspaceId !== this.host.selectedWorkspaceId) return;
			const nextMimeTypes = new SvelteMap(this.mediaMimeTypes);
			const nextAltTexts = new SvelteMap(this.mediaAltTexts);
			const nextSizes = new SvelteMap(this.mediaSizes);
			for (const media of mediaData) {
				if (
					media.parent_media_id &&
					['image_optimization', 'image_fit'].includes(media.source ?? '')
				)
					this.imagePreparationSources.set(media.id, media.parent_media_id);
				if (media.source === 'image_optimization') this.losslessPreparedImageIds.add(media.id);
				const ratio =
					media.mime_type?.startsWith('image/') && (media.width ?? 0) > 0 && (media.height ?? 0) > 0
						? media.width! / media.height!
						: undefined;
				this.mediaPreviewMetadata.set(media.id, {
					aspectRatio: ratio,
					width: media.width,
					height: media.height,
					poster: media.poster_thumbnail_url || undefined
				});
				if (media.mime_type) {
					nextMimeTypes.set(media.id, media.mime_type);
				}
				if (media.size !== undefined) {
					nextSizes.set(media.id, media.size);
				}
				if (!nextAltTexts.has(media.id) && media.alt_text) {
					nextAltTexts.set(media.id, media.alt_text);
				}
			}
			this.mediaMimeTypes = nextMimeTypes;
			this.mediaAltTexts = nextAltTexts;
			this.mediaSizes = nextSizes;
		} catch (cause) {
			if (!this.host.composerDestroyed && workspaceId === this.host.selectedWorkspaceId) {
				console.error('Failed to load media metadata:', cause);
			}
		}
	};

	private captionPostContextForRetry = (mediaId: string): string => {
		const post = this.host.posts.find((candidate) =>
			this.host.getEditorMediaIdsForPost(candidate).includes(mediaId)
		);
		return resolveImageCaptionRetryContext(
			this.captionPostContexts.get(mediaId),
			post ? this.host.getEditorContentForPost(post) : ''
		);
	};

	generateMissingMediaAltText = async (mediaIds: string[], postContext: string) => {
		const boundedPostContext = boundImageCaptionPostContext(postContext);
		const candidates = Array.from(new Set(mediaIds.filter(Boolean))).filter(
			(mediaId) =>
				this.mediaMimeTypes.get(mediaId)?.startsWith('image/') &&
				!this.mediaAltTexts.get(mediaId)?.trim() &&
				!this.captioningMediaIds.has(mediaId) &&
				!this.suppressedCaptionMediaIds.has(mediaId)
		);
		await Promise.all(
			candidates.map((mediaId) => {
				this.captionPostContexts.set(mediaId, boundedPostContext);
				return this.generateMediaAltText(mediaId, boundedPostContext);
			})
		);
	};

	private generateMediaAltText = async (mediaId: string, postContext: string) => {
		const controller = new AbortController();
		this.captionRequests.set(mediaId, controller);
		this.captioningMediaIds.add(mediaId);
		this.failedCaptionMediaIds.delete(mediaId);

		try {
			const pending = generateImageAltText(mediaId, {
				locale: getLocaleTag(),
				postContext,
				signal: controller.signal
			});
			this.pendingCaptionResults.set(mediaId, pending);
			const result = await pending;
			if (!result || controller.signal.aborted || this.suppressedCaptionMediaIds.has(mediaId))
				return;
			if (!this.mediaAltTexts.get(mediaId)?.trim()) {
				const nextAltTexts = new SvelteMap(this.mediaAltTexts);
				nextAltTexts.set(mediaId, result.alt_text);
				this.mediaAltTexts = nextAltTexts;
				this.host.scheduleAutoSave();
			}
		} catch (cause) {
			if (cause instanceof Error && cause.name === 'AbortError') return;
			this.failedCaptionMediaIds.add(mediaId);
		} finally {
			if (this.captionRequests.get(mediaId) === controller) {
				this.captionRequests.delete(mediaId);
				this.pendingCaptionResults.delete(mediaId);
			}
			this.captioningMediaIds.delete(mediaId);
		}
	};

	retryMediaAltText = (mediaId: string) => {
		const postContext = this.captionPostContextForRetry(mediaId);
		this.captionPostContexts.set(mediaId, postContext);
		void this.generateMediaAltText(mediaId, postContext);
	};

	// --------------------------------------------------------------------------
	// Media
	// --------------------------------------------------------------------------
	pasteMediaTargetForPost = (post: PostItem): PasteMediaUploadTarget | null => {
		if (!this.host.selectedWorkspaceId) return null;
		return {
			workspaceId: this.host.selectedWorkspaceId,
			postKey: post.key,
			variantAccountId: this.host.activeVariantAccountId
		};
	};

	pasteMediaUploadsForTarget = (target: PasteMediaUploadTarget): PasteMediaUploadItem[] => {
		return this.pasteMediaUploads.filter(
			(upload) =>
				upload.target.workspaceId === target.workspaceId &&
				upload.target.postKey === target.postKey &&
				upload.target.variantAccountId === target.variantAccountId
		);
	};

	visiblePasteMediaUploads = (post: PostItem): PasteMediaUploadItem[] => {
		const target = this.pasteMediaTargetForPost(post);
		return target ? this.pasteMediaUploadsForTarget(target) : [];
	};

	visiblePasteMediaFeedback = (post: PostItem): string[] => {
		const target = this.pasteMediaTargetForPost(post);
		if (!target || this.pasteMediaFeedback?.targetKey !== pasteMediaTargetKey(target)) return [];
		return this.pasteMediaFeedback.messages;
	};

	private pastedImageRejectionMessage = (
		reason: PastedImageRejectionReason,
		file: File
	): string => {
		switch (reason) {
			case 'empty':
				return m.media_upload_empty_file({ name: file.name });
			case 'unsupported':
				return m.media_upload_unsupported({ name: file.name });
			case 'file_too_large':
				return m.media_upload_file_too_large({ name: file.name });
			case 'video_too_large':
				return m.media_upload_video_too_large({ name: file.name });
			case 'duplicate':
				return m.media_upload_duplicates();
			case 'capacity':
				return m.media_upload_too_many({ maximum: this.host.composerMediaLimit });
		}
	};

	mediaIdsForPasteTarget = (target: PasteMediaUploadTarget): string[] => {
		const post = this.host.posts.find((candidate) => candidate.key === target.postKey);
		if (!post) return [];
		if (!target.variantAccountId) return post.mediaIds;
		return this.host.getVariantMediaIds(target.variantAccountId, post.key) ?? post.mediaIds;
	};

	private pasteMediaTargetIsCurrent = (target: PasteMediaUploadTarget): boolean => {
		if (this.host.selectedWorkspaceId !== target.workspaceId) return false;
		if (!this.host.posts.some((post) => post.key === target.postKey)) return false;
		return (
			!target.variantAccountId ||
			(this.host.selectedAccountIds.includes(target.variantAccountId) &&
				this.host.variants.has(target.variantAccountId))
		);
	};

	setPasteTargetMediaIds = (target: PasteMediaUploadTarget, mediaIds: string[]): void => {
		const postIndex = this.host.posts.findIndex((post) => post.key === target.postKey);
		if (postIndex < 0) return;
		if (mediaIds.length > 0) void this.host.startFirstComposition('media');
		if (target.variantAccountId) {
			this.setVariantMediaIds(target.variantAccountId, postIndex, mediaIds);
		} else {
			this.host.posts = this.host.posts.map((post, index) =>
				index === postIndex ? { ...post, mediaIds } : post
			);
		}
		this.host.validationIssues = [];
		this.host.scheduleAutoSave();
		this.host.scheduleCapabilityResolve();
	};

	private completePastedMediaUpload = (
		upload: PasteMediaUploadItem,
		result: MediaUploadResult
	): boolean => {
		if (!this.pasteMediaTargetIsCurrent(upload.target)) return false;
		const currentMediaIds = this.mediaIdsForPasteTarget(upload.target);
		if (!currentMediaIds.includes(result.id)) {
			const nextMediaIds = this.host.mergeMediaIds(currentMediaIds, [result.id]);
			if (!nextMediaIds.includes(result.id)) {
				throw new Error(m.media_upload_too_many({ maximum: this.host.composerMediaLimit }));
			}
			this.setPasteTargetMediaIds(upload.target, nextMediaIds);
		}

		if (result.parent_media_id && ['image_optimization', 'image_fit'].includes(result.source ?? ''))
			this.imagePreparationSources.set(result.id, result.parent_media_id);
		if (result.source === 'image_optimization') this.losslessPreparedImageIds.add(result.id);
		const nextMimeTypes = new SvelteMap(this.mediaMimeTypes);
		nextMimeTypes.set(
			result.id,
			result.mime_type || upload.file.type || 'application/octet-stream'
		);
		this.mediaMimeTypes = nextMimeTypes;
		const nextSizes = new SvelteMap(this.mediaSizes);
		nextSizes.set(result.id, result.size || upload.file.size);
		this.mediaSizes = nextSizes;
		if (result.alt_text) {
			this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(result.id, result.alt_text);
		}
		this.pasteMediaAnnouncement = `${upload.file.name}: ${m.media_upload_complete()}`;

		const post = this.host.posts.find((candidate) => candidate.key === upload.target.postKey);
		const postContext = upload.target.variantAccountId
			? (this.host.getVariantContent(upload.target.variantAccountId, upload.target.postKey) ??
				post?.content ??
				'')
			: (post?.content ?? '');
		void this.generateMissingMediaAltText([result.id], postContext);
		return true;
	};

	prepareNewImageIds = async (ids: string[], workspaceId: string): Promise<string[] | null> => {
		const generation = this.host.saveGeneration,
			session = captureQueryMutationSession();
		const controller = new AbortController();
		this.imagePreparationRequests.add(controller);
		const prepared = [...ids];
		try {
			await this.hydrateMediaMetadata(workspaceId, ids, true);
			for (const [index, id] of ids.entries()) {
				if (
					!this.host.saveMutationViewIsCurrent(session, generation, workspaceId) ||
					controller.signal.aborted
				)
					return null;
				if (this.mediaMimeTypes.get(id) !== 'image/png') continue;
				try {
					const result = await optimizeStoredImage(id, controller.signal);
					if (
						!this.host.saveMutationViewIsCurrent(session, generation, workspaceId) ||
						controller.signal.aborted
					)
						return null;
					if (result) {
						prepared[index] = result.id;
						this.imagePreparationSources.set(result.id, id);
						this.losslessPreparedImageIds.add(result.id);
						if (this.mediaAltTexts.has(id))
							this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(
								result.id,
								this.mediaAltTexts.get(id)!
							);
						this.imagePreparationNotice = m.compose_image_optimized();
					}
				} catch {
					if (controller.signal.aborted) return null;
				}
			}
			await this.hydrateMediaMetadata(workspaceId, prepared, true);
			return this.host.saveMutationViewIsCurrent(session, generation, workspaceId) &&
				!controller.signal.aborted
				? prepared
				: null;
		} finally {
			this.imagePreparationRequests.delete(controller);
		}
	};

	imageFitCandidates = (account: SocialAccount): string[] => {
		const resolved = this.host.resolvedCapabilities[account.id];
		if (!resolved) return [];
		const ids = [
			...new Set(
				this.host.posts.flatMap(
					(post) => this.host.getVariantMediaIds(account.id, post.key) ?? post.mediaIds
				)
			)
		];
		return ids.filter(
			(id) =>
				this.mediaMimeTypes.get(id)?.startsWith('image/') &&
				((resolved.issues ?? []).some(
					(issue) => issue.media_id === id && issue.code.startsWith('media_')
				) ||
					((resolved.media.max_image_size_bytes || resolved.media.max_size_bytes) &&
						(this.mediaSizes.get(id) ?? 0) >
							Math.min(
								...[resolved.media.max_image_size_bytes, resolved.media.max_size_bytes].filter(
									(n): n is number => !!n && n > 0
								)
							)))
		);
	};

	private imagePreparationInput = (mediaId: string): string => {
		const seen = new Set<string>();
		while (this.losslessPreparedImageIds.has(mediaId) && !seen.has(mediaId)) {
			seen.add(mediaId);
			const parent = this.imagePreparationSources.get(mediaId);
			if (!parent) break;
			mediaId = parent;
		}
		return mediaId;
	};

	fitAccountImage = async (account: SocialAccount, mediaId: string) => {
		if (this.fittingImageId) return;
		const resolved = this.host.resolvedCapabilities[account.id];
		if (!resolved) return;
		const workspaceId = this.host.selectedWorkspaceId,
			generation = this.host.saveGeneration;
		const session = captureQueryMutationSession();
		const sources = this.host.posts.flatMap((post) =>
			(this.host.getVariantMediaIds(account.id, post.key) ?? post.mediaIds).includes(mediaId)
				? [
						{
							key: post.key,
							ids: [...(this.host.getVariantMediaIds(account.id, post.key) ?? post.mediaIds)]
						}
					]
				: []
		);
		const alt = this.mediaAltTextForAccount(mediaId, account.id);
		const authoredContext = this.imagePreparationContext;
		this.pendingImagePreparationContext = authoredContext;
		const controller = new AbortController();
		this.imagePreparationRequests.add(controller);
		this.fittingImageId = mediaId;
		this.host.error = '';
		try {
			let optimized: MediaUploadResult | null = null;
			if (this.mediaMimeTypes.get(mediaId) === 'image/png') {
				try {
					optimized = await optimizeStoredImage(mediaId, controller.signal);
				} catch {
					controller.signal.throwIfAborted();
				}
			}
			const maxBytes = Math.min(
				...[resolved.media.max_image_size_bytes, resolved.media.max_size_bytes].filter(
					(n): n is number => !!n && n > 0
				)
			);
			// Lossless preparation can fix a size-only issue without re-encoding its pixels.
			const sizeOnly = (resolved.issues ?? [])
				.filter((issue) => issue.media_id === mediaId && issue.code.startsWith('media_'))
				.every((issue) => issue.code === 'media_size');
			const result =
				optimized && optimized.size <= maxBytes && sizeOnly
					? optimized
					: await fitStoredImage({
							mediaId: this.imagePreparationInput(mediaId),
							accountId: account.id,
							outputProfile: resolved.output_profile,
							settings: this.host.settingsForAccount(account),
							altText: alt,
							signal: controller.signal
						});
			await this.hydrateMediaMetadata(workspaceId, [result.id], true);
			if (
				!this.host.saveMutationViewIsCurrent(session, generation, workspaceId) ||
				controller.signal.aborted ||
				this.imagePreparationContext !== authoredContext ||
				!this.host.selectedAccountIds.includes(account.id) ||
				this.host.resolvedCapabilities[account.id]?.output_profile !== resolved.output_profile ||
				sources.some((source) => {
					const post = this.host.posts.find((post) => post.key === source.key);
					return (
						!post ||
						!arraysEqual(
							this.host.getVariantMediaIds(account.id, source.key) ?? post.mediaIds,
							source.ids
						)
					);
				})
			)
				return;
			// End the fence before applying our own authored mutation.
			this.pendingImagePreparationContext = null;
			this.imagePreparationSources.set(result.id, this.imagePreparationInput(mediaId));
			const preparedSize = this.mediaPreviewMetadata.get(result.id);
			this.transferPreparedImageSettings(
				mediaId,
				result.id,
				account.id,
				preparedSize?.width,
				preparedSize?.height
			);
			this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(
				result.id,
				this.mediaAltTextForAccount(mediaId, account.id)
			);
			for (const source of sources) {
				const index = this.host.posts.findIndex((post) => post.key === source.key);
				this.setVariantMediaIds(
					account.id,
					index,
					source.ids.map((id) => (id === mediaId ? result.id : id))
				);
			}
			this.followPreparedImageCaption(mediaId, result.id, account.id);
			this.host.validationIssues = [];
			this.host.scheduleAutoSave();
			this.host.scheduleCapabilityResolve();
			this.imagePreparationNotice =
				this.host.activeVariantAccountId === account.id ? m.compose_image_fit_success() : '';
		} catch (cause) {
			if (
				this.host.saveMutationViewIsCurrent(session, generation, workspaceId) &&
				!controller.signal.aborted
			)
				this.host.error = cause instanceof Error ? cause.message : m.compose_image_fit_failed();
		} finally {
			this.imagePreparationRequests.delete(controller);
			this.fittingImageId = '';
			this.pendingImagePreparationContext = null;
			if (this.host.saveMutationViewIsCurrent(session, generation, workspaceId))
				this.host.scheduleAutoSave();
		}
	};

	// Reuse the in-flight caption request across preparation, retaining explicit edits.
	private followPreparedImageCaption = (from: string, to: string, accountId: string | null) => {
		const pending = this.pendingCaptionResults.get(from);
		if (
			!pending ||
			this.suppressedCaptionMediaIds.has(from) ||
			(accountId && this.accountCaptionSuppressions.get(from)?.has(accountId))
		)
			return;
		const workspaceId = this.host.selectedWorkspaceId,
			generation = this.host.saveGeneration,
			session = captureQueryMutationSession();
		if (!this.pendingCaptionResults.has(to)) this.pendingCaptionResults.set(to, pending);
		this.captioningMediaIds.add(to);
		const clear = () => {
			if (this.pendingCaptionResults.get(to) === pending) {
				this.pendingCaptionResults.delete(to);
				this.captioningMediaIds.delete(to);
			}
		};
		void pending.then((result) => {
			clear();
			if (
				!result ||
				!this.host.saveMutationViewIsCurrent(session, generation, workspaceId) ||
				this.suppressedCaptionMediaIds.has(to) ||
				(accountId && this.accountCaptionSuppressions.get(to)?.has(accountId))
			)
				return;
			const attached = accountId
				? this.host.selectedAccountIds.includes(accountId) &&
					this.host.posts.some((post) =>
						(this.host.getVariantMediaIds(accountId, post.key) ?? post.mediaIds).includes(to)
					)
				: this.host.posts.some((post) => post.mediaIds.includes(to));
			if (!attached) return;
			if (accountId) {
				if (this.mediaAltTextForAccount(to, accountId).trim()) return;
				this.host.mediaSettingsByAccount = {
					...this.host.mediaSettingsByAccount,
					[to]: {
						...this.host.mediaSettingsByAccount[to],
						[accountId]: {
							...this.host.mediaSettingsByAccount[to]?.[accountId],
							alt_text: result.alt_text
						}
					}
				};
			} else {
				if (this.mediaAltTexts.get(to)?.trim()) return;
				this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(to, result.alt_text);
			}
			this.host.scheduleAutoSave();
		}, clear);
	};

	private transferPreparedImageSettings = (
		from: string,
		to: string,
		accountId: string,
		width?: number,
		height?: number,
		restore = false
	) => {
		const sourceSize = this.mediaPreviewMetadata.get(restore ? to : from) ?? {};
		const fittedSize = restore ? (this.mediaPreviewMetadata.get(from) ?? {}) : { width, height };
		this.host.mediaSettingsByAccount = {
			...this.host.mediaSettingsByAccount,
			[to]: {
				...this.host.mediaSettingsByAccount[to],
				[accountId]: {
					...fittedImageSettings(
						this.host.mediaSettingsByAccount[from]?.[accountId] ?? {},
						sourceSize,
						fittedSize,
						restore
					),
					alt_text: this.mediaAltTextForAccount(from, accountId)
				}
			}
		};
	};

	readonly restorableImages = $derived.by(() => {
		const ids = [
			...new Set(this.host.posts.flatMap((post) => this.host.getEditorMediaIdsForPost(post)))
		];
		return ids
			.filter((id) => this.imagePreparationSources.has(id))
			.map((id) => ({ id, number: ids.indexOf(id) + 1 }));
	});

	restoreOriginalImage = async (mediaId: string) => {
		const original = this.imagePreparationSources.get(mediaId);
		if (!original || this.fittingImageId) return;
		const accountId = this.host.activeVariantAccountId;
		// A prepared media id without a per-account variant override belongs to the shared
		// segments; restoring it replaces that attachment for every account, like the
		// shared view does, while preserving per-account settings and captions.
		const overrideAccount = (() => {
			if (!accountId) return null;
			const overridden = this.host.posts.some((post) => {
				const variantIds = this.host.getVariantMediaIds(accountId, post.key);
				// Settings-only media decisions keep the shared id list; restoring those
				// attachments still replaces the shared segments for every account.
				return (
					variantIds !== null &&
					(variantIds.length !== post.mediaIds.length ||
						variantIds.some((id, index) => id !== post.mediaIds[index])) &&
					variantIds.includes(mediaId)
				);
			});
			return overridden ? accountId : null;
		})();
		const context = this.imagePreparationContext,
			workspaceId = this.host.selectedWorkspaceId,
			generation = this.host.saveGeneration;
		const session = captureQueryMutationSession();
		await this.hydrateMediaMetadata(workspaceId, [original]);
		if (
			!this.host.saveMutationViewIsCurrent(session, generation, workspaceId) ||
			(overrideAccount && overrideAccount !== this.host.activeVariantAccountId) ||
			context !== this.imagePreparationContext
		)
			return;
		const alt = overrideAccount
			? this.mediaAltTextForAccount(mediaId, overrideAccount)
			: (this.mediaAltTexts.get(mediaId) ?? '');
		if (overrideAccount) {
			this.transferPreparedImageSettings(
				mediaId,
				original,
				overrideAccount,
				undefined,
				undefined,
				true
			);
		} else {
			for (const id of this.host.selectedAccountIds) {
				if (
					!this.host.posts.some(
						(post) =>
							post.mediaIds.includes(mediaId) && this.host.getVariantMediaIds(id, post.key) === null
					)
				)
					continue;
				this.transferPreparedImageSettings(mediaId, original, id, undefined, undefined, true);
				this.followPreparedImageCaption(mediaId, original, id);
			}
			this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(original, alt);
		}
		this.followPreparedImageCaption(mediaId, original, overrideAccount);
		let swappedSharedMedia = false;
		for (let index = 0; index < this.host.posts.length; index++) {
			if (overrideAccount) {
				const ids = this.host.getEditorMediaIdsForPost(this.host.posts[index]);
				if (ids.includes(mediaId))
					this.host.setEditorMediaIds(
						index,
						ids.map((id) => (id === mediaId ? original : id))
					);
			} else if (this.host.posts[index].mediaIds.includes(mediaId)) {
				// Shared restores keep detached per-account media decisions intact; write
				// through the post owner instead of the active destination variant.
				this.host.posts = this.host.posts.map((item, postIndex) =>
					postIndex === index
						? {
								...item,
								mediaIds: item.mediaIds.map((id) => (id === mediaId ? original : id))
							}
						: item
				);
				swappedSharedMedia = true;
			}
		}
		if (swappedSharedMedia) this.host.scheduleAutoSave();
		this.imagePreparationNotice = '';
	};

	private queueMediaFiles = (
		files: FileList | File[],
		targetPostIndex = this.host.activePostIndex
	): void => {
		if (!this.host.selectedWorkspaceId || this.host.isSubmitting) return;
		const targetPost = this.host.posts[targetPostIndex];
		if (
			!targetPost ||
			this.host.getEditorMediaIdsForPost(targetPost).length >= this.host.composerMediaLimit
		)
			return;
		const pasteTarget = this.pasteMediaTargetForPost(targetPost);
		if (pasteTarget && this.pasteMediaUploadsForTarget(pasteTarget).length > 0) return;
		this.host.mediaPickerPostIndex = targetPostIndex;
		this.host.mediaPickerInitialMode = 'upload';
		this.host.clearPickerMeme();
		this.host.mediaPickerInitialFiles = Array.from(files).slice(
			0,
			Math.max(
				0,
				this.host.composerMediaLimit - this.host.getEditorMediaIdsForPost(targetPost).length
			)
		);
		this.host.mediaPickerOpen = true;
	};

	handlePaste = (e: ClipboardEvent, postIndex: number = this.host.activePostIndex) => {
		const items = e.clipboardData?.items;
		const post = this.host.posts[postIndex];
		if (!items || !post || !this.host.selectedWorkspaceId || this.host.isSubmitting) {
			return;
		}

		const target = this.pasteMediaTargetForPost(post);
		if (!target) return;
		const targetUploads = this.pasteMediaUploadsForTarget(target);
		const capacity = availablePasteMediaSlots(
			this.mediaIdsForPasteTarget(target).length,
			targetUploads.length,
			this.host.composerMediaLimit
		);
		const selection = selectPastedImageFiles(
			Array.from(items),
			capacity,
			targetUploads.map((upload) => mediaFileSignature(upload.file))
		);
		if (selection.hasImageFiles && selection.rejected.length > 0) {
			this.pasteMediaFeedback = {
				targetKey: pasteMediaTargetKey(target),
				messages: uniqueIssueMessages(
					selection.rejected.map(({ file, reason }) =>
						this.pastedImageRejectionMessage(reason, file)
					)
				)
			};
		} else if (
			selection.hasImageFiles &&
			this.pasteMediaFeedback?.targetKey === pasteMediaTargetKey(target)
		) {
			this.pasteMediaFeedback = null;
		}
		if (selection.accepted.length === 0) return;

		e.preventDefault();
		this.host.error = '';
		this.pasteMediaAnnouncement = '';
		if (target.variantAccountId) {
			this.setVariantMediaIds(target.variantAccountId, postIndex, [
				...this.mediaIdsForPasteTarget(target)
			]);
		}
		this.pasteMediaUploadQueue.enqueue(selection.accepted, target);
	};

	handleDragOver = (e: DragEvent) => {
		e.preventDefault();
		this.isDraggingFile = true;
	};

	handleDragLeave = (e: DragEvent) => {
		e.preventDefault();
		this.isDraggingFile = false;
	};

	handleDrop = (e: DragEvent, postIndex: number = this.host.activePostIndex) => {
		e.preventDefault();
		this.isDraggingFile = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			this.queueMediaFiles(files, postIndex);
		}
	};

	removeMedia = (postIndex: number, mediaIndex: number) => {
		const post = this.host.posts[postIndex];
		if (!post) return;
		const mediaIds = this.host.getEditorMediaIdsForPost(post);
		const mediaId = mediaIds[mediaIndex];
		if (this.host.activeVariantAccountId) {
			this.setVariantMediaIds(
				this.host.activeVariantAccountId,
				postIndex,
				mediaIds.filter((_, mi) => mi !== mediaIndex)
			);
		} else {
			this.host.posts = this.host.posts.map((p, i) =>
				i === postIndex ? { ...p, mediaIds: p.mediaIds.filter((_, mi) => mi !== mediaIndex) } : p
			);
		}
		const stillAttached =
			mediaId &&
			this.host.posts.some(
				(source) =>
					source.mediaIds.includes(mediaId) ||
					[...this.host.variants.values()].some((record) =>
						record[source.key]?.mediaIds.includes(mediaId)
					)
			);
		if (mediaId && !stillAttached) {
			this.captionRequests.get(mediaId)?.abort();
			this.captionRequests.delete(mediaId);
			this.captioningMediaIds.delete(mediaId);
			this.failedCaptionMediaIds.delete(mediaId);
			this.suppressedCaptionMediaIds.delete(mediaId);
			this.captionPostContexts.delete(mediaId);
			const newAlts = new SvelteMap(this.mediaAltTexts);
			newAlts.delete(mediaId);
			this.mediaAltTexts = newAlts;
			const newMimeTypes = new SvelteMap(this.mediaMimeTypes);
			newMimeTypes.delete(mediaId);
			this.mediaMimeTypes = newMimeTypes;
			const newSizes = new SvelteMap(this.mediaSizes);
			newSizes.delete(mediaId);
			this.mediaSizes = newSizes;
		}
		this.host.validationIssues = [];
		this.host.scheduleAutoSave();
		this.host.scheduleCapabilityResolve();
	};

	private addMediaToPost = (postIndex: number, mediaId: string) => {
		const post = this.host.posts[postIndex];
		if (!post) return;
		if (this.host.activeVariantAccountId) {
			this.setVariantMediaIds(this.host.activeVariantAccountId, postIndex, [
				...this.host.getEditorMediaIdsForPost(post),
				mediaId
			]);
			return;
		}
		this.host.posts = this.host.posts.map((p, i) =>
			i === postIndex ? { ...p, mediaIds: [...p.mediaIds, mediaId] } : p
		);
	};

	snapshotAccountMediaAltTexts = (accountId: string, mediaIds: string[]) => {
		const next = { ...this.host.mediaSettingsByAccount };
		for (const id of mediaIds) {
			if (
				!this.mediaAltTexts.has(id) &&
				parseComposerSettingOptionalString(next[id]?.[accountId]?.alt_text) === undefined
			)
				continue;
			next[id] = {
				...next[id],
				[accountId]: {
					...next[id]?.[accountId],
					alt_text: this.mediaAltTextForAccount(id, accountId)
				}
			};
		}
		this.host.mediaSettingsByAccount = next;
	};

	resetAccountMediaAltTexts = (accountId: string) => {
		for (const suppressed of this.accountCaptionSuppressions.values()) suppressed.delete(accountId);
		const next = { ...this.host.mediaSettingsByAccount };
		for (const [id, accounts] of Object.entries(next)) {
			if (!accounts[accountId]) continue;
			const settings = { ...accounts[accountId] };
			delete settings.alt_text;
			next[id] = { ...accounts, [accountId]: settings };
		}
		this.host.mediaSettingsByAccount = next;
	};

	setVariantMediaIds = (accountId: string, index: number, mediaIds: string[]) => {
		const postKey = this.host.posts[index]?.key;
		if (!postKey) return;
		const previousIds =
			this.host.getVariantMediaIds(accountId, postKey) ?? this.host.posts[index].mediaIds;
		this.snapshotAccountMediaAltTexts(
			accountId,
			mediaIds.filter((id) => previousIds.includes(id))
		);
		const newVariants = new SvelteMap(this.host.variants);
		const record = normalizeVariantRecord(
			newVariants.get(accountId) ?? makeVariantRecord(this.host.posts),
			this.host.posts
		);
		const current = {
			...record,
			[postKey]: { ...record[postKey], mediaIds, mediaInherited: false }
		};
		newVariants.set(accountId, current);
		this.host.variants = newVariants;
	};

	mediaAltTextForAccount = (mediaId: string, accountId: string): string => {
		const override = this.host.mediaSettingsByAccount[mediaId]?.[accountId]?.alt_text;
		return parseComposerSettingOptionalString(override) ?? this.mediaAltTexts.get(mediaId) ?? '';
	};

	setMediaAltText = (mediaId: string, alt: string) => {
		if (this.host.activeVariantAccountId) {
			const suppressed = this.accountCaptionSuppressions.get(mediaId) ?? new Set<string>();
			suppressed.add(this.host.activeVariantAccountId);
			this.accountCaptionSuppressions.set(mediaId, suppressed);
		} else {
			this.captionRequests.get(mediaId)?.abort();
			this.suppressedCaptionMediaIds.add(mediaId);
		}
		this.failedCaptionMediaIds.delete(mediaId);
		if (this.host.activeVariantAccountId) {
			for (let index = 0; index < this.host.posts.length; index++) {
				const ids =
					this.host.getVariantMediaIds(
						this.host.activeVariantAccountId,
						this.host.posts[index].key
					) ?? this.host.posts[index].mediaIds;
				if (ids.includes(mediaId))
					this.setVariantMediaIds(this.host.activeVariantAccountId, index, [...ids]);
			}
			this.host.mediaSettingsByAccount = {
				...this.host.mediaSettingsByAccount,
				[mediaId]: {
					...this.host.mediaSettingsByAccount[mediaId],
					[this.host.activeVariantAccountId]: {
						...this.host.mediaSettingsByAccount[mediaId]?.[this.host.activeVariantAccountId],
						alt_text: alt.trim()
					}
				}
			};
			this.host.scheduleAutoSave();
			return;
		}
		this.mediaAltTexts = new SvelteMap(this.mediaAltTexts).set(mediaId, alt.trim());
		this.host.scheduleAutoSave();
	};

	/** Forgets type, size, preview, and alt-text metadata when the composer clears its media. */
	clearMetadata = () => {
		this.mediaAltTexts = new Map();
		this.mediaMimeTypes = new Map();
		this.mediaPreviewMetadata.clear();
		this.mediaSizes = new Map();
	};

	/** Cancels image preparation that belongs to an earlier Workspace, request, or view. */
	invalidateImagePreparation = () => {
		this.imagePreparationSources.clear();
		this.losslessPreparedImageIds.clear();
		this.imagePreparationNotice = '';
		for (const controller of this.imagePreparationRequests) controller.abort();
	};

	/** Releases preparation and caption requests when the composer unmounts. */
	dispose = () => {
		for (const controller of this.imagePreparationRequests) controller.abort();
		for (const controller of this.captionRequests.values()) controller.abort();
		this.captionRequests.clear();
		this.pendingCaptionResults.clear();
		this.captionPostContexts.clear();
	};

	constructor(host: MediaHost) {
		this.host = host;
		$effect(() => {
			if (
				this.pendingImagePreparationContext !== null &&
				this.imagePreparationContext !== this.pendingImagePreparationContext
			) {
				for (const controller of this.imagePreparationRequests) controller.abort();
			}
		});
	}
}
