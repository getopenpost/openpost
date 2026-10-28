<script lang="ts">
	import { joinPostText, postTextForDestination } from '@openpost/platform-text/mentions';
	import SavedMentionDialog from './compose/saved-mention-dialog.svelte';
	import { searchSavedMentions, savedMentionCandidate } from '$lib/query/saved-mentions';
	import type { SavedMention } from '@openpost/query-catalog';
	import PostEditor from '@openpost/ui/components/post-editor';
	import { lookupComposerMentions } from '$lib/query/mentions';
	import {
		readMentionMetadata,
		validTextMentions,
		remapMentionMetadata,
		type PostTextValue,
		type MentionMetadata,
		type MentionCandidate
	} from '@openpost/platform-text/mentions';
	import { firstComposerURL as accountTextURL } from './compose/composer-links';
	import {
		readLinkDraft,
		linkChoice,
		linkURL,
		resolveLinkPreview,
		type LinkDraft,
		type LinkChoice
	} from './compose/links';
	import { settingLabel } from '$lib/setting-label';
	import PreviewLinkEditor from './compose/preview-link-editor.svelte';
	import PreviewPollEditor from './compose/preview-poll-editor.svelte';
	import type {
		PreviewCard,
		PreviewMedia,
		PreviewPoll,
		PreviewSegment
	} from '@openpost/social-preview';
	import type { Snippet } from 'svelte';
	import type { PreparedToolDraft } from '$lib/composer/tool-draft-storage';
	import SharedPollEditor from './compose/shared-poll-editor.svelte';
	import {
		readSharedPoll,
		resolvePollPreview,
		clearPollSettings,
		supportsNativePoll,
		type SharedPoll
	} from './compose/polls';
	import { onDestroy, onMount, tick } from 'svelte';
	import PublicationReviewControl from '$lib/components/publication-review-control.svelte';
	import { ideate } from '$lib/post-builder/ideate.svelte';
	import { z } from 'zod';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { page } from '$app/stores';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client, type SocialAccount, type Workspace } from '$lib/api/client';
	import { loadCapabilityCatalog, loadWorkspaceAccounts } from '$lib/api/performance-cache';
	import {
		publicationDetailQueryOptions,
		publishingOptionsQueryOptions
	} from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import { queryMediaMetadata } from '$lib/query/media';
	import { queryVoiceProfiles } from '$lib/query/voice-profiles';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import { schedulingQueryAPI } from '$lib/query/scheduling';
	import type { components } from '$lib/api/types';
	import AIWorkspaceDialog from '$lib/components/post-builder/ai-workspace-dialog.svelte';
	import PostOptions from '$lib/components/post-builder/post-options.svelte';
	import { renderPostVisual, savePostVisual, releasePostVisual } from '$lib/post-builder/visuals';
	import type {
		AIAngle,
		AIGenerationPhase,
		AIOpportunity,
		AIWorkspaceDialogCopy,
		AIWorkspaceEntry,
		AIWorkspaceStep
	} from '$lib/components/post-builder/ai-workspace-types';
	import {
		cancelPublicationBuild,
		createPublicationBuild,
		discoverPublicationOpportunities,
		getPublicationBuild,
		planPublicationAngles,
		retryPublicationBuild,
		type PublicationBuild,
		type PublicationBuildAngle,
		type PublicationBuildRequest,
		type PublicationBuildResult,
		type PublicationPostOption,
		type PublicationOpportunity
	} from '$lib/post-builder/client';
	import { applyPublicationBuildResult } from '$lib/post-builder/apply';
	import { composerBuildFingerprint } from '$lib/post-builder/composer-state';
	import AIMemeRecommendation from '$lib/components/post-builder/ai-meme-recommendation.svelte';
	import type {
		AIMemeRecommendationCandidate,
		AIMemeRecommendationCopy
	} from '$lib/components/post-builder/ai-meme-recommendation';
	import {
		memePreviewDataURL,
		previewMeme,
		renderMeme,
		suggestMemes
	} from '$lib/meme-generator/api';
	import type { MemeSuggestionCandidate } from '$lib/meme-generator/types';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { fittedImageSettings } from './compose/image-settings';
	import { optimizeStoredImage, fitStoredImage } from '$lib/media/image-preparation';
	import {
		MAX_COMPOSER_DRAFT_MEDIA,
		mediaCapabilityItemsFromIds,
		providerMediaWarningMessages
	} from '$lib/media-capabilities';
	import { workspaceCtx, type WorkspaceSwitchRequest } from '$lib/stores/workspace.svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import SocialSetControl from './social-set-control.svelte';
	import SocialAccountIdentity from './social-account-identity.svelte';
	import ComposerRequiredFields from './composer-required-fields.svelte';
	import ComposerPublishActions from './composer-publish-actions.svelte';
	import ComposerAIActionButton from './composer-ai-action-button.svelte';
	import ComposerDeliveryFeedback from './composer-delivery-feedback.svelte';
	import ComposerDestinationTabs from './composer-destination-tabs.svelte';
	import ComposerVariantToolbar from './composer-variant-toolbar.svelte';
	import ComposerCharCounter from './composer-char-counter.svelte';
	import ComposerMediaGrid from './composer-media-grid.svelte';
	import ComposerMediaActions from './composer-media-actions.svelte';
	import PasteUploadList from './paste-upload-list.svelte';
	import SaveIndicator from './save-indicator.svelte';
	import ComposerScheduleDialog from './composer-schedule-dialog.svelte';
	import ComposerRepostControl from './composer-repost-control.svelte';
	import ComposerValidationMenu from './composer-validation-menu.svelte';
	import DestinationSettingsDialog from './destination-settings-dialog.svelte';
	import InlineNotice from './inline-notice.svelte';
	import TextCardPreview from './text-card-preview.svelte';
	import {
		supportsTextCards,
		textCardDefaultsFrom,
		textCardRequest,
		textCardIdentityForAccount,
		textCardRequestKey,
		savedTextCardPreviews,
		withTextCardImages,
		type TextCardResult
	} from '$lib/text-cards';
	import WorkspaceSetupGuide from './workspace-setup-guide.svelte';
	import WorkspaceActivationCompletion from './workspace-activation-completion.svelte';
	import PlatformIcon from './platform-icon.svelte';
	import { formatSocialAccountLabel, formatSocialAccountName } from '$lib/utils';
	import { Badge } from '$lib/components/ui/badge';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { CalendarDate, isEqualDay } from '@internationalized/date';
	import { ProtectedIcon, ThemeIcon } from '$lib/themes/icons';
	import { ui, type RepurposeHandoff } from '$lib/stores/ui.svelte';
	import ReorderList from '$lib/components/reorder-list.svelte';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import {
		type PostItem,
		makeEmptyPost,
		getDraftSnapshot,
		hasAnyContent,
		type VariantPost,
		arraysEqual,
		makeVariantRecord,
		normalizeVariantRecord,
		variantRecordEquals
	} from './compose/draft-utils';
	import { platformTextLength, uniquePlatformLimits } from './compose/platform-limits';
	import { readinessStateMessage } from './account-presentation';
	import { editorAccountIdAfterVariantLoad } from './compose/editor-target';
	import { isActionableAccountIssue } from './compose/account-attention';
	import {
		capabilityResolutionIsFresh,
		capabilityResponseApplies,
		hasUsableCapabilities
	} from './compose/capability-readiness';
	import { accountNeedsSegmentCopy } from './compose/segment-overrides';
	import {
		composerIssues,
		isAccountSpecificIssue,
		issueMatchesProvider,
		uniqueIssueMessages,
		type ComposerIssue,
		type TargetedComposerIssue
	} from './compose/validation';
	import {
		composerDestinationSettings,
		invalidateDependentDestinationSettings,
		loadableDestinationOptionSources,
		mergeDestinationOptions
	} from './compose/destination-options';
	import {
		workspaceClock,
		workspaceDateKeyFromISO,
		workspaceScheduleFromISO,
		workspaceScheduleToISO,
		parseScheduleDateParam
	} from './compose/schedule-timezone';
	import {
		buildPublicationPayload,
		parseComposerSettingOptionalString,
		type ComposerModeKey,
		type ComposerPublicationPayload,
		type ComposerSettings,
		type ComposerSettingValue,
		type PublicationMediaPayload,
		type PublicationMediaInput,
		type ResolvedComposerTarget
	} from './compose/modes';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { celebrateSchedule } from '$lib/celebrate-schedule';
	import { requestDestructiveAction } from '$lib/destructive-action';
	import AppToast from './app-toast.svelte';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import DraftConflictDialog from './draft-conflict-dialog.svelte';
	import MediaPicker from './media-picker.svelte';
	import {
		consumeImageEditorReturnToken,
		createImageEditorDesign,
		createImageEditorReturnToken
	} from '$lib/image-editor/api';
	import {
		clearEditorHandoff,
		loadEditorHandoff,
		storeEditorHandoff,
		type ComposerRecoverySnapshot
	} from '$lib/editor-handoff';
	import {
		parseComposerHandoffPayload,
		type ComposerCoverTarget,
		type ComposerHandoffPayload
	} from '$lib/composer/handoff-payload';
	import type { ImageEditorMediaItem } from '$lib/image-editor/types';
	import type { DraftConflictProblem } from '$lib/draft-conflict';
	import {
		ComposerSession,
		ComposerSessionError,
		type ComposerWorkspaceSwitchState,
		type PublicationDraft
	} from '$lib/composer/session';
	import { composerErrorMessage } from '$lib/composer/error-presentation';
	import {
		createComposerPublicationClient,
		publicationDraft
	} from '$lib/composer/publication-client';
	import { buildComposerPreview } from '$lib/compose-preview';
	import ComposerPreview from '$lib/components/composer-preview.svelte';
	import { openPreviewWindow, type PreviewWindowSession } from '$lib/preview-window';
	import { uploadMediaFile, type MediaUploadResult } from '$lib/media-upload-client';
	import type { MediaPickerVideoSelection } from '$lib/media-picker';
	import {
		boundImageCaptionPostContext,
		generateImageAltText,
		resolveImageCaptionRetryContext
	} from '$lib/image-caption';
	import { firstComposerURL } from './compose/composer-links';
	import {
		presentProviderReadiness,
		type ProviderReadinessDecision,
		type ProviderReadinessOperation,
		type ProviderReadinessPresentation
	} from '$lib/provider-readiness';
	import {
		ComposerSessionMediaQueue,
		availablePasteMediaSlots,
		firstFailedPasteMediaUpload,
		hasUnsettledPasteMediaUploads,
		pasteMediaTargetKey,
		selectPastedImageFiles,
		type PasteMediaUploadItem,
		type PasteMediaUploadTarget,
		type PastedImageRejectionReason
	} from '$lib/composer/media-queue';
	import { mediaFileSignature } from '$lib/media-input';

	// --------------------------------------------------------------------------
	// Types
	// --------------------------------------------------------------------------
	type Publication = components['schemas']['PublicationResponse'];
	type SocialSet = components['schemas']['SocialSetResponse'];
	type Capability = components['schemas']['Capability'];
	type SettingDefinition = components['schemas']['SettingDefinition'];
	type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
	type ResolvedAccountCapabilityWithReadiness = ResolvedAccountCapability & {
		immediate_readiness?: ProviderReadinessDecision;
		scheduled_readiness?: ProviderReadinessDecision;
	};
	type DestinationOption = components['schemas']['DestinationOption'];
	type ValidationIssue = components['schemas']['ValidationIssue'];
	type DeliveryOutcome = components['schemas']['RenditionActionOutcome'];
	type ComposerRenditionSegment = NonNullable<
		NonNullable<ComposerPublicationPayload['renditions']>[number]['segments']
	>[number];
	type ProviderSettingValue = SettingDefinition['default'];
	type ProviderSettings = NonNullable<components['schemas']['RenditionInput']['settings']>;
	const AI_BUILD_METADATA_KEY = 'ai_publication_build';
	const AI_OPPORTUNITY_SLOW_DELAY_MS = 8_000;
	const aiPlatformStrategySchema = z.object({
		account_id: z.string().min(1),
		platform: z.string().min(1),
		objective: z.string(),
		archetype: z.string(),
		media: z.object({
			treatment: z.string(),
			role: z.string(),
			brief: z.string(),
			source_ref: z.string().optional(),
			template_id: z.string().optional(),
			alt_text: z.string().optional()
		}),
		warnings: z.array(z.string()).optional()
	});
	const attachmentRequirementSchema = z.object({
		kind: z.enum(['image', 'video']),
		brief: z.string(),
		document: z.json().optional()
	});
	type AttachmentRequirement = z.infer<typeof attachmentRequirementSchema>;
	let requirementReviewId = $state('');
	let requirementReviewText = $state('');
	let aiAttachmentRequirements = $state.raw<Record<string, AttachmentRequirement>>({});
	const aiBuildMetadataSchema = z.object({
		version: z.literal(1),
		strategies: z.array(aiPlatformStrategySchema)
	});
	type AIPlatformStrategy = z.infer<typeof aiPlatformStrategySchema>;
	interface AIComposerCheckpoint {
		selectedAccountIds: string[];
		selectedSocialSetId: string;
		posts: PostItem[];
		variants: Array<[string, Record<string, VariantPost>]>;
		linkUrl: string;
		requestedOutputProfiles: Record<string, string>;
		formatLockedByAccount: Record<string, boolean>;
		strategies: AIPlatformStrategy[];
		attachmentRequirements: Record<string, AttachmentRequirement>;
	}

	interface Props {
		initialToolDraft?: PreparedToolDraft | null;
		initialPublication?: Publication | null;
		initialScheduleDate?: string | null;
		initialScheduleTime?: string | null;
		initialWorkspaceId?: string | null;
		initialAccountIds?: string[];
		initialMediaIds?: string[];
		onHandoffSelected?: () => void;
		onSuccess?: () => void;
		onDeleted?: () => void | Promise<void>;
		onDraftCreated?: (id: string) => void;
		onThreadStateChange?: (isThread: boolean) => void;
		onOpenVersionHistory?: () => void;
		onCopyAsDraft?: () => void | Promise<void>;
		copyingDraft?: boolean;
		hideSetupGuideOnDesktop?: boolean;
	}

	// --------------------------------------------------------------------------
	// Props & core state
	// --------------------------------------------------------------------------
	let {
		initialToolDraft = null,
		initialPublication = null,
		initialScheduleDate = null,
		initialScheduleTime = null,
		initialWorkspaceId = null,
		initialAccountIds = [],
		initialMediaIds = [],
		onHandoffSelected,
		onSuccess,
		onDeleted,
		onDraftCreated,
		onThreadStateChange,
		onOpenVersionHistory,
		onCopyAsDraft,
		copyingDraft = false,
		hideSetupGuideOnDesktop = false
	}: Props = $props();
	const unsavedChangesKey = $props.id();
	const unsavedChanges = getOptionalUnsavedChanges();
	let isEditMode = $derived(Boolean(initialPublication));

	let posts = $state<PostItem[]>([makeEmptyPost()]);
	let activePostIndex = $state(0);
	let publicationId = $state('');
	let revision = $state(1);
	let reviewState = $state('');
	let lastInitializedPublicationId = $state<string | null>(null);
	let appliedInitialMediaKey = $state('');
	let isSaving = $state(false);
	let isSubmitting = $state(false);
	let deliveryPublicationID = $state('');
	let deliveryFeedback = $state.raw<DeliveryOutcome[]>([]);
	let undoReorderIDs = $state<string[] | null>(null);
	let reorderScope = $state('');
	$effect(() => {
		const scope = `${selectedWorkspaceId}:${publicationId}`;
		if (scope !== reorderScope) {
			undoReorderIDs = null;
			reorderScope = scope;
		}
		if (
			undoReorderIDs &&
			(undoReorderIDs.length !== posts.length ||
				posts.some((post) => !undoReorderIDs?.includes(post.key)))
		)
			undoReorderIDs = null;
	});
	let retryingDeliveryRenditionID = $state('');
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let error = $state('');
	let success = $state('');
	let activationPublicationID = $state('');
	let draftConflict = $state<DraftConflictProblem | null>(null);
	let conflictDialogOpen = $state(false);
	let linkUrl = $state('');
	let composerSettingsOpen = $state(false);
	let pollEditorPostKey = $state<string | null>(null);

	async function openVersionHistory() {
		composerSettingsOpen = false;
		await tick();
		onOpenVersionHistory?.();
	}

	let workspaces = $state.raw<Workspace[]>([]);
	let selectedWorkspaceId = $state<string>('');
	const compositionClaimedWorkspaceIDs = new SvelteSet<string>();
	const compositionClaimOrigins = new SvelteMap<string, string>();
	const compositionClaimPendingWorkspaceIDs = new SvelteSet<string>();
	let accounts = $state.raw<SocialAccount[]>([]);
	let selectedAccountIds = $state<string[]>([]);
	let selectedSocialSetId = $state('');
	let capabilities = $state.raw<Capability[]>([]);
	let requestedOutputProfiles = $state<Record<string, string>>({});
	let formatLockedByAccount = $state<Record<string, boolean>>({});
	let scheduleOverridesByAccount = $state<Record<string, string>>({});
	let loadingWorkspaces = $state(true);
	let loadingAccounts = $state(false);
	let workspaceLoadError = $state('');
	let workspaceSettingsError = $state('');
	let workspaceChangeNotice = $state('');
	let workspaceSwitchState = $state.raw<ComposerWorkspaceSwitchState | null>(null);
	let leaveEditorForWorkspaceID = '';
	let accountLoadError = $state('');
	let accountsWorkspaceId = $state('');
	let mentionDialogSequence = 0;
	let mentionDialog = $state.raw<{
		id: number;
		workspaceId: string;
		name: string;
		complete: (candidate: MentionCandidate) => void;
		session: QueryMutationSession;
	} | null>(null);
	$effect(() => {
		if (mentionDialog && mentionDialog.workspaceId !== selectedWorkspaceId) mentionDialog = null;
	});
	let accountRetryIds: string[] | undefined = undefined;
	let workspaceRequestSequence = 0;
	let accountRequestSequence = 0;
	let composerDestroyed = false;
	let modalApply: import('$lib/post-builder/ideate.svelte').IdeateEntry['apply'];
	let nextSlotRequestSequence = 0;
	let saveGeneration = 0;
	let saveOperationSequence = 0;
	let composerSession: ComposerSession | null = null;
	let unsubscribeComposerSession: (() => void) | null = null;
	let allowNavigationOnce = false;

	let selectedDate = $state<CalendarDate | undefined>(undefined);
	let selectedTime = $state<string | null>(null);
	let suggestingSlot = $state(false);
	let showScheduleDialog = $state(false);
	let scheduleInputError = $state('');
	let randomDelayOverride = $state<string>('default');
	let repostOverride = $state<components['schemas']['Override']>({ mode: 'inherit' });

	let buildingPost = $state(false);
	let postBuilderError = $state('');
	let aiWorkspaceOpen = $state(false);
	let aiWorkspaceEntry = $state<AIWorkspaceEntry>('build');
	let aiWorkspaceStep = $state<AIWorkspaceStep>('angles');
	let aiPostOptions = $state.raw<PublicationPostOption[]>([]);
	let aiOptionMedia = $state.raw<Record<string, string[]> | undefined>();
	let aiOpportunities = $state.raw<PublicationOpportunity[]>([]);
	let aiSelectedOpportunityID = $state('');
	let aiAngles = $state.raw<PublicationBuildAngle[]>([]);
	let aiSelectedAngleID = $state('');
	let aiOpportunityLoading = $state(false);
	let aiFindingMore = $state(false);
	let aiCancelling = $state(false);
	let aiObjective = $state('');
	let aiChangeRequest = $state('');
	let aiIdeationBrief = $state('');
	let aiContextNotes = $state('');
	let aiContextURLs = $state('');
	let aiContextMayPublish = $state(false);
	let repurposePrivateContextNotes = $state('');
	let repurposeReviewActive = $state(false);
	let appliedRepurposeHandoffID = '';
	let toolDraftApplied = false;
	let aiVoiceName = $state<string>(m.compose_ai_default_voice());
	let aiVoiceProfileID = $state('');
	let aiActiveBuild = $state.raw<PublicationBuild | null>(null);
	let aiPendingResult = $state.raw<PublicationBuildResult | null>(null);
	let aiAppliedResult = $state.raw<PublicationBuildResult | null>(null);
	let aiAppliedStrategies = $state.raw<AIPlatformStrategy[]>([]);
	let aiApplyPending = $state(false);
	let aiGenerationBaseline = '';
	let aiGenerationIdea = '';
	let aiBuildPublicationID = '';
	let aiPollTimer: ReturnType<typeof setTimeout> | null = null;
	let aiOpportunitySlowTimer: ReturnType<typeof setTimeout> | null = null;
	let aiOpportunitySlow = $state(false);
	let aiBuildCreateRejected = $state(false);
	let aiRequestController: AbortController | null = null;
	let aiVoiceRequestController: AbortController | null = null;
	let aiMemeCandidates = $state.raw<AIMemeRecommendationCandidate[]>([]);
	let aiMemeSelectedID = $state('');
	let aiMemeError = $state('');
	let aiMemeTargetAccountIDs = $state.raw<string[]>([]);
	let aiMemeWorkspaceID = '';
	let aiMemeRequestGeneration = 0;
	let mediaPickerMemeTargetAccountIDs: string[] = [];
	let mediaPickerMemeRequestGeneration = 0;
	let generationUndo = $state.raw<AIComposerCheckpoint | null>(null);
	let latestGenerationUndo = $state.raw<AIComposerCheckpoint | null>(null);

	let variants = $state<Map<string, Record<string, VariantPost>>>(new Map());
	let activeVariantAccountId = $state<string | null>(null);
	let destinationActionOpen = $state(false);
	let destinationCopyError = $state('');
	let destinationAction = $state<'copy' | 'media'>('copy');
	let destinationActionTargetIds = $state<string[]>([]);

	let isDraggingFile = $state(false);

	let mediaAltTexts = $state<Map<string, string>>(new Map());
	let mediaPreviewMetadata = new SvelteMap<
		string,
		{ aspectRatio?: number; poster?: string; width?: number; height?: number }
	>();
	let mediaMimeTypes = $state<Map<string, string>>(new Map());
	let mediaSizes = $state<Map<string, number>>(new Map());
	let pasteMediaUploads = $state.raw<PasteMediaUploadItem[]>([]);
	let pasteMediaFeedback = $state.raw<{ targetKey: string; messages: string[] } | null>(null);
	let pasteMediaAnnouncement = $state('');
	let imagePreparationNotice = $state('');
	let fittingImageId = $state('');
	const imagePreparationSources = new SvelteMap<string, string>();
	const losslessPreparedImageIds = new Set<string>();
	const imagePreparationRequests = new Set<AbortController>();
	let pendingImagePreparationContext = $state<string | null>(null);

	const pasteMediaUploadQueue = new ComposerSessionMediaQueue<MediaUploadResult>({
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
		onComplete: completePastedMediaUpload,
		onChange: (items) => (pasteMediaUploads = items),
		errorMessage: (cause) =>
			cause instanceof Error && cause.message ? cause.message : m.compose_upload_failed(),
		maxConcurrentUploads: 3
	});
	const captioningMediaIds = new SvelteSet<string>();
	const failedCaptionMediaIds = new SvelteSet<string>();
	const suppressedCaptionMediaIds = new SvelteSet<string>();
	const captionRequests = new SvelteMap<string, AbortController>();
	const pendingCaptionResults = new Map<string, ReturnType<typeof generateImageAltText>>();
	const accountCaptionSuppressions = new Map<string, Set<string>>();
	const captionPostContexts = new SvelteMap<string, string>();
	let captionGenerationError = $state('');
	let editingAltMediaId = $state<string | null>(null);
	let previewMediaOpen = $state(false);
	let settingsByAccount = $state<Record<string, ComposerSettings>>({});
	const textCardResults = new SvelteMap<string, TextCardResult>();
	let textCardNoticeDismissed = $state(false);
	let savedCardPreviews = $state<Record<string, TextCardResult>>({});
	// Renditions whose stored text-card images back savedCardPreviews. Kept so
	// the preview keys can be recomputed once capability defaults resolve.
	let savedCardRenditions: Publication['renditions'] | undefined;
	let segmentSettingsByPost = $state<Record<string, Record<string, ComposerSettings>>>({});
	let mediaSettingsByAccount = $state<Record<string, Record<string, ComposerSettings>>>({});
	const imagePreparationContext = $derived(
		JSON.stringify({
			accounts: selectedAccountIds,
			profiles: requestedOutputProfiles,
			locked: formatLockedByAccount,
			settings: settingsByAccount,
			segments: segmentSettingsByPost,
			media: posts.map((post) => ({
				key: post.key,
				ids: post.mediaIds,
				accounts: selectedAccountIds.map((id) => {
					const variant = variants.get(id)?.[post.key];
					return {
						id,
						inherited: variant?.mediaInherited ?? true,
						ids: variant?.mediaInherited === false ? variant.mediaIds : post.mediaIds
					};
				})
			}))
		})
	);
	$effect(() => {
		if (
			pendingImagePreparationContext !== null &&
			imagePreparationContext !== pendingImagePreparationContext
		) {
			for (const controller of imagePreparationRequests) controller.abort();
		}
	});
	let mediaPickerOpen = $state(false);
	let mediaPickerPostIndex = $state(0);
	let mediaPickerInitialFiles = $state.raw<File[]>([]);
	let mediaPickerInitialMode = $state<'upload' | 'meme'>('upload');
	let mediaPickerMemeIdea = $state('');
	let mediaPickerMemeCandidate = $state.raw<MemeSuggestionCandidate | undefined>(undefined);
	let mediaPickerMemePreview = $state('');
	let resolvedCapabilities = $state<Record<string, ResolvedAccountCapabilityWithReadiness>>({});
	let capabilityResolveLoading = $state(false);
	let capabilityResolveError = $state('');
	let validationIssues = $state<ValidationIssue[]>([]);
	let settingsDialogOpen = $state(false);
	let settingsAccountId = $state('');
	let destinationOptionsByAccount = $state<Record<string, Record<string, DestinationOption[]>>>({});
	let destinationOptionCursorsByAccount = $state<Record<string, Record<string, string>>>({});
	let destinationOptionSearchByAccount = $state<Record<string, Record<string, string>>>({});
	let destinationOptionsErrors = $state<Record<string, string>>({});
	const destinationOptionsLoadingAccountIds = new SvelteSet<string>();
	const destinationOptionsLoadingCounts = new Map<string, number>();
	let capabilityResolveTimer: ReturnType<typeof setTimeout> | null = null;
	let capabilityResolveAbortController: AbortController | null = null;
	let lastResolvedCapabilityInputSnapshot = $state('');
	let lastResolvedCapabilityStructureSnapshot = $state('');
	const destinationOptionsRequestSequences = new Map<string, number>();
	let capabilityResolveRequestSequence = 0;

	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let savedIndicatorTimer: ReturnType<typeof setTimeout> | null = null;
	let savedIndicatorVisible = $state(false);
	let lastSavedSnapshot = $state('');
	let lastSavedScheduleAt = '';
	let appliedInitialContextKey = $state('');
	const previewSessions = new SvelteMap<string, PreviewWindowSession>();
	let pollCreationAccountID = $state<string | undefined>();
	let previewPollEditingKeys = new SvelteSet<string>();
	const randomDelayOptions = [0, 5, 10, 15, 30, 45, 60];
	const desktopComposerControls = new MediaQuery('min-width: 768px');
	const accountControlLoading = $derived(loadingWorkspaces || loadingAccounts);
	const selectedWorkspaceSettingsReady = $derived(
		Boolean(selectedWorkspaceId) &&
			workspaceCtx.currentWorkspace?.id === selectedWorkspaceId &&
			workspaceCtx.settingsReady
	);

	function getComposerSession(workspaceId: string) {
		if (!composerSession || composerSession.workspaceId !== workspaceId) {
			unsubscribeComposerSession?.();
			composerSession = new ComposerSession({
				workspaceId,
				client: createComposerPublicationClient(workspaceId)
			});
			unsubscribeComposerSession = composerSession.subscribe((state) => {
				workspaceSwitchState = state.workspaceSwitch;
				if (state.publicationId) publicationId = state.publicationId;
				if (state.revision !== null) revision = state.revision;
				isSaving = state.phase === 'loading' || state.phase === 'saving';
				if (state.validationIssues.length > 0 || state.phase === 'validating') {
					validationIssues = [...state.validationIssues];
				}
				if (state.conflict) {
					draftConflict = {
						code: 'draft_revision_conflict',
						detail: state.error
							? composerErrorMessage(state.error)
							: m.compose_update_draft_failed(),
						conflict: {
							aggregate_type: 'publication',
							aggregate_id: state.publicationId || publicationId,
							expected_revision: state.conflict.expectedRevision,
							current_revision: state.conflict.currentRevision,
							status: state.status || 'draft',
							changed_domains: []
						}
					};
					conflictDialogOpen = true;
				}
			});
		}
		return composerSession;
	}

	async function sessionFor(workspaceId: string, existingPublicationId = '') {
		const session = getComposerSession(workspaceId);
		if (existingPublicationId && session.snapshot.publicationId !== existingPublicationId) {
			await session.load(existingPublicationId);
		}
		return session;
	}

	// --------------------------------------------------------------------------
	// Constants & derived values
	// --------------------------------------------------------------------------
	const scheduleTimezoneLabel = $derived(workspaceCtx.settings.timezone || 'UTC');

	// Generate time slots dynamically from workspace settings
	const allTimeSlots = $derived.by(() => {
		const start = workspaceCtx.settings.slot_start_hour;
		const end = workspaceCtx.settings.slot_end_hour;
		const interval = workspaceCtx.settings.slot_interval_minutes;
		const slots: string[] = [];
		if (!Number.isInteger(interval) || interval < 1) return slots;
		for (let minutes = start * 60; minutes <= end * 60; minutes += interval) {
			const hour = Math.floor(minutes / 60);
			const minute = minutes % 60;
			slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
		}
		return slots;
	});

	const timeSlots = $derived(selectedDate ? slotsForDate(selectedDate) : allTimeSlots);

	function slotsForDate(date: CalendarDate): string[] {
		const validSlots = allTimeSlots.filter((slot) =>
			Boolean(workspaceScheduleToISO(date, slot, scheduleTimezoneLabel))
		);
		if (!isEqualDay(date, workspaceClock(scheduleTimezoneLabel).date)) return validSlots;
		const currentMinutes = workspaceClock(scheduleTimezoneLabel).minutes;
		return validSlots.filter((slot) => {
			const [hours, minutes] = slot.split(':').map(Number);
			return hours * 60 + minutes > currentMinutes;
		});
	}

	const activePost = $derived(posts[activePostIndex] ?? posts[0]);
	const isThread = $derived(posts.length > 1);
	const hasContent = $derived(hasAnyContent(posts));
	const hasPendingPasteMediaUploads = $derived(hasUnsettledPasteMediaUploads(pasteMediaUploads));
	const canBuildPost = $derived(
		!isThread &&
			!activeVariantAccountId &&
			!isSubmitting &&
			!isSaving &&
			!buildingPost &&
			!hasPendingPasteMediaUploads
	);
	const aiWorkspaceCopy: AIWorkspaceDialogCopy = {
		ideateTitle: m.compose_ai_ideate_title(),
		ideateDescription: m.compose_ai_ideate_description(),
		buildTitle: m.compose_ai_angles_title(),
		buildDescription: m.compose_ai_angles_description(),
		back: m.compose_ai_back_to_ideas(),
		dismiss: m.common_dismiss(),
		getIdeas: m.compose_ai_get_ideas(),
		continue: m.compose_ai_continue(),
		findMore: m.compose_ai_find_more(),
		findingMore: m.compose_ai_finding_more(),
		buildDrafts: m.compose_ai_build_drafts(),
		cancel: m.compose_ai_cancel_build(),
		cancelling: m.compose_ai_cancelling(),
		retry: m.common_retry(),
		keepEdits: m.compose_ai_keep_edits(),
		reviewApply: m.compose_ai_review_apply(),
		opportunities: {
			heading: m.compose_ai_opportunities_heading(),
			description: m.compose_ai_opportunities_description(),
			whyItFits: m.compose_ai_why_it_fits(),
			bestFor: m.compose_ai_best_for(),
			media: m.compose_ai_media(),
			noMedia: m.compose_ai_no_media_needed(),
			loading: m.compose_ai_finding_ideas(),
			emptyTitle: m.compose_ai_no_ideas_title(),
			emptyDescription: m.compose_ai_no_ideas_description(),
			selected: m.compose_ai_selected_idea()
		},
		angles: {
			heading: m.compose_ai_five_angles_heading(),
			description: m.compose_ai_five_angles_description(),
			loading: m.compose_ai_planning_angles(),
			emptyTitle: m.compose_ai_no_angles_title(),
			emptyDescription: m.compose_ai_no_angles_description(),
			recommended: m.compose_ai_recommended(),
			bestFor: m.compose_ai_aim(),
			evidence: m.compose_ai_uses(),
			media: m.compose_ai_media(),
			noMedia: m.compose_ai_no_media_needed(),
			selected: m.compose_ai_selected_angle()
		},
		progress: {
			heading: m.compose_ai_progress_heading(),
			description: m.compose_ai_progress_description()
		}
	};
	const repurposeWorkspaceCopy: AIWorkspaceDialogCopy = {
		...aiWorkspaceCopy,
		buildTitle: m.compose_ai_repurpose_review_title(),
		buildDescription: m.compose_ai_repurpose_review_description(),
		angles: {
			...aiWorkspaceCopy.angles,
			heading: m.compose_ai_repurpose_review_heading(),
			description: m.compose_ai_repurpose_review_hint()
		}
	};
	const aiMemeCopy: AIMemeRecommendationCopy = {
		title: m.compose_ai_meme_title(),
		description: m.compose_ai_meme_description(),
		recommendedLabel: m.compose_ai_meme_best_fit(),
		alternativesLabel: m.compose_ai_meme_alternatives(),
		useLabel: m.compose_ai_meme_use(),
		usingLabel: m.compose_ai_meme_adding(),
		editLabel: m.compose_ai_meme_edit(),
		editingLabel: m.compose_ai_meme_opening(),
		retryLabel: m.compose_ai_meme_retry_preview(),
		retryingLabel: m.compose_ai_meme_rendering_preview(),
		previewLoading: m.compose_ai_meme_preview_loading(),
		previewUnavailable: m.compose_ai_meme_preview_unavailable(),
		emptyTitle: m.compose_ai_meme_empty_title(),
		emptyDescription: m.compose_ai_meme_empty_description(),
		actionFailed: m.compose_ai_meme_action_failed(),
		selectAlternative: (templateName, position) =>
			m.compose_ai_meme_select_alternative({ templateName, position })
	};
	const aiWorkspaceOpportunities = $derived<AIOpportunity[]>(
		aiOpportunities.map((opportunity) => ({
			id: opportunity.id,
			title: opportunity.title,
			premise: opportunity.hook || opportunity.why_now,
			whyItFits: opportunity.why_it_fits,
			objective: opportunity.platform_treatments[0]?.objective,
			media: opportunity.platform_treatments[0]?.media,
			mediaRecommendation: opportunity.platform_treatments[0]?.media
		}))
	);
	const aiWorkspaceAngles = $derived<AIAngle[]>(
		aiAngles.map((angle) => ({
			id: angle.id,
			title: angle.label,
			premise: angle.hook,
			objective: angle.desired_reaction || angle.objective,
			evidence: angle.evidence,
			mediaRecommendation: angle.media.treatment === 'none' ? '' : angle.media.brief,
			recommended: angle.id === 'recommended',
			preservesCurrentAngle: angle.id === 'keep_current'
		}))
	);
	const aiGenerationPhases = $derived.by<AIGenerationPhase[]>(() => {
		const phase = aiActiveBuild?.phase ?? 'queued';
		const reachedCreation = ['drafting', 'reviewing', 'ready', 'committed'].includes(phase);
		const reachedReview = ['reviewing', 'ready', 'committed'].includes(phase);
		const finished = ['ready', 'committed'].includes(phase);
		return [
			{
				id: 'understanding',
				label: m.compose_ai_phase_understanding(),
				status: reachedCreation ? 'complete' : 'active'
			},
			{
				id: 'creating',
				label: m.compose_ai_phase_creating(),
				status: reachedReview ? 'complete' : reachedCreation ? 'active' : 'pending'
			},
			{
				id: 'checking',
				label: m.compose_ai_phase_checking(),
				status: finished ? 'complete' : reachedReview ? 'active' : 'pending'
			}
		];
	});
	const aiGenerationMessage = $derived(
		aiApplyPending
			? m.compose_ai_progress_conflict()
			: aiActiveBuild?.state === 'failed'
				? aiActiveBuild.error_message || m.compose_ai_progress_stopped()
				: aiActiveBuild?.state === 'ready'
					? m.compose_ai_progress_ready()
					: m.compose_ai_progress_resumable()
	);
	const aiGenerationActive = $derived(
		Boolean(aiBuildPublicationID) &&
			(aiActiveBuild === null ||
				aiActiveBuild.state === 'queued' ||
				aiActiveBuild.state === 'building')
	);
	function localizedAIObjective(objective: string): string {
		switch (objective) {
			case 'reach':
				return m.compose_ai_objective_reach();
			case 'comments':
				return m.compose_ai_objective_comments();
			case 'reposts':
				return m.compose_ai_objective_reposts();
			case 'authority':
				return m.compose_ai_objective_authority();
			case 'trust':
				return m.compose_ai_objective_trust();
			case 'shares':
				return m.compose_ai_objective_shares();
			case 'conversation':
				return m.compose_ai_objective_conversation();
			case 'follows':
				return m.compose_ai_objective_follows();
			case 'clicks':
				return m.compose_ai_objective_clicks();
			case 'boosts':
				return m.compose_ai_objective_boosts();
			case 'hashtag_discovery':
				return m.compose_ai_objective_hashtag_discovery();
			case 'following':
				return m.compose_ai_objective_following_feed();
			case 'discover':
				return m.compose_ai_objective_discover();
			case 'target_feed':
				return m.compose_ai_objective_target_feed();
			case 'quotes':
				return m.compose_ai_objective_quotes();
			case 'community_growth':
				return m.compose_ai_objective_community_growth();
			case 'cross_meta_reach':
				return m.compose_ai_objective_cross_meta_reach();
			default:
				return m.compose_ai_objective_platform_goal();
		}
	}

	function localizedAIMediaTreatment(treatment: string): string {
		switch (treatment) {
			case 'use_source':
				return m.compose_ai_media_use_source();
			case 'annotate_source':
				return m.compose_ai_media_annotate_source();
			case 'meme':
				return m.compose_ai_media_meme();
			case 'statement_card':
				return m.compose_ai_media_statement_card();
			case 'carousel':
				return m.compose_ai_media_carousel();
			case 'concept_image':
				return m.compose_ai_media_concept_image();
			case 'short_video_script':
				return m.compose_ai_media_short_video();
			case 'edit_existing_video':
				return m.compose_ai_media_edit_video();
			default:
				return m.compose_ai_media_recommended();
		}
	}
	const visibleAIStrategies = $derived(
		aiAppliedStrategies.filter(
			(destination) => !activeVariantAccountId || destination.account_id === activeVariantAccountId
		)
	);
	const totalChars = $derived(posts.reduce((sum, p) => sum + p.content.length, 0));
	const textComposerMode = $derived<ComposerModeKey>(isThread ? 'thread' : 'post');
	const compatibleAccounts = $derived(accounts);
	const autoSavesDraft = $derived(!isEditMode || initialPublication?.status === 'draft');
	const composerWorkspaceStateDirty = $derived(
		hasPendingPasteMediaUploads ||
			((hasContent || Boolean(lastSavedSnapshot)) && getSaveSnapshot() !== lastSavedSnapshot) ||
			Boolean(draftConflict)
	);
	$effect(() => {
		unsavedChanges?.set(
			unsavedChangesKey,
			!loadingWorkspaces && !autoSavesDraft && composerWorkspaceStateDirty,
			m.compose_leave_without_saving(),
			// Workspace changes already have a save/discard/stay flow.
			{ guardWorkspaceSwitch: false }
		);
		return () => unsavedChanges?.clear(unsavedChangesKey);
	});
	const selectedAccounts = $derived(
		selectedAccountIds
			.map((id) => accounts.find((account) => account.id === id))
			.filter((account): account is SocialAccount => Boolean(account))
	);
	const textCardIdentities = $derived(
		Object.fromEntries(accounts.map((account) => [account.id, textCardIdentityForAccount(account)]))
	);
	const deliveryAccountLabels = $derived.by(() =>
		Object.fromEntries(accounts.map((account) => [account.id, accountLabel(account)]))
	);
	// Keep drafts permissive so one attachment can transition into a provider's
	// multi-image profile. Destination-specific limits are resolved and block
	// validation/publishing without discarding the user's media selection.
	const composerMediaLimit = MAX_COMPOSER_DRAFT_MEDIA;
	const settingsAccount = $derived(
		accounts.find((account) => account.id === settingsAccountId) ?? null
	);
	const settingsDialogFields = $derived(
		settingsAccount
			? visibleSettings(settingsAccount).filter(
					(field) =>
						!activePost?.poll ||
						activePost.poll.destinations[settingsAccount.id]?.mode === 'legacy' ||
						!field.key.startsWith('poll_')
				)
			: []
	);
	const settingsDialogValues = $derived(
		settingsAccount ? dialogSettingsForAccount(settingsAccount) : {}
	);
	const settingsDialogMedia = $derived(mediaForSettingsDialog());
	const settingsDialogMediaValues = $derived(
		settingsAccount ? mediaSettingsForDialog(settingsAccount) : {}
	);
	const requiredValuesByAccount = $derived(
		Object.fromEntries(
			selectedAccounts.map((account) => [account.id, dialogSettingsForAccount(account)])
		)
	);
	const editorMediaAltTexts = $derived.by(() => {
		const values = new SvelteMap(mediaAltTexts);
		if (activeVariantAccountId) {
			for (const [mediaId, settings] of Object.entries(mediaSettingsByAccount)) {
				const alt = parseComposerSettingOptionalString(settings[activeVariantAccountId]?.alt_text);
				if (alt !== undefined) values.set(mediaId, alt);
			}
		}
		return values;
	});
	const capabilityInputSnapshot = $derived(
		JSON.stringify({
			workspace: selectedWorkspaceId,
			variants: Array.from(variants.entries()),
			mediaAltTexts: Array.from(mediaAltTexts.entries()),
			accounts: selectedAccountIds,
			mode: textComposerMode,
			requestedOutputProfiles,
			linkUrl,
			posts: posts.map((post) => ({
				key: post.key,
				content: post.content,
				mentions: post.mentions,
				mediaIds: post.mediaIds,
				poll: post.poll,
				link: post.link
			})),
			settingsByAccount,
			segmentSettingsByPost,
			mediaSettingsByAccount,
			attachmentRequirements: aiAttachmentRequirements
		})
	);
	const capabilityReadinessCurrent = $derived(
		!capabilityResolveLoading &&
			lastResolvedCapabilityInputSnapshot === capabilityInputSnapshot &&
			selectedAccountIds.every((accountID) => Boolean(resolvedCapabilities[accountID]))
	);
	// Content edits keep the previous answer usable. Structural edits (accounts,
	// formats, media shape, destination settings) must wait for the next answer.
	const capabilityStructureSnapshot = $derived(
		JSON.stringify({
			workspace: selectedWorkspaceId,
			accounts: selectedAccountIds,
			mode: textComposerMode,
			requestedOutputProfiles,
			posts: posts.map((post) => ({ mediaIds: post.mediaIds, poll: Boolean(post.poll) })),
			variants: Array.from(variants.entries()).map(([accountID, values]) => [
				accountID,
				Object.fromEntries(
					Object.entries(values).map(([key, value]) => [
						key,
						{ mediaIds: value.mediaIds, contentInherited: value.contentInherited }
					])
				)
			]),
			settingsByAccount,
			segmentSettingsByPost,
			attachmentRequirements: aiAttachmentRequirements
		})
	);
	const capabilityReadinessKnown = $derived(
		hasUsableCapabilities(selectedAccountIds, resolvedCapabilities, capabilityResolveError) &&
			lastResolvedCapabilityStructureSnapshot === capabilityStructureSnapshot
	);
	const settingsDialogEmptyHint = $derived(
		capabilityReadinessCurrent &&
			settingsAccount &&
			getPlatformKey(settingsAccount.platform) === 'youtube' &&
			settingsDialogFields.length === 0 &&
			settingsDialogMedia.length === 0 &&
			resolvedCapabilities[settingsAccount.id]?.issues?.some(
				(issue) => issue.code === 'media_required'
			)
			? m.compose_settings_add_video_hint({ all: m.compose_all() })
			: ''
	);
	const localBlockers = $derived(globalFormBlockers());
	const validationDestinations = $derived(
		selectedAccounts.map((account) => ({
			accountId: account.id,
			provider: getPlatformKey(account.platform),
			label: accountContextLabel(account)
		}))
	);
	const targetedRuntimeIssues = $derived.by(() =>
		selectedAccounts.flatMap<TargetedComposerIssue>((account) =>
			uniqueIssueMessages([
				configuredPollErrorForAccount(account),
				...accountReadinessMessages(account)
			]).map((message, index) => ({
				id: `account-${account.id}-${index}-${message}`,
				message,
				accountId: account.id,
				targetLabel: accountContextLabel(account),
				provider: getPlatformKey(account.platform)
			}))
		)
	);
	const globalIssues = $derived(
		composerIssues(localBlockers, validationIssues, validationDestinations, targetedRuntimeIssues)
	);
	const visibleGlobalIssues = $derived(hasContent ? globalIssues : []);
	const accountIssues = $derived.by(() =>
		Object.fromEntries(
			selectedAccounts
				.map((account) => [account.id, accountIssueMessages(account)] as const)
				.filter(([, issues]) => issues.length > 0)
		)
	);
	const accountBlockingMessages = $derived(
		selectedAccounts.flatMap((account) => accountBlockers(account, true, false))
	);
	const sharedProviderKeys = $derived(
		new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))
	);
	const sharedTextIsYouTubeDescription = $derived(
		sharedProviderKeys.size === 1 && sharedProviderKeys.has('youtube')
	);
	const canSubmitPublication = $derived(
		!hasPendingPasteMediaUploads &&
			localBlockers.length === 0 &&
			accountBlockingMessages.length === 0
	);
	const canPublishNow = $derived(
		canSubmitPublication &&
			capabilityReadinessKnown &&
			selectedAccounts.every((account) => accountReadiness(account, 'publish_immediate').canProceed)
	);
	const canSchedulePublication = $derived(
		canSubmitPublication &&
			capabilityReadinessKnown &&
			selectedAccounts.every((account) => accountReadiness(account, 'publish_scheduled').canProceed)
	);
	const canSaveEditedPost = $derived(
		hasContent &&
			selectedAccountIds.length > 0 &&
			(!(selectedDate && selectedTime) || canSchedulePublication)
	);
	const activeVariantAccount = $derived(
		activeVariantAccountId ? (accounts.find((a) => a.id === activeVariantAccountId) ?? null) : null
	);
	const activeVariantIsUnsynced = $derived(
		activeVariantAccountId ? variants.has(activeVariantAccountId) : false
	);
	const editorTextIsYouTubeDescription = $derived(
		activeVariantAccount
			? getPlatformKey(activeVariantAccount.platform) === 'youtube'
			: sharedTextIsYouTubeDescription
	);
	const activeEditorContent = $derived(
		activeVariantAccountId
			? (getVariantContent(activeVariantAccountId, activePost.key) ?? activePost.content)
			: activePost.content
	);
	const editorTargetAccounts = $derived.by(() => {
		if (activeVariantAccountId) {
			const activeAccount = accounts.find((a) => a.id === activeVariantAccountId);
			return activeAccount ? [activeAccount] : [];
		}

		return selectedAccounts.filter((account) => !variants.has(account.id));
	});

	const editorLimitAccounts = $derived(editorTargetAccounts);

	const editorPlatformLimits = $derived.by(() => {
		return uniquePlatformLimits(editorLimitAccounts, resolvedCapabilities);
	});

	const effectiveRandomDelayMinutes = $derived.by(() => {
		if (randomDelayOverride === 'default') return workspaceCtx.settings.random_delay_minutes;
		const value = Number(randomDelayOverride);
		return Number.isFinite(value)
			? Math.max(0, Math.round(value))
			: workspaceCtx.settings.random_delay_minutes;
	});
	const randomDelaySelectOptions = $derived.by(() => {
		const options = new SvelteSet(randomDelayOptions);
		const selected = Number(randomDelayOverride);
		if (randomDelayOverride !== 'default' && Number.isFinite(selected)) {
			options.add(selected);
		}
		return Array.from(options).sort((a, b) => a - b);
	});

	// --------------------------------------------------------------------------
	// Helpers
	// --------------------------------------------------------------------------
	function applyInitialScheduleDate(dateParam: string | null, timeParam: string | null) {
		const date = parseScheduleDateParam(dateParam);
		if (!date) return;
		if (date.compare(workspaceClock(scheduleTimezoneLabel).date) < 0) {
			error = m.compose_schedule_future();
			return;
		}
		selectedDate = date;
		selectedTime =
			timeParam && /^([01]\d|2[0-3]):[0-5]\d$/.test(timeParam)
				? timeParam
				: (slotsForDate(date)[0] ?? allTimeSlots[0] ?? '09:00');
		scheduleInputError = '';
	}

	async function ensureComposerWorkspace(workspaceId: string) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		if (!workspace) throw new Error(m.compose_load_workspaces_failed());

		if (workspaceCtx.currentWorkspace?.id !== workspaceId) {
			await workspaceCtx.setWorkspace(workspace);
		} else if (!workspaceCtx.settingsReady) {
			await workspaceCtx.loadSettings(workspaceId);
		}

		if (!workspaceCtx.settingsReady || workspaceCtx.currentWorkspace?.id !== workspaceId) {
			throw new Error(m.compose_load_workspace_settings_failed());
		}
		workspaceSettingsError = '';
	}

	async function retryComposerWorkspaceSettings() {
		if (!selectedWorkspaceId || workspaceCtx.currentWorkspace?.id !== selectedWorkspaceId) return;
		workspaceSettingsError = '';
		await workspaceCtx.loadSettings(selectedWorkspaceId);
		if (!workspaceCtx.settingsReady) {
			workspaceSettingsError = m.compose_load_workspace_settings_failed();
		}
	}

	async function applyInitialComposerContext(
		dateParam: string | null,
		timeParam: string | null,
		workspaceParam: string | null,
		accountParams: string[]
	) {
		if (!dateParam && !timeParam && !workspaceParam && accountParams.length === 0) {
			appliedInitialContextKey = '';
			return;
		}

		const contextKey = `${dateParam ?? ''}|${timeParam ?? ''}|${workspaceParam ?? ''}|${accountParams.join(',')}`;
		if (contextKey === appliedInitialContextKey) return;
		appliedInitialContextKey = contextKey;

		const nextWorkspaceId =
			workspaceParam && workspaces.some((workspace) => workspace.id === workspaceParam)
				? workspaceParam
				: '';
		if (
			nextWorkspaceId &&
			(nextWorkspaceId !== selectedWorkspaceId ||
				workspaceCtx.currentWorkspace?.id !== nextWorkspaceId ||
				!workspaceCtx.settingsReady)
		) {
			try {
				await ensureComposerWorkspace(nextWorkspaceId);
			} catch (cause) {
				appliedInitialContextKey = '';
				workspaceLoadError =
					cause instanceof Error ? cause.message : m.compose_load_workspace_settings_failed();
				return;
			}
			if (nextWorkspaceId !== selectedWorkspaceId) {
				pasteMediaUploadQueue.reset();
				selectedWorkspaceId = nextWorkspaceId;
				variants = new Map();
				activeVariantAccountId = null;
				await loadAccounts(
					nextWorkspaceId,
					accountParams.length ? accountParams : undefined,
					accountParams.length > 0
				);
			} else if (accountsWorkspaceId !== nextWorkspaceId) {
				await loadAccounts(
					nextWorkspaceId,
					accountParams.length ? accountParams : undefined,
					accountParams.length > 0
				);
			}
		} else if (accountParams.length > 0 && selectedWorkspaceId) {
			await loadAccounts(selectedWorkspaceId, accountParams, true);
		}

		applyInitialScheduleDate(dateParam, timeParam);
	}

	function repurposePrivateContext(handoff: RepurposeHandoff): string {
		const evidence = (handoff.evidence ?? []).map((item) => {
			const metric = item.metric.replaceAll('_', ' ');
			const period =
				item.metadata.period_start && item.metadata.period_end
					? `, period ${item.metadata.period_start}–${item.metadata.period_end}`
					: '';
			return `${metric}: ${item.value} ${item.metadata.unit} (${item.scope}, ${item.metadata.aggregation}, source ${item.metadata.source || handoff.provenance.platform}, collected ${item.collected_at}${period})`;
		});
		return [
			m.compose_ai_repurpose_private_provenance({
				origin: handoff.provenance.origin,
				platform: handoff.provenance.platform,
				date: handoff.provenance.published_at
			}),
			m.compose_ai_repurpose_private_evidence(),
			...(evidence.length ? evidence : [m.compose_ai_repurpose_no_evidence()])
		].join('\n');
	}

	async function applyRepurposeHandoff(handoff: RepurposeHandoff) {
		appliedRepurposeHandoffID = handoff.handoff_id;
		try {
			await applyInitialComposerContext(
				null,
				null,
				handoff.workspace_id,
				handoff.destination_account_ids ?? []
			);
			if (selectedWorkspaceId !== handoff.workspace_id) {
				throw new Error(m.analytics_repurpose_failed());
			}
			const content = handoff.source_text.trim();
			posts = [{ ...makeEmptyPost(), content }];
			activePostIndex = 0;
			linkUrl = firstComposerURL(content);
			variants = new Map();
			activeVariantAccountId = null;
			repurposePrivateContextNotes = repurposePrivateContext(handoff);
			aiContextNotes = '';
			aiContextURLs = '';
			aiContextMayPublish = false;
			aiObjective = m.compose_ai_repurpose_objective();
			aiGenerationIdea = content;
			aiAngles = [
				{
					id: `repurpose-${handoff.handoff_id}`,
					label: m.compose_ai_repurpose_direction(),
					hook: handoff.title || content.slice(0, 160),
					thesis: m.compose_ai_repurpose_thesis(),
					approach: m.compose_ai_repurpose_approach(),
					objective: m.compose_ai_repurpose_objective(),
					desired_reaction: m.compose_ai_repurpose_reaction(),
					evidence: '',
					media: { treatment: 'none', role: 'none', brief: '' },
					build_direction: { outcome: m.compose_ai_repurpose_objective() }
				}
			];
			aiSelectedAngleID = aiAngles[0].id;
			aiWorkspaceEntry = 'build';
			aiWorkspaceStep = 'angles';
			repurposeReviewActive = true;
			aiWorkspaceOpen = true;
			ui.consumeRepurposeHandoff(handoff.handoff_id);
		} catch (cause) {
			ui.consumeRepurposeHandoff(handoff.handoff_id);
			error = cause instanceof Error ? cause.message : m.analytics_repurpose_failed();
		}
	}
	function sanitizeSelectedAccounts(validAccounts: SocialAccount[]) {
		const validIds = new Set(validAccounts.map((account) => account.id));
		const nextSelectedIds = selectedAccountIds.filter((id) => validIds.has(id));
		const nextSelectedIdSet = new Set(nextSelectedIds);
		if (!arraysEqual(nextSelectedIds, selectedAccountIds)) {
			selectedAccountIds = nextSelectedIds;
		}

		const nextVariants = new SvelteMap<string, Record<string, VariantPost>>();
		for (const [accountID, value] of variants.entries()) {
			if (validIds.has(accountID)) {
				nextVariants.set(accountID, value);
			}
		}
		if (nextVariants.size !== variants.size) {
			variants = nextVariants;
			activeVariantAccountId = editorAccountIdAfterVariantLoad(
				activeVariantAccountId,
				selectedAccountIds,
				nextVariants.keys()
			);
		}

		if (
			activeVariantAccountId &&
			(!nextSelectedIdSet.has(activeVariantAccountId) || !nextVariants.has(activeVariantAccountId))
		) {
			activeVariantAccountId = null;
		}

		pasteMediaUploadQueue.discardWhere((upload) => {
			const accountId = upload.target.variantAccountId;
			return (
				accountId !== null && (!nextSelectedIdSet.has(accountId) || !nextVariants.has(accountId))
			);
		});
	}

	function getScheduledAt(): string | undefined {
		if (!selectedDate || !selectedTime) return undefined;
		return workspaceScheduleToISO(selectedDate, selectedTime, scheduleTimezoneLabel);
	}

	function getSaveSnapshot(): string {
		const variantEntries = Array.from(variants.entries())
			.sort(([a], [b]) => a.localeCompare(b))
			.map(([accountId, values]) => [
				accountId,
				Object.fromEntries(Object.entries(values).sort(([a], [b]) => a.localeCompare(b)))
			]);
		const selectedAccountsSnapshot = [...selectedAccountIds].sort();
		return JSON.stringify({
			draft: getDraftSnapshot(posts),
			selectedAccounts: selectedAccountsSnapshot,
			selectedSocialSetId,
			requestedOutputProfiles,
			formatLockedByAccount,
			scheduleOverridesByAccount,
			variants: variantEntries,
			mediaAltTexts: Array.from(mediaAltTexts.entries()),
			linkUrl,
			settingsByAccount,
			segmentSettingsByPost,
			mediaSettingsByAccount,
			aiAppliedStrategies,
			aiAttachmentRequirements,
			scheduledDate: selectedDate?.toString() ?? null,
			selectedTime,
			randomDelayOverride,
			repostOverride,
			selectedWorkspaceId
		});
	}
	function settingsForAccount(account: SocialAccount): ComposerSettings {
		const defaults: ComposerSettings = supportsTextCards(getPlatformKey(account.platform))
			? { text_card: 'text_only' }
			: {};
		return normalizeSettings(
			account,
			{ ...defaults, ...settingsByAccount[account.id] },
			'destination'
		);
	}

	function segmentSettingsForAccount(account: SocialAccount): ComposerSettings {
		const post = activePost;
		if (!post) return {};
		return normalizeSettings(
			account,
			segmentSettingsByPost[post.key]?.[account.id] ?? {},
			'segment'
		);
	}

	function parseComposerSettingValue(value: ProviderSettingValue): ComposerSettingValue {
		if (value === null) return null;
		if (String(value) === value) return String(value);
		if (Number.isFinite(value)) return Number(value);
		if (Boolean(value) === value) return Boolean(value);
		if (Array.isArray(value)) {
			if (value.every((item) => String(item) === item)) return value.map(String);
			if (value.every(Number.isFinite)) return value.map(Number);
			if (value.every((item) => Boolean(item) === item)) return value.map(Boolean);
		}
		return '';
	}

	function parseComposerSettingsRecord(values: ProviderSettings): ComposerSettings {
		return Object.fromEntries(
			Object.entries(values).map(([key, value]) => [key, parseComposerSettingValue(value)])
		);
	}

	function normalizeSettings(
		account: SocialAccount,
		current: ComposerSettings,
		scope: 'destination' | 'segment'
	): ComposerSettings {
		const next = { ...current };
		for (const field of visibleSettings(account)) {
			if (field.scope !== scope || next[field.key] !== undefined) continue;
			if (field.default !== undefined) next[field.key] = parseComposerSettingValue(field.default);
			else if (field.control === 'optional_boolean') continue;
			else if (field.type === 'boolean') next[field.key] = false;
			else next[field.key] = '';
		}
		return next;
	}

	function dialogSettingsForAccount(account: SocialAccount): ComposerSettings {
		const values = {
			...settingsForAccount(account),
			...segmentSettingsForAccount(account)
		};
		if (
			getPlatformKey(account.platform) === 'youtube' &&
			(String(values.description) !== values.description || !String(values.description).trim())
		) {
			values.description = posts[0]
				? (getVariantContent(account.id, posts[0].key) ?? posts[0].content)
				: '';
		}
		return values;
	}

	function visibleSettings(account: SocialAccount, post = activePost): SettingDefinition[] {
		const resolved = resolvedCapabilities[account.id];
		return composerDestinationSettings(
			getPlatformKey(account.platform),
			resolved?.output_profile ? (resolved.settings ?? []) : undefined,
			capabilities,
			requestedOutputProfiles[account.id] || resolved?.output_profile || ''
		).filter((field) => {
			if (
				['url', 'link_url', 'link_title', 'link_description'].includes(field.key) &&
				!(
					(post &&
						linkURL(
							post.link,
							account.id,
							getVariantContent(account.id, post.key) ?? post.content,
							{ ...settingsByAccount[account.id], ...segmentSettingsByPost[post.key]?.[account.id] }
						)) ||
					linkUrl.trim()
				) &&
				!field.required
			) {
				return false;
			}
			return true;
		});
	}

	function mediaForSettingsDialog(): Array<{ id: string; label: string; mimeType: string }> {
		const mediaIDs = activePost
			? settingsAccount
				? (getVariantMediaIds(settingsAccount.id, activePost.key) ?? activePost.mediaIds)
				: getEditorMediaIdsForPost(activePost)
			: [];
		return mediaIDs.map((id, index) => ({
			id,
			label: `${m.compose_uploaded_media()} ${index + 1}`,
			mimeType: mediaMimeTypes.get(id) ?? 'application/octet-stream'
		}));
	}

	function mediaSettingsForDialog(account: SocialAccount): Record<string, ComposerSettings> {
		return Object.fromEntries(
			settingsDialogMedia.map((item) => [
				item.id,
				{ ...(mediaSettingsByAccount[item.id]?.[account.id] ?? {}) }
			])
		);
	}

	function pollProjection(post: PostItem, account: SocialAccount) {
		return resolvePollPreview(
			post.poll,
			account.id,
			visibleSettings(account),
			destinationText(post, account),
			segmentSettingsByPost[post.key]?.[account.id] ?? {}
		);
	}

	function updateSharedPoll(post: PostItem, poll: SharedPoll | undefined) {
		if (poll && !post.poll) {
			poll = {
				...poll,
				destinations: {
					...poll.destinations,
					...Object.fromEntries(
						selectedAccounts
							.filter((account) =>
								Boolean(segmentSettingsByPost[post.key]?.[account.id]?.poll_options)
							)
							.map((account) => [account.id, { mode: 'legacy' as const }])
					)
				}
			};
		}
		posts = posts.map((item) => (item.key === post.key ? { ...item, poll } : item));
		if (!poll && post.poll) {
			segmentSettingsByPost = {
				...segmentSettingsByPost,
				[post.key]: Object.fromEntries(
					Object.entries(segmentSettingsByPost[post.key] ?? {}).map(([id, settings]) => [
						id,
						post.poll?.destinations[id]?.mode === 'legacy' ? settings : clearPollSettings(settings)
					])
				)
			};
		}
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function sharedPollError(post: PostItem, account: SocialAccount): string {
		const poll = post.poll;
		if (!poll) return '';
		const choice = poll.destinations[account.id];
		if (!choice) return m.compose_poll_decision();
		if (choice.mode === 'omit' || choice.mode === 'legacy') return '';
		const content = choice.mode === 'custom' ? choice.poll : poll;
		if (!content?.question.trim()) return m.compose_poll_question_required();
		const missing = content.options.findIndex((option) => !option.text.trim());
		if (missing >= 0) return m.compose_poll_option_required({ number: missing + 1 });
		if (content.options.length < 2) return m.compose_poll_minimum({ count: 2 });
		if (
			choice.mode !== 'text' &&
			posts.length > 1 &&
			resolvedCapabilities[account.id]?.segment_strategy === 'join'
		)
			return m.compose_poll_join_conflict();
		if (choice.mode === 'text') return '';
		const fields = visibleSettings(account);
		if (!supportsNativePoll(fields)) return m.compose_poll_unavailable();
		const definition = fields.find((field) => field.key === 'poll_options')!;
		if ((getVariantMediaIds(account.id, post.key) ?? post.mediaIds).length)
			return m.compose_poll_media_conflict();
		if (content.options.length > (definition.constraints?.max_items ?? 4))
			return m.compose_poll_maximum({ count: definition.constraints?.max_items ?? 4 });
		const maxLength = definition.constraints?.max_length;
		if (maxLength && content.options.some((option) => [...option.text.trim()].length > maxLength))
			return m.compose_poll_limit({ count: maxLength });
		if (
			(content.multiple && !fields.some((field) => field.key === 'poll_multiple')) ||
			(content.hide_totals && !fields.some((field) => field.key === 'poll_hide_totals'))
		)
			return m.compose_poll_feature_unsupported();
		if (
			fields.some((field) => field.key === 'poll_duration') &&
			![86400, 259200, 604800, 1209600].includes(content.duration_seconds)
		)
			return m.compose_poll_duration_invalid();
		return '';
	}

	function authoredPreviewForAccount(account: SocialAccount) {
		const joined =
			resolvedCapabilities[account.id]?.segment_strategy === 'join' && posts.length > 1;
		const segments = posts.map((post) => {
			const mediaIds = getVariantMediaIds(account.id, post.key) ?? post.mediaIds;
			const projection = joined
				? {
						body: destinationText(post, account),
						settings: segmentSettingsByPost[post.key]?.[account.id] ?? {}
					}
				: pollProjection(post, account);
			return {
				id: post.key,
				text: projection.body,
				settings: resolveLinkPreview(
					post.link,
					account.id,
					getPlatformKey(account.platform),
					getVariantContent(account.id, post.key) ?? post.content,
					{ ...settingsForAccount(account), ...projection.settings },
					mediaIds.length
				),
				url: previewLinkURL(post, account),
				media: mediaIds.map((id) => ({
					id,
					mimeType: mediaMimeTypes.get(id),
					altText: mediaAltTextForAccount(id, account.id),
					...mediaPreviewMetadata.get(id),
					settings: mediaSettingsByAccount[id]?.[account.id]
				}))
			};
		});
		if (joined) {
			let projection = {
				body: segments
					.map((segment) => segment.text.trim())
					.filter(Boolean)
					.join('\n\n'),
				settings: segments[0].settings
			};
			for (const post of posts) {
				if (
					post.poll?.destinations[account.id]?.mode === 'text' ||
					post.poll?.destinations[account.id]?.mode === 'omit'
				) {
					projection = resolvePollPreview(
						post.poll,
						account.id,
						visibleSettings(account),
						projection.body,
						projection.settings
					);
				}
			}
			const seenMediaIds = new SvelteSet<string>();
			const joinedMedia = segments
				.flatMap((segment) => segment.media)
				.filter((item) => {
					if (seenMediaIds.has(item.id)) return false;
					seenMediaIds.add(item.id);
					return true;
				});
			segments.splice(0, segments.length, {
				...segments[0],
				text: projection.body,
				media: joinedMedia,
				url: joinedPreviewLinkURL(account),
				settings: resolveLinkPreview(
					posts[0].link,
					account.id,
					getPlatformKey(account.platform),
					authoredJoinedBody(account),
					{ ...settingsForAccount(account), ...projection.settings },
					segments.reduce((count, segment) => count + segment.media.length, 0)
				)
			});
		}
		const destinationSettings = destinationSettingsForAccount(account);
		return buildComposerPreview({
			account,
			mode: textComposerMode,
			outputProfile:
				requestedOutputProfiles[account.id] ?? resolvedCapabilities[account.id]?.output_profile,
			segments,
			destinationSettings,
			title: nativePreviewTitle(account),
			linkUrl: segments[0]?.url ?? ''
		});
	}

	function cardRequestForAccount(account: SocialAccount) {
		return textCardRequest(
			account.id,
			authoredPreviewForAccount(account),
			settingsForAccount(account),
			requestedOutputProfiles[account.id] || resolvedCapabilities[account.id]?.output_profile || ''
		);
	}

	// Catalogue text-card defaults for one account, resolved once from the
	// account's resolved capability (falling back to the capability catalogue
	// while it is still resolving) and merged into settings before the request
	// key is computed, so omitted styling follows the catalogue.
	function textCardDefaultsForAccount(account: SocialAccount): ComposerSettings {
		return textCardDefaultsFrom(resolvedCapabilities[account.id] ?? visibleSettings(account));
	}

	// Rebuild the stored text-card previews with the catalogue defaults the
	// current capabilities resolve to, so omitted styling keys from API-created
	// publications still match the preview request key.
	function refreshSavedTextCardPreviews(): void {
		const previews: Record<string, TextCardResult> = {};
		for (const rendition of savedCardRenditions ?? []) {
			const account = selectedAccounts.find(
				(candidate) => candidate.id === rendition.social_account_id
			);
			const defaults = account
				? textCardDefaultsForAccount(account)
				: textCardDefaultsFrom(capabilities.flatMap((capability) => capability.settings ?? []));
			Object.assign(previews, savedTextCardPreviews([rendition], textCardIdentities, defaults));
		}
		savedCardPreviews = previews;
	}

	function previewForAccount(account: SocialAccount) {
		const model = authoredPreviewForAccount(account);
		const requestKey = textCardRequestKey(
			cardRequestForAccount(account),
			textCardIdentityForAccount(account),
			textCardDefaultsForAccount(account)
		);
		const saved = savedCardPreviews[account.id];
		const result = saved?.key === requestKey ? saved : textCardResults.get(account.id);
		return result?.key === requestKey ? withTextCardImages(model, result.images) : model;
	}

	const textCardAccounts = $derived(
		selectedAccounts.filter((account) => cardRequestForAccount(account))
	);

	function openAccountPreview(account: SocialAccount) {
		previewSessions.get(account.id)?.close();
		const session = openPreviewWindow(account.id, previewForAccount(account));
		if (!session) {
			error = m.preview_open_failed();
			return;
		}
		previewSessions.set(account.id, session);
	}

	$effect(() => {
		for (const [accountId, session] of previewSessions) {
			const account = accounts.find((candidate) => candidate.id === accountId);
			if (!account || !selectedAccountIds.includes(accountId)) {
				session.close();
				previewSessions.delete(accountId);
				continue;
			}
			session.update(previewForAccount(account));
		}
	});

	function updateAccountSetting(account: SocialAccount, key: string, value: ProviderSettingValue) {
		const definition = visibleSettings(account).find((field) => field.key === key);
		if (key === 'url' || key === 'link_url') {
			const uri = String(value ?? '').trim();
			posts = posts.map((post) => {
				if (definition?.scope === 'segment' && post.key !== activePost?.key) return post;
				const link = post.link ?? initialLinkDraft(post);
				return {
					...post,
					link: {
						...link,
						destinations: {
							...link.destinations,
							[account.id]: uri ? { mode: 'custom', url: uri } : { mode: 'post' }
						}
					}
				};
			});
		}
		if (definition?.scope === 'segment') {
			const post = activePost;
			if (!post) return;
			const invalidated = invalidateDependentDestinationSettings(
				visibleSettings(account).filter((field) => field.scope === 'segment'),
				segmentSettingsByPost[post.key]?.[account.id] ?? {},
				key,
				value
			);
			segmentSettingsByPost = {
				...segmentSettingsByPost,
				[post.key]: {
					...(segmentSettingsByPost[post.key] ?? {}),
					[account.id]: parseComposerSettingsRecord(invalidated.values ?? {})
				}
			};
		} else {
			const invalidated = invalidateDependentDestinationSettings(
				visibleSettings(account).filter((field) => field.scope === 'destination'),
				settingsForAccount(account),
				key,
				value
			);
			settingsByAccount = {
				...settingsByAccount,
				[account.id]: parseComposerSettingsRecord(invalidated.values ?? {})
			};
			if (invalidated.optionSources.length > 0) {
				const invalidSources = new Set(invalidated.optionSources);
				destinationOptionsByAccount = {
					...destinationOptionsByAccount,
					[account.id]: Object.fromEntries(
						Object.entries(destinationOptionsByAccount[account.id] ?? {}).filter(
							([source]) => !invalidSources.has(source)
						)
					)
				};
				destinationOptionCursorsByAccount = {
					...destinationOptionCursorsByAccount,
					[account.id]: Object.fromEntries(
						Object.entries(destinationOptionCursorsByAccount[account.id] ?? {}).filter(
							([source]) => !invalidSources.has(source)
						)
					)
				};
				for (const source of invalidated.optionSources) {
					void loadDestinationOptions(account, true, source);
				}
			}
		}
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function updateMediaAccountSetting(
		account: SocialAccount,
		mediaID: string,
		key: string,
		value: ProviderSettingValue
	) {
		for (let index = 0; index < posts.length; index++) {
			const ids = getVariantMediaIds(account.id, posts[index].key) ?? posts[index].mediaIds;
			if (ids.includes(mediaID)) setVariantMediaIds(account.id, index, [...ids]);
		}
		mediaSettingsByAccount = {
			...mediaSettingsByAccount,
			[mediaID]: {
				...(mediaSettingsByAccount[mediaID] ?? {}),
				[account.id]: {
					...(mediaSettingsByAccount[mediaID]?.[account.id] ?? {}),
					[key]: parseComposerSettingValue(value)
				}
			}
		};
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	async function uploadDestinationSettingFile(
		setting: SettingDefinition,
		file: File,
		metadata?: { sourceMediaId: string; timestampMs: number }
	) {
		const account = settingsAccount;
		if (!account || !selectedWorkspaceId) {
			throw new Error(m.compose_please_select_workspace());
		}
		const uploaded = await uploadMediaFile({
			workspaceId: selectedWorkspaceId,
			file,
			parentMediaId: metadata?.sourceMediaId ?? ''
		});
		updateAccountSetting(account, setting.key, uploaded.id);
	}

	function configuredPollError(): string {
		for (const account of selectedAccounts) {
			const issue = configuredPollErrorForAccount(account);
			if (issue) return issue;
		}
		return '';
	}

	function configuredPollErrorForAccount(account: SocialAccount): string {
		for (const post of posts) {
			const sharedError = sharedPollError(post, account);
			if (sharedError) return sharedError;
			if (post.poll && post.poll.destinations[account.id]?.mode !== 'legacy') continue;
			const definition = visibleSettings(account).find(
				(setting) => setting.key === 'poll_options' && setting.scope === 'segment'
			);
			if (!definition) continue;
			const raw = segmentSettingsByPost[post.key]?.[account.id]?.poll_options;
			if (String(raw) !== raw || raw === '') continue;
			const options = String(raw).split('\n');
			const minimum = Math.max(2, definition.constraints?.min_items ?? 2);
			if (options.length < minimum) return m.compose_poll_minimum({ count: minimum });
			const emptyIndex = options.findIndex((option) => option.trim() === '');
			if (emptyIndex >= 0) {
				return m.compose_poll_option_required({ number: emptyIndex + 1 });
			}
			const maximum = Math.max(minimum, definition.constraints?.max_items ?? 4);
			if (options.length > maximum) return m.compose_poll_maximum({ count: maximum });
		}
		return '';
	}

	function pasteMediaUploadBlocker(): string {
		if (pasteMediaUploads.length === 0) return '';
		const failedUpload = firstFailedPasteMediaUpload(pasteMediaUploads);
		return (
			failedUpload?.error || m.media_uploaded_progress({ done: 0, total: pasteMediaUploads.length })
		);
	}

	function pasteMediaUploadIssue(): string {
		const failedUpload = firstFailedPasteMediaUpload(pasteMediaUploads);
		return failedUpload?.error || (failedUpload ? m.compose_upload_failed() : '');
	}

	function globalFormBlockers(): string[] {
		const blockers: string[] = [];
		if (!selectedWorkspaceId) blockers.push(m.compose_choose_workspace_blocker());
		if (selectedAccountIds.length === 0) blockers.push(m.compose_choose_account_blocker());
		if (!hasContent) blockers.push(m.compose_please_enter_content());
		if (
			isThread &&
			posts.filter((post) => post.content.trim() || post.mediaIds.length > 0 || post.poll).length <
				2
		) {
			blockers.push(m.compose_thread_minimum());
		}
		const pasteUploadIssue = pasteMediaUploadIssue();
		if (pasteUploadIssue) blockers.push(pasteUploadIssue);
		if (capabilityResolveError) blockers.push(capabilityResolveError);
		if (fittingImageId) blockers.push(m.compose_image_preparing());
		return uniqueIssueMessages(blockers);
	}

	function accountBlockers(
		account: SocialAccount,
		includeShared = true,
		includeServerValidation = true
	): string[] {
		const provider = getPlatformKey(account.platform);
		return uniqueIssueMessages([
			...(resolvedCapabilities[account.id]?.issues ?? [])
				.filter(
					(issue) => issue.severity === 'error' && (includeShared || isAccountSpecificIssue(issue))
				)
				.map((issue) => issue.message),
			...(includeServerValidation
				? validationIssues
						.filter(
							(issue) =>
								issue.severity === 'error' &&
								(includeShared || isAccountSpecificIssue(issue)) &&
								issueMatchesProvider(issue, provider)
						)
						.map((issue) => issue.message)
				: []),
			configuredPollErrorForAccount(account)
		]);
	}

	function accountReadiness(
		account: SocialAccount,
		operation: Extract<ProviderReadinessOperation, 'publish_immediate' | 'publish_scheduled'>
	): ProviderReadinessPresentation {
		const resolved = resolvedCapabilities[account.id];
		const decision =
			operation === 'publish_immediate'
				? resolved?.immediate_readiness
				: resolved?.scheduled_readiness;
		return presentProviderReadiness(decision, operation);
	}

	function readinessReason(
		account: SocialAccount,
		presentation: ProviderReadinessPresentation
	): string {
		return readinessStateMessage(presentation.state, getPlatformName(account.platform));
	}

	function accountReadinessMessages(account: SocialAccount): string[] {
		if (!capabilityReadinessKnown) return [];
		const immediate = accountReadiness(account, 'publish_immediate');
		const scheduled = accountReadiness(account, 'publish_scheduled');
		return uniqueIssueMessages([
			...(immediate.quiet
				? []
				: [m.compose_publish_now_readiness({ reason: readinessReason(account, immediate) })]),
			...(scheduled.quiet
				? []
				: [m.compose_schedule_readiness({ reason: readinessReason(account, scheduled) })])
		]);
	}

	function operationReadinessBlocker(
		operation: Extract<ProviderReadinessOperation, 'publish_immediate' | 'publish_scheduled'>
	): string {
		if (!capabilityReadinessKnown) return m.compose_load_readiness_failed();
		for (const account of selectedAccounts) {
			const presentation = accountReadiness(account, operation);
			if (presentation.canProceed) continue;
			const reason = readinessReason(account, presentation);
			return operation === 'publish_immediate'
				? m.compose_publish_now_readiness({ reason })
				: m.compose_schedule_readiness({ reason });
		}
		return '';
	}

	function accountIssueMessages(account: SocialAccount): string[] {
		const provider = getPlatformKey(account.platform);
		const sourcePosts = isThread ? posts : activePost ? [activePost] : [];
		// The server validates generated cards with the complete delivery media.
		const mediaWarnings = cardRequestForAccount(account)
			? []
			: sourcePosts.flatMap((post) => {
					const mediaIds = getVariantMediaIds(account.id, post.key) ?? post.mediaIds;
					return providerMediaWarningMessages(
						provider,
						mediaCapabilityItemsFromIds(mediaIds, mediaMimeTypes, mediaSizes)
					);
				});
		return uniqueIssueMessages([
			...accountBlockers(account, false),
			...accountReadinessMessages(account),
			...(resolvedCapabilities[account.id]?.issues ?? [])
				.filter((issue) => isAccountSpecificIssue(issue) && isActionableAccountIssue(issue))
				.map((issue) => issue.message),
			...validationIssues
				.filter(
					(issue) =>
						isActionableAccountIssue(issue) &&
						isAccountSpecificIssue(issue) &&
						issueMatchesProvider(issue, provider)
				)
				.map((issue) => issue.message),
			...mediaWarnings
		]);
	}

	function composerIssuePostIndex(issue: ComposerIssue): number {
		for (const identifier of [issue.scopeId, issue.segmentId]) {
			if (!identifier) continue;
			const directIndex = posts.findIndex((post) => post.key === identifier);
			if (directIndex >= 0) return directIndex;
			const legacyIndex = Number(identifier.match(/:(\d+)$/)?.[1] ?? Number.NaN);
			if (Number.isInteger(legacyIndex) && legacyIndex >= 0 && legacyIndex < posts.length) {
				return legacyIndex;
			}
		}
		if (issue.mediaId) {
			return posts.findIndex((post) => {
				if (post.mediaIds.includes(issue.mediaId!)) return true;
				return issue.accountId
					? (getVariantMediaIds(issue.accountId, post.key) ?? []).includes(issue.mediaId!)
					: false;
			});
		}
		return -1;
	}

	async function focusComposerIssue(issue: ComposerIssue) {
		if (issue.mediaId) previewMediaOpen = true;

		const postIndex = composerIssuePostIndex(issue);
		if (postIndex >= 0) activePostIndex = postIndex;

		const account = issue.accountId
			? selectedAccounts.find((candidate) => candidate.id === issue.accountId)
			: null;
		const destinationSetting =
			account && issue.field
				? visibleSettings(account).find((setting) => setting.key === issue.field)
				: null;
		const targetsTextField = ['body', 'description', 'source_text', 'text'].includes(
			issue.field ?? ''
		);
		if (account && destinationSetting) {
			activeVariantAccountId = account.id;
			openDestinationSettings(account);
		} else if (account && targetsTextField && postIndex >= 0) {
			activeVariantAccountId = variants.has(account.id) ? account.id : null;
		} else if (account) {
			activeVariantAccountId = account.id;
		}

		await tick();
		let target: HTMLElement | null = null;
		if (destinationSetting) {
			target = document.getElementById(`destination-setting-${destinationSetting.key}`);
		} else if (issue.mediaId) {
			target = document.querySelector<HTMLElement>(
				`${previewMediaOpen && activeVariantAccountId ? '[data-testid="composer-media-editor"] ' : ''}[data-composer-media-id="${CSS.escape(issue.mediaId)}"]`
			);
		} else if (postIndex >= 0) {
			target = document.getElementById(`post-textarea-${postIndex}`);
		} else if (account) {
			target = document.getElementById(`composer-destination-${account.id}`);
		}
		target?.scrollIntoView({
			block: 'center',
			behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
		});
		target?.focus({ preventScroll: true });
	}

	function firstValidationIssue(): ComposerIssue | null {
		return (
			composerIssues([], validationIssues, validationDestinations).find(
				(candidate) => candidate.severity === 'error'
			) ?? null
		);
	}

	async function refreshPublicationValidation(
		publicationID: string
	): Promise<ComposerIssue | null> {
		try {
			validationIssues = await (await sessionFor(selectedWorkspaceId, publicationID)).validate();
		} catch {
			return null;
		}
		return firstValidationIssue();
	}

	function publicationMedia(mediaIDs: string[]): PublicationMediaInput[] {
		return mediaIDs.map((id) => ({
			id,
			mimeType: mediaMimeTypes.get(id) ?? 'application/octet-stream',
			altText: mediaAltTexts.get(id),
			settingsByAccount: Object.fromEntries(
				selectedAccounts.map((account) => [
					account.id,
					{ ...(mediaSettingsByAccount[id]?.[account.id] ?? {}) }
				])
			)
		}));
	}

	function publicationPayload(targetPublicationID: string): ComposerPublicationPayload {
		const payload = buildPublicationPayload({
			mode: textComposerMode,
			workspaceId: selectedWorkspaceId,
			accounts: selectedAccounts.map((account) => ({
				id: account.id,
				platform: account.platform,
				account_username: account.account_username
			})),
			fields: {
				postText: posts[0]?.content ?? '',
				linkUrl
			},
			media: publicationMedia(posts[0]?.mediaIds ?? []),
			segments: posts.map((post, index) => ({
				id: `legacy-segment:${targetPublicationID}:${index}`,
				content: post.content,
				mentions: post.mentions,
				poll: post.poll,
				link: post.link,
				url: index === 0 ? linkUrl : '',
				media: publicationMedia(post.mediaIds),
				settingsByAccount: segmentSettingsByPost[post.key] ?? {}
			})),
			scheduledAt: getScheduledAt(),
			settingsByAccount: Object.fromEntries(
				selectedAccounts.map((account) => [account.id, settingsForAccount(account)])
			),
			socialSetId: selectedSocialSetId,
			requestedOutputProfiles,
			formatLockedByAccount,
			scheduleOverridesByAccount,
			resolvedByAccount: Object.fromEntries(
				Object.entries(resolvedCapabilities).map(([accountID, capability]) => [
					accountID,
					{
						profile: capability.profile,
						outputProfile: capability.output_profile,
						segmentStrategy: capability.segment_strategy,
						revision: capability.capability_revision,
						compatible: capability.compatible
					} satisfies ResolvedComposerTarget
				])
			)
		});

		for (const rendition of payload.renditions) {
			const source = variants.get(rendition.social_account_id);
			if (!source) continue;
			rendition.segments = rendition.segments.map((segment, index) => {
				const joinsSegments =
					index === 0 &&
					posts.length > 1 &&
					resolvedCapabilities[rendition.social_account_id]?.segment_strategy === 'join';
				if (
					index > 0 &&
					posts.length > 1 &&
					resolvedCapabilities[rendition.social_account_id]?.segment_strategy === 'join'
				)
					return segment;
				const sourcePosts = joinsSegments ? posts : posts[index] ? [posts[index]] : [];
				if (sourcePosts.length === 0) return segment;
				const sourceVariants = sourcePosts.map((post) => source[post.key]).filter(Boolean);
				if (sourceVariants.length === 0) return segment;
				const contentInherited = sourceVariants.every((variant) => variant.contentInherited);
				const mediaInherited = sourceVariants.every((variant) => variant.mediaInherited);
				const body = sourcePosts
					.map((post) => getVariantContent(rendition.social_account_id, post.key) ?? post.content)
					.map((value) => (joinsSegments ? value.trim() : value))
					.filter(Boolean)
					.join(joinsSegments ? '\n\n' : '');
				const mediaIds = sourcePosts.flatMap(
					(post) => getVariantMediaIds(rendition.social_account_id, post.key) ?? post.mediaIds
				);
				const media = publicationMedia(mediaIds).map((item) => {
					const accountSettings = item.settingsByAccount?.[rendition.social_account_id] ?? {};
					const altText =
						String(accountSettings.alt_text) === accountSettings.alt_text
							? String(accountSettings.alt_text).trim()
							: item.altText;
					const settings = { ...accountSettings };
					delete settings.alt_text;
					const mediaPayload: PublicationMediaPayload = {
						media_id: item.id,
						role: item.role || 'attachment'
					};
					if (altText !== undefined) mediaPayload.alt_text = altText;
					if (Object.keys(settings).length > 0) mediaPayload.settings = settings;
					return mediaPayload;
				});
				const renditionSegment: ComposerRenditionSegment = {
					...segment,
					body,
					media_inherited: mediaInherited,
					media: mediaInherited ? segment.media : media
				};
				if (joinsSegments) {
					renditionSegment.source_overrides = sourcePosts.map((post, sourceIndex) => {
						const variant = source[post.key];
						const sourceMedia = publicationMedia(
							getVariantMediaIds(rendition.social_account_id, post.key) ?? post.mediaIds
						);
						const override: NonNullable<ComposerRenditionSegment['source_overrides']>[number] = {
							publication_segment_id: payload.segments[sourceIndex].id,
							media_inherited: variant?.mediaInherited ?? true,
							media: sourceMedia.map(
								(item) =>
									media.find((candidate) => candidate.media_id === item.id) ?? {
										media_id: item.id,
										role: item.role || 'attachment'
									}
							)
						};
						if (variant && !variant.contentInherited) {
							override.body_override = variant.content;
							override.mentions = variant.mentions;
						}
						return override;
					});
				}
				if (!contentInherited) {
					renditionSegment.body_override = body;
					if (!joinsSegments && sourcePosts[0]) {
						const metadata = source[sourcePosts[0].key]?.mentions;
						renditionSegment.settings = { ...renditionSegment.settings };
						delete renditionSegment.settings.mentions;
						if (metadata) renditionSegment.settings.mentions = metadata;
					}
				}
				return renditionSegment;
			});
			const first = rendition.segments[0];
			if (first) {
				rendition.body = first.body;
				rendition.media = first.media.map(({ media_id, role }) => ({ media_id, role }));
			}
		}
		for (const rendition of payload.renditions) {
			const account = selectedAccounts.find((item) => item.id === rendition.social_account_id);
			if (!account || nativeDescriptionKey(account) !== 'description') continue;
			const explicit = parseComposerSettingOptionalString(
				settingsByAccount[account.id]?.description
			);
			const body = joinedDescriptionKey(account)
				? authoredJoinedBody(account)
				: posts[0]
					? (getVariantContent(account.id, posts[0].key) ?? posts[0].content)
					: '';
			const description = explicit || body;
			rendition.description = description;
			if (rendition.segments[0]) rendition.segments[0].description = description;
		}

		for (const rendition of payload.renditions) {
			const first = rendition.segments?.[0];
			if (!first) continue;
			const settings = { ...first.settings };
			delete settings.attachment_requirement;
			const requirement = aiAttachmentRequirements[rendition.social_account_id];
			if (requirement) settings.attachment_requirement = requirement;
			first.settings = settings;
		}
		if (aiAppliedStrategies.length > 0) {
			payload.metadata[AI_BUILD_METADATA_KEY] = {
				version: 1,
				strategies: aiAppliedStrategies
			};
		}
		return $state.snapshot(payload);
	}

	function hydrateCanonicalSettings(publication: Publication) {
		publicationId = publication.id;
		revision = publication.revision;
		reviewState = publication.review_state ?? '';
		repostOverride = publication.repost_override ?? { mode: 'inherit' };
		const builderMetadata = aiBuildMetadataSchema.safeParse(
			publication.metadata?.[AI_BUILD_METADATA_KEY]
		);
		aiAppliedStrategies = builderMetadata.success ? builderMetadata.data.strategies : [];
		aiAttachmentRequirements = Object.fromEntries(
			(publication.renditions ?? []).flatMap((rendition) => {
				const requirement = attachmentRequirementSchema.safeParse(
					rendition.segments?.[0]?.settings?.attachment_requirement
				);
				return requirement.success ? [[rendition.social_account_id, requirement.data]] : [];
			})
		);
		selectedSocialSetId = publication.social_set_id ?? '';
		requestedOutputProfiles = Object.fromEntries(
			(publication.renditions ?? [])
				.filter((rendition) => rendition.format_locked)
				.map((rendition) => [rendition.social_account_id, rendition.output_profile])
		);
		formatLockedByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => [
				rendition.social_account_id,
				Boolean(rendition.format_locked)
			])
		);
		scheduleOverridesByAccount = Object.fromEntries(
			(publication.renditions ?? [])
				.filter((rendition) => Boolean(rendition.schedule_override))
				.map((rendition) => [rendition.social_account_id, rendition.schedule_override!])
		);
		linkUrl = firstComposerURL(posts[0]?.content ?? '') || publication.source_url || '';
		settingsByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => {
				const settings = parseComposerSettingsRecord(rendition.settings ?? {});
				if (supportsTextCards(rendition.platform) && settings.text_card === undefined) {
					settings.text_card = 'off';
				}
				return [rendition.social_account_id, settings];
			})
		);
		const canonicalSegments = [...(publication.segments ?? [])].sort(
			(left, right) => left.position - right.position
		);
		const hydratedVariants = new SvelteMap(variants);
		for (const rendition of publication.renditions ?? []) {
			const record: Record<string, VariantPost> = {};
			let hasOverride = false;
			for (const [index, post] of posts.entries()) {
				const canonical = canonicalSegments[index];
				const renditionSegment = canonical
					? (rendition.segments ?? []).find(
							(segment) => segment.publication_segment_id === canonical.id
						)
					: undefined;
				const legacyJoined =
					posts.length > 1 &&
					rendition.segments?.length === 1 &&
					!rendition.segments[0].source_overrides?.length;
				const joinedSource = (rendition.segments ?? [])
					.flatMap((segment) => segment.source_overrides ?? [])
					.find((source) => source.publication_segment_id === canonical?.id);
				const suppressLegacyContinuation =
					legacyJoined && index > 0 && rendition.segments?.[0]?.body_override !== undefined;
				const contentInherited = suppressLegacyContinuation
					? false
					: joinedSource
						? joinedSource.body_override === undefined
						: renditionSegment?.body_override === undefined;
				const suppressLegacyMedia =
					legacyJoined && index > 0 && rendition.segments?.[0]?.media_inherited === false;
				const mediaInherited = suppressLegacyMedia
					? false
					: (joinedSource?.media_inherited ?? renditionSegment?.media_inherited ?? true);
				if (!contentInherited || !mediaInherited) hasOverride = true;
				record[post.key] = {
					content: suppressLegacyContinuation
						? ''
						: contentInherited
							? post.content
							: (joinedSource?.body_override ??
								renditionSegment?.body_override ??
								renditionSegment?.body ??
								''),
					mediaIds: suppressLegacyMedia
						? []
						: mediaInherited
							? [...post.mediaIds]
							: joinedSource
								? (joinedSource.media ?? []).map((item) => item.media_id)
								: (renditionSegment?.media ?? []).map((item) => item.id),
					mentions: contentInherited
						? post.mentions
						: readMentionMetadata(
								joinedSource?.body_override ??
									renditionSegment?.body_override ??
									renditionSegment?.body ??
									'',
								joinedSource?.mentions ?? renditionSegment?.settings?.mentions
							),
					contentInherited,
					mediaInherited
				};
			}
			if (hasOverride) hydratedVariants.set(rendition.social_account_id, record);
			else hydratedVariants.delete(rendition.social_account_id);
		}
		variants = normalizeVariantsMap(hydratedVariants, posts);
		const nextSegmentSettings: Record<string, Record<string, ComposerSettings>> = {};
		const nextMediaSettings: Record<string, Record<string, ComposerSettings>> = {};
		for (const rendition of publication.renditions ?? []) {
			const hydratedSegmentIDs = new SvelteSet<string>();
			const renditionSegments = [...(rendition.segments ?? [])].sort(
				(left, right) => left.position - right.position
			);
			for (const [index, segment] of renditionSegments.entries()) {
				const canonicalIndex = canonicalSegments.findIndex(
					(candidate) => candidate.id === segment.publication_segment_id
				);
				const post = posts[canonicalIndex >= 0 ? canonicalIndex : index];
				if (!post) continue;
				if (hydratedSegmentIDs.has(segment.publication_segment_id)) {
					if (segment.body.trim()) {
						nextSegmentSettings[post.key] = {
							...(nextSegmentSettings[post.key] ?? {}),
							[rendition.social_account_id]: {
								...(nextSegmentSettings[post.key]?.[rendition.social_account_id] ?? {}),
								first_comment: segment.body
							}
						};
					}
					continue;
				}
				hydratedSegmentIDs.add(segment.publication_segment_id);
				nextSegmentSettings[post.key] = {
					...(nextSegmentSettings[post.key] ?? {}),
					[rendition.social_account_id]: parseComposerSettingsRecord(segment.settings ?? {})
				};
				for (const media of segment.media ?? []) {
					const mediaSettings = parseComposerSettingsRecord(media.settings ?? {});
					if (
						posts.some((source) =>
							getVariantMediaIds(rendition.social_account_id, source.key)?.includes(media.id)
						) ||
						(media.alt_text ?? '') !== (mediaAltTexts.get(media.id) ?? '')
					) {
						mediaSettings.alt_text = media.alt_text ?? '';
					}
					if (media.thumbnail_timestamp_ms) {
						mediaSettings.thumbnail_timestamp_ms = media.thumbnail_timestamp_ms;
					}
					if (Object.keys(mediaSettings).length > 0) {
						nextMediaSettings[media.id] = {
							...(nextMediaSettings[media.id] ?? {}),
							[rendition.social_account_id]: mediaSettings
						};
					}
				}
			}
		}
		segmentSettingsByPost = nextSegmentSettings;
		mediaSettingsByAccount = nextMediaSettings;
	}

	function accountNeedsOwnSegmentCopy(accountID: string): boolean {
		if (
			posts.some((post) =>
				post.mentions?.spans.some((span) => span.target.provider === 'workspace')
			)
		)
			return true;
		return accountNeedsSegmentCopy(
			accountID,
			variants,
			aiAttachmentRequirements,
			posts.some((post) => post.poll),
			mediaSettingsByAccount
		);
	}

	function scheduleCapabilityResolve() {
		if (capabilityResolveTimer) clearTimeout(capabilityResolveTimer);
		// Let the in-flight resolve finish so its provider work can populate the
		// cache. The next request aborts it only once the debounce elapses.
		capabilityResolveTimer = setTimeout(() => {
			capabilityResolveTimer = null;
			void resolveCapabilities();
		}, 300);
	}

	async function resolveCapabilities() {
		if (capabilityResolveTimer) {
			clearTimeout(capabilityResolveTimer);
			capabilityResolveTimer = null;
		}
		const inputSnapshot = capabilityInputSnapshot;
		if (!selectedWorkspaceId || selectedAccountIds.length === 0) {
			capabilityResolveAbortController?.abort();
			capabilityResolveAbortController = null;
			capabilityResolveRequestSequence++;
			capabilityResolveLoading = false;
			resolvedCapabilities = {};
			validationIssues = [];
			capabilityResolveError = '';
			lastResolvedCapabilityInputSnapshot = inputSnapshot;
			lastResolvedCapabilityStructureSnapshot = capabilityStructureSnapshot;
			return;
		}
		capabilityResolveAbortController?.abort();
		const abortController = new AbortController();
		capabilityResolveAbortController = abortController;
		const requestSequence = ++capabilityResolveRequestSequence;
		capabilityResolveLoading = true;
		const [, region = 'US'] = getLocaleTag().split('-');
		try {
			const { data, error: resolveError } = await client.POST('/capabilities/resolve', {
				signal: abortController.signal,
				body: {
					account_ids: selectedAccountIds,
					creation_preset: textComposerMode,
					requested_output_profiles: Object.fromEntries(
						selectedAccountIds
							.filter((accountId) => Boolean(requestedOutputProfiles[accountId]))
							.map((accountId) => [accountId, requestedOutputProfiles[accountId]])
					),
					source_url: linkUrl,
					locale: getLocaleTag(),
					region,
					account_settings: Object.fromEntries(
						selectedAccounts.map((account) => [account.id, destinationSettingsForAccount(account)])
					),
					account_segments: Object.fromEntries(
						selectedAccounts
							.filter((account) => accountNeedsOwnSegmentCopy(account.id))
							.map((account) => [
								account.id,
								posts.map((post) => ({
									id: post.key,
									content: pollProjection(post, account).body,
									url: post === posts[0] ? linkUrl : '',
									settings:
										post === posts[0] && aiAttachmentRequirements[account.id]
											? { attachment_requirement: aiAttachmentRequirements[account.id] }
											: undefined,
									media: (getVariantMediaIds(account.id, post.key) ?? post.mediaIds).map(
										(mediaId) => ({
											media_id: mediaId,
											alt_text: mediaAltTextForAccount(mediaId, account.id)
										})
									)
								}))
							])
					),
					segments: posts.map((post) => ({
						id: post.key,
						content: post.content,
						url: post === posts[0] ? linkUrl : '',
						media: post.mediaIds.map((mediaID) => ({
							media_id: mediaID,
							alt_text: mediaAltTexts.get(mediaID) ?? ''
						}))
					}))
				}
			});
			if (resolveError) {
				throw new Error(resolveError.detail || m.compose_load_capabilities_failed());
			}
			if (
				!capabilityResponseApplies({
					requestSequence,
					currentRequestSequence: capabilityResolveRequestSequence,
					requestedSnapshot: inputSnapshot,
					currentSnapshot: capabilityInputSnapshot
				})
			)
				return;
			capabilityResolveError = '';
			const resolvedAccounts = data?.accounts ?? [];
			resolvedCapabilities = Object.fromEntries(
				resolvedAccounts.map((capability) => [capability.account_id, capability])
			);
			for (const capability of resolvedAccounts) {
				const dynamic = capability.dynamic_options ?? {};
				if (Object.keys(dynamic).length === 0) continue;
				destinationOptionsByAccount = {
					...destinationOptionsByAccount,
					[capability.account_id]: {
						...(destinationOptionsByAccount[capability.account_id] ?? {}),
						...Object.fromEntries(
							Object.entries(dynamic).map(([source, options]) => [
								source,
								(options ?? []).map((option) => ({
									value: option.value,
									label: option.label
								}))
							])
						)
					}
				};
			}
			validationIssues = resolvedAccounts.flatMap((capability) => capability.issues ?? []);
			lastResolvedCapabilityInputSnapshot = inputSnapshot;
			lastResolvedCapabilityStructureSnapshot = capabilityStructureSnapshot;
			refreshSavedTextCardPreviews();
			void loadRequiredDestinationOptions();
		} catch (resolveError) {
			if (abortController.signal.aborted) return;
			if (requestSequence !== capabilityResolveRequestSequence) return;
			capabilityResolveError =
				resolveError instanceof Error ? resolveError.message : m.compose_load_capabilities_failed();
		} finally {
			if (capabilityResolveAbortController === abortController) {
				capabilityResolveAbortController = null;
			}
			if (requestSequence === capabilityResolveRequestSequence) {
				capabilityResolveLoading = false;
			}
		}
	}

	async function resolveCapabilitiesCurrent(): Promise<boolean> {
		// Edits can land while a request is in flight. Resolve again so a submit
		// decision never relies on an answer for a superseded state.
		for (let attempt = 0; attempt < 3; attempt++) {
			await resolveCapabilities();
			if (
				capabilityResolutionIsFresh(
					lastResolvedCapabilityInputSnapshot,
					capabilityInputSnapshot,
					capabilityResolveError
				)
			) {
				return true;
			}
			if (capabilityResolveError) return false;
		}
		return false;
	}

	async function loadRequiredDestinationOptions() {
		const accountsWithSources = selectedAccounts
			.map((account) => ({
				account,
				sources: visibleSettings(account)
					.filter((setting) => setting.required && Boolean(setting.options_source))
					.map((setting) => setting.options_source!)
					.filter((source) => destinationOptionsByAccount[account.id]?.[source] === undefined)
			}))
			.filter(({ sources }) => sources.length > 0);
		// Accounts are independent, but a large composer should not open one
		// provider request per destination at once.
		const queue = [...accountsWithSources];
		const workers = Array.from({ length: Math.min(4, queue.length) }, async () => {
			for (;;) {
				const next = queue.shift();
				if (!next) return;
				for (const source of new Set(next.sources)) {
					await loadDestinationOptions(next.account, false, source);
				}
			}
		});
		await Promise.allSettled(workers);
	}

	function openDestinationSettings(account: SocialAccount) {
		settingsByAccount = {
			...settingsByAccount,
			[account.id]: settingsForAccount(account)
		};
		settingsAccountId = account.id;
		settingsDialogOpen = true;
		void loadDestinationOptions(account);
	}

	async function loadDestinationOptions(
		account: SocialAccount,
		force = false,
		onlySource = '',
		search = '',
		append = false
	) {
		let sources = loadableDestinationOptionSources(
			visibleSettings(account),
			onlySource,
			settingsForAccount(account)
		);
		const requestWorkspaceId = selectedWorkspaceId;
		if (!force && !search) {
			sources = sources.filter(
				(source) => destinationOptionsByAccount[account.id]?.[source] === undefined
			);
		}
		if (sources.length === 0) return;
		const requestSequences = new Map<string, number>();
		for (const source of sources) {
			const key = destinationOptionsSequenceKey(account.id, source);
			const sequence = (destinationOptionsRequestSequences.get(key) ?? 0) + 1;
			destinationOptionsRequestSequences.set(key, sequence);
			requestSequences.set(source, sequence);
		}
		markDestinationOptionsLoading(account.id, 1);
		destinationOptionsErrors = { ...destinationOptionsErrors, [account.id]: '' };
		const [, region = 'US'] = getLocaleTag().split('-');
		const accountSearches = destinationOptionSearchByAccount[account.id] ?? {};
		const effectiveSearch = onlySource && append ? (accountSearches[onlySource] ?? '') : search;
		if (onlySource && !append) {
			destinationOptionSearchByAccount = {
				...destinationOptionSearchByAccount,
				[account.id]: { ...accountSearches, [onlySource]: search }
			};
		}
		try {
			const results = await Promise.all(
				sources.map(async (source) => {
					const options = publishingOptionsQueryOptions(schedulingQueryAPI, selectedWorkspaceId, {
						accountId: account.id,
						source,
						region,
						locale: getLocaleTag(),
						limit: 25,
						search: effectiveSearch,
						cursor: append ? (destinationOptionCursorsByAccount[account.id]?.[source] ?? '') : '',
						context: JSON.stringify(settingsForAccount(account))
					});
					if (force && !onlySource && !search && !append) {
						await queryClient.invalidateQueries({
							queryKey: options.queryKey,
							exact: true,
							refetchType: 'none'
						});
					}
					const data = await queryClient.query(options);
					return [source, data?.options ?? [], data?.next_cursor ?? ''] as const;
				})
			);
			const applied = results.filter(
				([source]) =>
					destinationOptionsRequestSequences.get(
						destinationOptionsSequenceKey(account.id, source)
					) === requestSequences.get(source)
			);
			if (applied.length === 0) return;
			destinationOptionsByAccount = {
				...destinationOptionsByAccount,
				[account.id]: {
					...(destinationOptionsByAccount[account.id] ?? {}),
					...Object.fromEntries(
						applied.map(([source, options]) => [
							source,
							append
								? mergeDestinationOptions(
										destinationOptionsByAccount[account.id]?.[source] ?? [],
										options
									)
								: options
						])
					)
				}
			};
			destinationOptionCursorsByAccount = {
				...destinationOptionCursorsByAccount,
				[account.id]: {
					...(destinationOptionCursorsByAccount[account.id] ?? {}),
					...Object.fromEntries(applied.map(([source, , cursor]) => [source, cursor]))
				}
			};
		} catch (optionsError) {
			const current = sources.some(
				(source) =>
					destinationOptionsRequestSequences.get(
						destinationOptionsSequenceKey(account.id, source)
					) === requestSequences.get(source)
			);
			if (!current) return;
			destinationOptionsErrors = {
				...destinationOptionsErrors,
				[account.id]:
					optionsError instanceof Error
						? optionsError.message
						: m.compose_load_provider_options_failed()
			};
		} finally {
			if (requestWorkspaceId === selectedWorkspaceId) {
				markDestinationOptionsLoading(account.id, -1);
			}
		}
	}

	function destinationOptionsSequenceKey(accountID: string, source: string): string {
		return `${accountID}\u001f${source}`;
	}

	function markDestinationOptionsLoading(accountID: string, delta: 1 | -1) {
		const next = (destinationOptionsLoadingCounts.get(accountID) ?? 0) + delta;
		if (next > 0) {
			destinationOptionsLoadingCounts.set(accountID, next);
			destinationOptionsLoadingAccountIds.add(accountID);
			return;
		}
		destinationOptionsLoadingCounts.delete(accountID);
		destinationOptionsLoadingAccountIds.delete(accountID);
	}

	function getVariantPost(accountId: string, postKey: string): VariantPost | null {
		const values = variants.get(accountId);
		if (!values) return null;
		return values[postKey] ?? null;
	}

	function getVariantContent(accountId: string, postKey: string): string | null {
		const variant = getVariantPost(accountId, postKey);
		if (!variant || variant.contentInherited) return null;
		return variant.content;
	}

	function getVariantMediaIds(accountId: string, postKey: string): string[] | null {
		const variant = getVariantPost(accountId, postKey);
		if (!variant || variant.mediaInherited) return null;
		return variant.mediaIds;
	}

	function getVariantPayloadForSave(): Record<string, Record<string, VariantPost>> {
		return Object.fromEntries(
			Array.from(variants.entries()).map(([accountId, values]) => [accountId, values])
		);
	}
	function getEditorContentForPost(post: PostItem): string {
		if (!activeVariantAccountId) return post.content;
		return getVariantContent(activeVariantAccountId, post.key) ?? post.content;
	}

	function getEditorMediaIdsForPost(post: PostItem): string[] {
		if (!activeVariantAccountId) return post.mediaIds;
		return getVariantMediaIds(activeVariantAccountId, post.key) ?? post.mediaIds;
	}

	function clearAutoSaveTimer() {
		if (autoSaveTimer) {
			clearTimeout(autoSaveTimer);
			autoSaveTimer = null;
		}
	}

	function clearSavedIndicator() {
		if (savedIndicatorTimer) {
			clearTimeout(savedIndicatorTimer);
			savedIndicatorTimer = null;
		}
		savedIndicatorVisible = false;
	}

	function showSavedIndicator() {
		clearSavedIndicator();
		savedIndicatorVisible = true;
		savedIndicatorTimer = setTimeout(() => {
			savedIndicatorVisible = false;
			savedIndicatorTimer = null;
		}, 1600);
	}

	function isVideoMedia(mediaId: string): boolean {
		return mediaMimeTypes.get(mediaId)?.startsWith('video/') ?? false;
	}

	function mergeMediaIds(current: string[], incoming: string[]): string[] {
		const seen = new SvelteSet<string>();
		const merged: string[] = [];
		for (const id of [...current, ...incoming]) {
			const clean = id.trim();
			if (!clean || seen.has(clean)) continue;
			seen.add(clean);
			merged.push(clean);
			if (merged.length >= composerMediaLimit) break;
		}
		return merged;
	}

	function setEditorMediaIds(postIndex: number, mediaIds: string[]) {
		const post = posts[postIndex];
		if (!post) return;
		const next = mergeMediaIds([], mediaIds);
		if (next.length > 0) void startFirstComposition('media');
		if (activeVariantAccountId) {
			setVariantMediaIds(activeVariantAccountId, postIndex, next);
		} else {
			posts = posts.map((item, index) =>
				index === postIndex ? { ...item, mediaIds: next } : item
			);
		}
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function finishVideoEditorMediaHandoff() {
		const clean = new URL($page.url);
		clean.searchParams.delete('media_id');
		clean.searchParams.delete('workspace_id');
		replaceState(resolveAppPath(`${clean.pathname}${clean.search}${clean.hash}`), {});
	}

	async function applyInitialMediaHandoff(mediaIds: string[]) {
		const incoming = mergeMediaIds([], mediaIds);
		if (!selectedWorkspaceId || incoming.length === 0) return;
		const handoffKey = `${selectedWorkspaceId}|${incoming.join(',')}`;
		if (handoffKey === appliedInitialMediaKey) return;
		appliedInitialMediaKey = handoffKey;

		const targetIndex = Math.max(0, Math.min(activePostIndex, posts.length - 1));
		const targetPost = posts[targetIndex];
		if (!targetPost) return;
		const current = getEditorMediaIdsForPost(targetPost);
		const next = mergeMediaIds(current, incoming);
		const added = next.filter((id) => !current.includes(id));
		if (incoming.some((id) => !next.includes(id))) {
			error = m.media_upload_too_many({ maximum: composerMediaLimit });
		}
		if (added.length > 0) {
			const context = imagePreparationContext,
				target = pasteMediaTargetForPost(targetPost);
			const postContext = getEditorContentForPost(targetPost);
			if (!target) return;
			const prepared = await prepareNewImageIds(added, selectedWorkspaceId);
			if (!prepared || context !== imagePreparationContext) return;
			setPasteTargetMediaIds(target, [...current, ...prepared]);
			void generateMissingMediaAltText(prepared, postContext);
		}
		finishVideoEditorMediaHandoff();
	}

	function openMediaPicker(postIndex: number) {
		const post = posts[postIndex];
		const target = post ? pasteMediaTargetForPost(post) : null;
		if (target && pasteMediaUploadsForTarget(target).length > 0) return;
		mediaPickerInitialFiles = [];
		mediaPickerInitialMode = 'upload';
		mediaPickerMemeIdea = '';
		mediaPickerMemeCandidate = undefined;
		mediaPickerMemePreview = '';
		mediaPickerPostIndex = postIndex;
		mediaPickerOpen = true;
	}

	function composerHandoffReturnURL(): URL {
		const returnURL = new URL(
			publicationId
				? resolveAppPath(`/publications/${encodeURIComponent(publicationId)}`)
				: $page.url,
			$page.url
		);
		for (const key of ['image_editor_return', 'editor_handoff_cancelled']) {
			returnURL.searchParams.delete(key);
		}
		return returnURL;
	}

	function composerHandoffPayload(): ComposerHandoffPayload {
		const payload: ComposerHandoffPayload = {
			posts: $state.snapshot(posts),
			variants: Array.from(variants.entries()),
			active_post_index: mediaPickerPostIndex,
			selected_account_ids: [...selectedAccountIds],
			selected_social_set_id: selectedSocialSetId,
			requested_output_profiles: $state.snapshot(requestedOutputProfiles),
			format_locked_by_account: $state.snapshot(formatLockedByAccount),
			schedule_overrides_by_account: $state.snapshot(scheduleOverridesByAccount),
			active_variant_account_id: activeVariantAccountId,
			publication_id: publicationId,
			link_url: linkUrl,
			settings_by_account: $state.snapshot(settingsByAccount),
			segment_settings_by_post: $state.snapshot(segmentSettingsByPost),
			media_settings_by_account: $state.snapshot(mediaSettingsByAccount),
			media_alt_texts: Array.from(mediaAltTexts.entries()),
			media_mime_types: Array.from(mediaMimeTypes.entries()),
			media_sizes: Array.from(mediaSizes.entries()),
			selected_date: selectedDate?.toString(),
			selected_time: selectedTime,
			random_delay_override: randomDelayOverride,
			repost_override: $state.snapshot(repostOverride),
			revision
		};
		return payload;
	}

	async function restoreComposerHandoff(
		snapshot: ComposerRecoverySnapshot,
		returnToken: string
	): Promise<ComposerHandoffPayload> {
		const payload = parseComposerHandoffPayload(snapshot.payload);
		if (!payload) throw new ComposerSessionError('session_content_missing');
		const boundPublicationID = snapshot.publication_id || payload.publication_id;
		const boundRevision = snapshot.publication_revision ?? payload.revision;
		if (snapshot.return_token && snapshot.return_token !== returnToken) {
			throw new ComposerSessionError('editor_return_token_mismatch');
		}
		if (snapshot.workspace_id !== selectedWorkspaceId) {
			throw new ComposerSessionError('editor_return_workspace_mismatch');
		}
		if (!boundPublicationID || boundPublicationID !== publicationId) {
			throw new ComposerSessionError('editor_return_publication_mismatch');
		}
		const session = await sessionFor(selectedWorkspaceId, boundPublicationID);
		session.acceptEditorHandoff({
			workspaceId: snapshot.workspace_id,
			publicationId: boundPublicationID,
			revision: boundRevision,
			returnToken
		});
		clearEditorHandoff(returnToken);
		posts = structuredClone(payload.posts);
		variants = new SvelteMap(payload.variants ?? []);
		activePostIndex = Math.max(
			0,
			Math.min(payload.active_post_index, Math.max(0, posts.length - 1))
		);
		mediaPickerPostIndex = activePostIndex;
		selectedAccountIds = [...(payload.selected_account_ids ?? [])];
		selectedSocialSetId = payload.selected_social_set_id ?? '';
		requestedOutputProfiles = structuredClone(payload.requested_output_profiles ?? {});
		formatLockedByAccount = structuredClone(payload.format_locked_by_account ?? {});
		scheduleOverridesByAccount = structuredClone(payload.schedule_overrides_by_account ?? {});
		activeVariantAccountId = payload.active_variant_account_id ?? null;
		publicationId = boundPublicationID;
		revision = boundRevision;
		linkUrl = firstComposerURL(payload.posts[0]?.content ?? '') || payload.link_url;
		settingsByAccount = structuredClone(payload.settings_by_account);
		segmentSettingsByPost = structuredClone(payload.segment_settings_by_post);
		mediaSettingsByAccount = structuredClone(payload.media_settings_by_account);
		mediaAltTexts = new SvelteMap(payload.media_alt_texts ?? []);
		mediaMimeTypes = new SvelteMap(payload.media_mime_types ?? []);
		mediaPreviewMetadata.clear();
		mediaSizes = new SvelteMap(payload.media_sizes ?? []);
		selectedDate = undefined;
		if (payload.selected_date) {
			const [year, month, day] = payload.selected_date.split('-').map(Number);
			selectedDate = new CalendarDate(year, month, day);
		}
		selectedTime = payload.selected_time ?? null;
		randomDelayOverride = payload.random_delay_override ?? 'default';
		repostOverride = structuredClone(payload.repost_override ?? { mode: 'inherit' });
		await loadAccounts(selectedWorkspaceId, selectedAccountIds);
		await resolveCapabilities();
		lastSavedSnapshot = getSaveSnapshot();
		return payload;
	}

	function finishEditorHandoff(token: string): void {
		clearEditorHandoff(token);
		const clean = new URL($page.url);
		clean.searchParams.delete('image_editor_return');
		clean.searchParams.delete('editor_handoff_cancelled');
		replaceState(resolveAppPath(`${clean.pathname}${clean.search}${clean.hash}`), {});
	}

	async function requireSavedComposerBeforeHandoff(): Promise<void> {
		const saved = await saveDraft({ allowEmpty: true });
		if (!saved) throw new Error(error || m.compose_save_draft_failed());
	}

	async function openImageEditorFromComposer() {
		return openStillEditorFromComposer('image');
	}

	async function openTemplateEditorFromComposer() {
		return openStillEditorFromComposer('template');
	}

	async function editDestinationCover(
		setting: SettingDefinition,
		file: File,
		metadata: { sourceMediaId: string; timestampMs: number }
	) {
		const account = settingsAccount;
		const post = activePost;
		if (!account || !post) return;
		if (setting.key !== 'thumbnail_media_id' && setting.key !== 'cover_media_id') return;
		mediaPickerPostIndex = activePostIndex;
		await openStillEditorFromComposer('image', {
			file,
			target: {
				account_id: account.id,
				post_key: post.key,
				setting_key: setting.key,
				source_media_id: metadata.sourceMediaId
			}
		});
	}

	async function openStillEditorFromComposer(
		editor: 'image' | 'template',
		cover?: { file: File; target: ComposerCoverTarget }
	) {
		if (!selectedWorkspaceId) return;
		const workspaceId = selectedWorkspaceId;
		const generation = saveGeneration;
		const mutationSession = captureQueryMutationSession();
		mediaPickerOpen = false;
		await requireSavedComposerBeforeHandoff();
		if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
		const returnURL = composerHandoffReturnURL();
		let designID = '';
		if (cover) {
			const source = posts.find((post) => post.key === cover.target.post_key);
			if (
				!source ||
				!(getVariantMediaIds(cover.target.account_id, source.key) ?? source.mediaIds).includes(
					cover.target.source_media_id
				)
			) {
				throw new Error(m.compose_cover_target_changed());
			}
			const uploaded = await uploadMediaFile({
				workspaceId,
				file: cover.file,
				parentMediaId: cover.target.source_media_id
			});
			if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
			const bitmap = await createImageBitmap(cover.file);
			const size = { width_px: bitmap.width, height_px: bitmap.height };
			bitmap.close();
			const design = await createImageEditorDesign(workspaceId, {
				title: m.compose_cover_design_title(),
				preset_key: 'custom',
				...size,
				source_media_id: uploaded.id
			});
			if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
			designID = design.id;
		}
		const purpose = cover ? 'destination_cover' : isThread ? 'thread_segment' : 'post_media';
		const token = await createImageEditorReturnToken({
			workspace_id: workspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose,
			max_selection: cover ? 1 : composerMediaLimit,
			constraints: {
				max_count: cover ? 1 : composerMediaLimit,
				allowed_mimes: cover
					? ['image/png', 'image/jpeg']
					: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
				thread_segment: mediaPickerPostIndex
			}
		});
		if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
		const binding = (await sessionFor(workspaceId, publicationId)).bindEditorHandoff(token.token);
		if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return;
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
			payload: { ...composerHandoffPayload(), ...(cover && { cover_target: cover.target }) }
		});
		await goto(
			resolveAppPath(
				`${designID ? `/image-editor/${encodeURIComponent(designID)}` : editor === 'template' ? '/templates' : '/image-editor/new'}?workspace=${encodeURIComponent(workspaceId)}&return_token=${encodeURIComponent(token.token)}`
			)
		);
	}

	async function restoreImageEditorReturn() {
		if (!$page?.url) return;
		const token = $page.url.searchParams.get('image_editor_return');
		if (!token) return;
		const generation = saveGeneration;
		const mutationSession = captureQueryMutationSession();
		try {
			const snapshot = loadEditorHandoff(token, 'image');
			if (!snapshot) throw new ComposerSessionError('image_editor_return_inactive');
			if (snapshot.purpose === 'destination_cover') {
				const current = await canonicalPublicationForHandoff();
				if (!saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id)) return;
				if (
					!current ||
					current.id !== snapshot.publication_id ||
					current.revision !== snapshot.publication_revision
				) {
					throw new Error(m.compose_cover_target_changed());
				}
			}
			const payload = await restoreComposerHandoff(snapshot, token);
			if (!saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id)) return;
			if ($page.url.searchParams.get('editor_handoff_cancelled') === '1') {
				finishEditorHandoff(token);
				if (payload.cover_target) {
					settingsAccountId = payload.cover_target.account_id;
					settingsDialogOpen = true;
				}
				return;
			}
			const result = await consumeImageEditorReturnToken(token);
			if (!saveMutationViewIsCurrent(mutationSession, generation, snapshot.workspace_id)) return;
			if (snapshot.workspace_id !== result.workspace_id) {
				throw new ComposerSessionError('image_editor_return_workspace_mismatch');
			}
			if (snapshot.purpose === 'destination_cover' && !payload.cover_target)
				throw new Error(m.compose_cover_target_changed());
			if (payload.cover_target) {
				const target = payload.cover_target;
				const account = selectedAccounts.find((account) => account.id === target.account_id);
				const source = posts.find((post) => post.key === target.post_key);
				const definition =
					account && visibleSettings(account).find((field) => field.key === target.setting_key);
				if (
					snapshot.purpose !== 'destination_cover' ||
					result.purpose !== snapshot.purpose ||
					result.media_ids.length !== 1 ||
					!account ||
					!source ||
					!definition ||
					definition.control !== 'media_picker' ||
					definition.unavailable_reason ||
					!(getVariantMediaIds(account.id, source.key) ?? source.mediaIds).includes(
						target.source_media_id
					)
				) {
					throw new Error(m.compose_cover_target_changed());
				}
				activePostIndex = posts.indexOf(source);
				updateAccountSetting(account, target.setting_key, result.media_ids[0]);
				finishEditorHandoff(token);
				settingsAccountId = account.id;
				settingsDialogOpen = true;
				return;
			}
			const targetIndex = Math.max(
				0,
				Math.min(
					Number(result.constraints.thread_segment ?? activePostIndex),
					Math.max(0, posts.length - 1)
				)
			);
			const context = imagePreparationContext,
				target = pasteMediaTargetForPost(posts[targetIndex]);
			const postContext = getEditorContentForPost(posts[targetIndex]);
			if (!target) return;
			const current = [...mediaIdsForPasteTarget(target)];
			const prepared = await prepareNewImageIds(result.media_ids, result.workspace_id);
			if (!prepared || context !== imagePreparationContext) return;
			setPasteTargetMediaIds(target, [...current, ...prepared]);
			void generateMissingMediaAltText(prepared, postContext);
			scheduleAutoSave();
			finishEditorHandoff(token);
			notifyImageEditorReturn(result.media_ids.length);
		} catch (cause) {
			if (
				composerDestroyed ||
				generation !== saveGeneration ||
				!queryMutationSessionIsCurrent(mutationSession)
			) {
				return;
			}
			finishEditorHandoff(token);
			error =
				cause instanceof Error
					? m.compose_image_editor_return_error({ detail: composerErrorMessage(cause) })
					: m.compose_image_editor_return_recovery();
		}
	}

	async function canonicalPublicationForHandoff(): Promise<Publication | null> {
		if (!publicationId) return null;
		const { data, error: publicationError } = await client.GET('/publications/{id}', {
			params: { path: { id: publicationId } }
		});
		if (publicationError || !data) {
			throw new Error(publicationError?.detail || m.compose_load_composer_failed());
		}
		return data;
	}

	async function openVideoEditorFromComposer(selectedVideo?: MediaPickerVideoSelection) {
		if (!selectedWorkspaceId) return;
		mediaPickerOpen = false;
		await requireSavedComposerBeforeHandoff();
		await resolveCapabilities();
		const publication = await canonicalPublicationForHandoff();
		const query = new URLSearchParams({
			return: publication?.id ?? publicationId
		});
		if (selectedVideo) query.set('source', `media:${selectedVideo.id}`);
		await goto(resolveAppPath(`/video-editor/new?${query.toString()}`));
	}

	function notifyImageEditorReturn(count: number) {
		error = '';
		if (count > 0) soundPreferences.play('success');
	}

	function normalizeVariantsMap(
		nextVariants: Map<string, Record<string, VariantPost>>,
		sourcePosts: PostItem[] = posts
	): Map<string, Record<string, VariantPost>> {
		const normalized = new SvelteMap<string, Record<string, VariantPost>>();
		for (const accountId of selectedAccountIds) {
			const values = nextVariants.get(accountId);
			if (values) {
				normalized.set(accountId, normalizeVariantRecord(values, sourcePosts));
			}
		}
		return normalized;
	}

	// --------------------------------------------------------------------------
	// Initialization
	// --------------------------------------------------------------------------
	async function initializeNewComposer(resolveAfter = true) {
		pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		generationUndo = null;
		latestGenerationUndo = null;
		aiAppliedResult = null;
		aiAppliedStrategies = [];
		aiAttachmentRequirements = {};
		postBuilderError = '';
		publicationId = '';
		selectedSocialSetId = '';
		requestedOutputProfiles = {};
		formatLockedByAccount = {};
		scheduleOverridesByAccount = {};
		posts = [makeEmptyPost()];
		activePostIndex = 0;
		lastSavedSnapshot = '';
		lastSavedScheduleAt = '';
		variants = new Map();
		activeVariantAccountId = null;
		selectedAccountIds = [];
		mediaAltTexts = new Map();
		mediaMimeTypes = new Map();
		mediaPreviewMetadata.clear();
		mediaSizes = new Map();
		linkUrl = '';
		settingsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		resolvedCapabilities = {};
		validationIssues = [];
		selectedDate = undefined;
		selectedTime = null;
		randomDelayOverride = 'default';
		repostOverride = { mode: 'inherit' };
		if (workspaces.length > 0) {
			selectedWorkspaceId = workspaceCtx.currentWorkspace?.id ?? workspaces[0].id;
			await ensureComposerWorkspace(selectedWorkspaceId);
			await loadAccounts(
				selectedWorkspaceId,
				initialAccountIds.length ? initialAccountIds : undefined,
				initialAccountIds.length > 0
			);
			if (resolveAfter) await resolveCapabilities();
		}
	}

	async function initializeFromPublication(publication: Publication, resolveAfter = true) {
		// Content and its revision must come from the same read, including cached drafts.
		getComposerSession(publication.workspace_id).hydrate({
			publication,
			draft: publicationDraft(publication)
		});
		pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		generationUndo = null;
		latestGenerationUndo = null;
		aiAppliedResult = null;
		postBuilderError = '';
		publicationId = publication.id;
		revision = publication.revision;
		reviewState = publication.review_state ?? '';
		lastInitializedPublicationId = publication.id;
		selectedWorkspaceId = publication.workspace_id;
		selectedAccountIds = (publication.renditions ?? []).map(
			(rendition) => rendition.social_account_id
		);
		const canonicalSegments = [...(publication.segments ?? [])].sort(
			(left, right) => left.position - right.position
		);
		posts = canonicalSegments.map((segment) => ({
			key: segment.id,
			content: segment.body,
			mentions: readMentionMetadata(segment.body, segment.settings?.mentions),
			poll: readSharedPoll(segment.settings),
			link: readLinkDraft(segment.settings),
			mediaIds: (segment.media ?? []).map((media) => media.id)
		}));
		if (posts.length === 0) {
			posts = [
				{
					...makeEmptyPost(),
					content: publication.source_text ?? '',
					mediaIds: (publication.media ?? []).map((media) => media.id)
				}
			];
		}
		activePostIndex = 0;
		activeVariantAccountId = null;
		variants = new Map();
		mediaAltTexts = new Map();
		const publicationMedia = [
			...canonicalSegments.flatMap((segment) => segment.media ?? []),
			...(publication.media ?? []),
			...(publication.renditions ?? []).flatMap((rendition) => [
				...(rendition.media ?? []),
				...(rendition.segments ?? []).flatMap((segment) => segment.media ?? [])
			])
		];
		mediaMimeTypes = new Map(publicationMedia.map((media) => [media.id, media.mime_type] as const));
		mediaSizes = new Map();
		mediaPreviewMetadata.clear();
		const mediaIDs = publicationMedia.map((media) => media.id);
		await ensureComposerWorkspace(publication.workspace_id);
		if (publication.scheduled_at && publication.scheduled_at !== '0001-01-01T00:00:00Z') {
			const schedule = workspaceScheduleFromISO(publication.scheduled_at, scheduleTimezoneLabel);
			selectedDate = schedule?.date;
			selectedTime = schedule?.time ?? null;
		} else {
			selectedDate = undefined;
			selectedTime = null;
		}
		lastSavedScheduleAt =
			publication.scheduled_at && publication.scheduled_at !== '0001-01-01T00:00:00Z'
				? publication.scheduled_at
				: '';
		await Promise.all([
			mediaIDs.length > 0
				? hydrateMediaMetadata(publication.workspace_id, mediaIDs)
				: Promise.resolve(),
			loadAccounts(selectedWorkspaceId, selectedAccountIds)
		]);
		mediaAltTexts = new SvelteMap(
			[
				...(publication.media ?? []),
				...canonicalSegments.flatMap((segment) => segment.media ?? [])
			].map((media) => [media.id, media.alt_text ?? ''])
		);
		hydrateCanonicalSettings(publication);
		savedCardRenditions = publication.renditions;
		refreshSavedTextCardPreviews();
		if (resolveAfter) await resolveCapabilities();
		lastSavedSnapshot = getSaveSnapshot();
	}

	async function initializeComposer() {
		const requestSequence = ++workspaceRequestSequence;
		loadingWorkspaces = true;
		workspaceLoadError = '';

		try {
			if (workspaceCtx.workspaces.length === 0) {
				await workspaceCtx.initialize();
			}
			if (requestSequence !== workspaceRequestSequence) return;
			workspaces = [...workspaceCtx.workspaces];
			const [capabilityData] = await Promise.all([
				loadCapabilityCatalog(),
				initialPublication
					? initializeFromPublication(initialPublication, false)
					: initializeNewComposer(false)
			]);
			capabilities = capabilityData.capabilities ?? [];
			await resolveCapabilities();
		} catch (e) {
			if (composerDestroyed || requestSequence !== workspaceRequestSequence) return;
			console.error('Failed to load workspaces:', e);
			workspaceLoadError = m.compose_load_workspaces_failed();
		} finally {
			if (requestSequence === workspaceRequestSequence) {
				loadingWorkspaces = false;
			}
		}
	}

	async function requestComposerWorkspaceSwitch(request: WorkspaceSwitchRequest): Promise<boolean> {
		if (!selectedWorkspaceId || request.from.id !== selectedWorkspaceId) {
			return true;
		}
		clearAutoSaveTimer();
		const session = await sessionFor(selectedWorkspaceId, publicationId);
		return session.requestWorkspaceSwitch({
			fromWorkspaceId: request.from.id,
			toWorkspaceId: request.to.id,
			toWorkspaceName: request.to.name,
			dirty: composerWorkspaceStateDirty,
			adapters: {
				save: async () => {
					if (hasPendingPasteMediaUploads) return { ok: false, error: pasteMediaUploadBlocker() };
					const saved = autoSavesDraft
						? await flushPendingTextDraft()
						: await saveEditedPost(false);
					return saved
						? { ok: true }
						: { ok: false, error: error || m.compose_workspace_switch_save_failed() };
				},
				discard: () => undefined,
				invalidate: () => {
					if (isEditMode) leaveEditorForWorkspaceID = request.to.id;
					clearAutoSaveTimer();
					saveGeneration += 1;
					invalidatePendingComposerRequests();
					pasteMediaUploadQueue.reset();
				},
				resume: () => {
					if (autoSavesDraft && hasContent) scheduleAutoSave();
				}
			}
		});
	}

	async function saveBeforeWorkspaceSwitch() {
		await composerSession?.decideWorkspaceSwitch('save');
	}

	function discardBeforeWorkspaceSwitch() {
		void composerSession?.decideWorkspaceSwitch('discard');
	}

	function stayInComposerWorkspace() {
		void composerSession?.decideWorkspaceSwitch('stay');
	}

	onMount(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') void flushPendingTextDraft();
		};
		const handlePageHide = () => {
			composerDestroyed = true;
			invalidatePendingComposerRequests();
		};
		const unregisterComposerResetGuard = ui.registerComposerResetGuard(() => {
			if (!hasPendingPasteMediaUploads) return true;
			error = pasteMediaUploadBlocker();
			return false;
		});
		const unregisterWorkspaceSwitchGuard = workspaceCtx.registerWorkspaceSwitchGuard(
			requestComposerWorkspaceSwitch
		);
		document.addEventListener('visibilitychange', handleVisibilityChange);
		window.addEventListener('pagehide', handlePageHide);
		void (async () => {
			await initializeComposer();
			// Pick up a workspace-switch notice stashed by the pre-remount instance.
			if (selectedWorkspaceId && !workspaceChangeNotice) {
				const pending = ui.takePendingComposerWorkspaceNotice(selectedWorkspaceId);
				if (pending) workspaceChangeNotice = pending;
			}
			await restoreImageEditorReturn();
			await restoreActivePublicationBuild();
		})();
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('pagehide', handlePageHide);
			unregisterComposerResetGuard();
			unregisterWorkspaceSwitchGuard();
		};
	});

	function invalidatePendingComposerRequests() {
		imagePreparationSources.clear();
		losslessPreparedImageIds.clear();
		imagePreparationNotice = '';
		for (const controller of imagePreparationRequests) controller.abort();
		workspaceRequestSequence++;
		accountRequestSequence++;
		nextSlotRequestSequence++;
		capabilityResolveRequestSequence++;
	}

	onDestroy(() => {
		composerDestroyed = true;
		if (ideate.entry?.apply === modalApply && ideate.entry)
			ideate.entry = { ...ideate.entry, apply: undefined };
		void composerSession?.decideWorkspaceSwitch('stay');
		invalidatePendingComposerRequests();
		pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		clearSavedIndicator();
		if (capabilityResolveTimer) clearTimeout(capabilityResolveTimer);
		if (aiPollTimer) clearTimeout(aiPollTimer);
		if (aiOpportunitySlowTimer) clearTimeout(aiOpportunitySlowTimer);
		aiRequestController?.abort();
		aiVoiceRequestController?.abort();
		capabilityResolveAbortController?.abort();
		for (const controller of imagePreparationRequests) controller.abort();
		for (const controller of captionRequests.values()) controller.abort();
		captionRequests.clear();
		pendingCaptionResults.clear();
		captionPostContexts.clear();
		for (const session of previewSessions.values()) session.close();
		previewSessions.clear();
		unsubscribeComposerSession?.();
	});

	beforeNavigate((navigation) => {
		if (hasPendingPasteMediaUploads) {
			navigation.cancel();
			error = pasteMediaUploadBlocker();
			return;
		}
		if (allowNavigationOnce) {
			allowNavigationOnce = false;
			invalidatePendingComposerRequests();
			return;
		}
		if (
			!navigation.to?.url ||
			!autoSavesDraft ||
			!hasContent ||
			getSaveSnapshot() === lastSavedSnapshot ||
			draftConflict
		) {
			invalidatePendingComposerRequests();
			return;
		}
		const target = `${navigation.to.url.pathname}${navigation.to.url.search}${navigation.to.url.hash}`;
		navigation.cancel();
		void flushPendingTextDraft().then((saved) => {
			if (!saved) return;
			allowNavigationOnce = true;
			return goto(resolveAppPath(target));
		});
	});

	$effect(() => {
		const publication = initialPublication;
		if (!loadingWorkspaces && publication && lastInitializedPublicationId !== publication.id) {
			void initializeFromPublication(publication);
		}
	});

	$effect(() => {
		const dateParam = initialScheduleDate;
		const timeParam = initialScheduleTime;
		const workspaceParam = initialWorkspaceId;
		const accountParams = initialAccountIds;
		if (!loadingWorkspaces && !isEditMode) {
			void applyInitialComposerContext(dateParam, timeParam, workspaceParam, accountParams);
		}
	});

	$effect(() => {
		const handoff = ui.pendingRepurposeHandoff;
		if (
			handoff &&
			!initialPublication &&
			!loadingWorkspaces &&
			handoff.handoff_id !== appliedRepurposeHandoffID
		) {
			void applyRepurposeHandoff(handoff);
		}
	});

	$effect(() => {
		const draft = initialToolDraft;
		if (
			!draft ||
			toolDraftApplied ||
			initialPublication ||
			loadingWorkspaces ||
			loadingAccounts ||
			!selectedWorkspaceId
		)
			return;
		toolDraftApplied = true;
		posts = draft.parts.map((content, index) => {
			const post: PostItem = {
				...makeEmptyPost(),
				content,
				mediaIds: index === 0 ? draft.media.map((item) => item.id) : []
			};
			if (index === 0 && draft.poll) {
				post.poll = {
					question: draft.poll.question,
					options: draft.poll.options.map((text) => ({ id: crypto.randomUUID(), text })),
					duration_seconds: draft.poll.durationSeconds,
					destinations: {}
				};
			}
			return post;
		});
		linkUrl = draft.link || firstComposerURL(draft.parts[0] ?? '');
		activePostIndex = 0;
		variants = new Map();
		activeVariantAccountId = null;
		mediaAltTexts = new SvelteMap(draft.media.map((item) => [item.id, item.alt_text]));
		mediaMimeTypes = new SvelteMap(draft.media.map((item) => [item.id, item.mime_type]));
		mediaSizes = new SvelteMap(draft.media.map((item) => [item.id, item.size]));
		void startFirstComposition(draft.media.length ? 'media' : 'text');
		scheduleAutoSave();
	});

	$effect(() => {
		const mediaIds = initialMediaIds;
		const workspaceParam = initialWorkspaceId;
		if (loadingWorkspaces || mediaIds.length === 0 || !selectedWorkspaceId) return;
		if (initialPublication && lastInitializedPublicationId !== initialPublication.id) return;
		if (workspaceParam && workspaceParam !== selectedWorkspaceId) return;
		void applyInitialMediaHandoff(mediaIds);
	});

	$effect(() => {
		const workspaceId = workspaceCtx.currentWorkspace?.id ?? '';
		if (isEditMode && leaveEditorForWorkspaceID && workspaceId === leaveEditorForWorkspaceID) {
			leaveEditorForWorkspaceID = '';
			unsavedChanges?.clear(unsavedChangesKey);
			onSuccess?.();
		} else if (
			!isEditMode &&
			!initialWorkspaceId &&
			workspaceId &&
			workspaceId !== selectedWorkspaceId &&
			(!loadingWorkspaces || Boolean(selectedWorkspaceId))
		) {
			void handleWorkspaceChange(workspaceId);
		}
	});

	$effect(() => {
		const workspaceId = workspaceCtx.currentWorkspace?.id ?? '';
		const settingsFailed = workspaceCtx.settingsError;
		if (workspaceId && workspaceId === selectedWorkspaceId && settingsFailed) {
			workspaceSettingsError = m.compose_load_workspace_settings_failed();
		} else if (workspaceCtx.settingsReady && workspaceId === selectedWorkspaceId) {
			workspaceSettingsError = '';
		}
	});

	$effect(() => {
		const prompt = ui.pendingPrompt;
		if (prompt && !initialPublication && !loadingWorkspaces) {
			ui.clearPrompt();
			const content = prompt.example.trim() || prompt.text;
			posts = [{ ...posts[0], content }];
			linkUrl = firstComposerURL(content);
			activePostIndex = 0;
			variants = new Map();
			activeVariantAccountId = null;
			if (content.trim()) void startFirstComposition('text');
			scheduleAutoSave();
		}
	});

	$effect(() => {
		const inputSnapshot = capabilityInputSnapshot;
		if (
			!loadingWorkspaces &&
			!loadingAccounts &&
			inputSnapshot !== lastResolvedCapabilityInputSnapshot
		) {
			scheduleCapabilityResolve();
		}
	});

	$effect(() => {
		const selected = new Set(selectedAccountIds);
		let changed = false;
		const nextVariants = new SvelteMap<string, Record<string, VariantPost>>();
		for (const [accountId, value] of variants.entries()) {
			if (selected.has(accountId)) {
				const normalized = normalizeVariantRecord(value, posts);
				nextVariants.set(accountId, normalized);
				if (!variantRecordEquals(value, normalized, posts)) changed = true;
			} else {
				changed = true;
			}
		}
		if (changed) {
			variants = nextVariants;
		}
		if (activeVariantAccountId && !selected.has(activeVariantAccountId)) {
			activeVariantAccountId = null;
		}
	});

	// --------------------------------------------------------------------------
	// Data loading
	// --------------------------------------------------------------------------
	async function hydrateMediaMetadata(workspaceId: string, mediaIds: string[], force = false) {
		const requestedIds = Array.from(new Set(mediaIds.filter(Boolean)));
		const missingIds = force
			? requestedIds
			: requestedIds.filter(
					(id) => !mediaMimeTypes.has(id) || !mediaSizes.has(id) || !mediaPreviewMetadata.has(id)
				);
		if (!workspaceId || missingIds.length === 0) return;

		try {
			const mediaData = (await queryMediaMetadata(workspaceId, missingIds, { force })).media;
			if (composerDestroyed || workspaceId !== selectedWorkspaceId) return;
			const nextMimeTypes = new SvelteMap(mediaMimeTypes);
			const nextAltTexts = new SvelteMap(mediaAltTexts);
			const nextSizes = new SvelteMap(mediaSizes);
			for (const media of mediaData) {
				if (
					media.parent_media_id &&
					['image_optimization', 'image_fit'].includes(media.source ?? '')
				)
					imagePreparationSources.set(media.id, media.parent_media_id);
				if (media.source === 'image_optimization') losslessPreparedImageIds.add(media.id);
				const ratio =
					media.mime_type?.startsWith('image/') && (media.width ?? 0) > 0 && (media.height ?? 0) > 0
						? media.width! / media.height!
						: undefined;
				mediaPreviewMetadata.set(media.id, {
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
			mediaMimeTypes = nextMimeTypes;
			mediaAltTexts = nextAltTexts;
			mediaSizes = nextSizes;
		} catch (cause) {
			if (!composerDestroyed && workspaceId === selectedWorkspaceId) {
				console.error('Failed to load media metadata:', cause);
			}
		}
	}

	function captionPostContextForRetry(mediaId: string): string {
		const post = posts.find((candidate) => getEditorMediaIdsForPost(candidate).includes(mediaId));
		return resolveImageCaptionRetryContext(
			captionPostContexts.get(mediaId),
			post ? getEditorContentForPost(post) : ''
		);
	}

	async function generateMissingMediaAltText(mediaIds: string[], postContext: string) {
		const boundedPostContext = boundImageCaptionPostContext(postContext);
		const candidates = Array.from(new Set(mediaIds.filter(Boolean))).filter(
			(mediaId) =>
				mediaMimeTypes.get(mediaId)?.startsWith('image/') &&
				!mediaAltTexts.get(mediaId)?.trim() &&
				!captioningMediaIds.has(mediaId) &&
				!suppressedCaptionMediaIds.has(mediaId)
		);
		await Promise.all(
			candidates.map((mediaId) => {
				captionPostContexts.set(mediaId, boundedPostContext);
				return generateMediaAltText(mediaId, boundedPostContext);
			})
		);
	}

	async function generateMediaAltText(mediaId: string, postContext: string) {
		const controller = new AbortController();
		captionRequests.set(mediaId, controller);
		captioningMediaIds.add(mediaId);
		failedCaptionMediaIds.delete(mediaId);

		try {
			const pending = generateImageAltText(mediaId, {
				locale: getLocaleTag(),
				postContext,
				signal: controller.signal
			});
			pendingCaptionResults.set(mediaId, pending);
			const result = await pending;
			if (!result || controller.signal.aborted || suppressedCaptionMediaIds.has(mediaId)) return;
			if (!mediaAltTexts.get(mediaId)?.trim()) {
				const nextAltTexts = new SvelteMap(mediaAltTexts);
				nextAltTexts.set(mediaId, result.alt_text);
				mediaAltTexts = nextAltTexts;
				scheduleAutoSave();
			}
		} catch (cause) {
			if (cause instanceof Error && cause.name === 'AbortError') return;
			failedCaptionMediaIds.add(mediaId);
			captionGenerationError = m.compose_alt_text_generation_failed();
		} finally {
			if (captionRequests.get(mediaId) === controller) {
				captionRequests.delete(mediaId);
				pendingCaptionResults.delete(mediaId);
			}
			captioningMediaIds.delete(mediaId);
		}
	}

	function retryFailedMediaAltText() {
		const mediaIds = [...failedCaptionMediaIds];
		captionGenerationError = '';
		void Promise.all(
			mediaIds.map((mediaId) => {
				const postContext = captionPostContextForRetry(mediaId);
				captionPostContexts.set(mediaId, postContext);
				return generateMediaAltText(mediaId, postContext);
			})
		);
	}

	async function loadAccounts(
		workspaceId: string,
		preferredAccountIds: string[] | undefined = undefined,
		force = false
	) {
		const requestSequence = ++accountRequestSequence;
		if (!workspaceId) {
			accountsWorkspaceId = '';
			accounts = [];
			selectedAccountIds = [];
			accountLoadError = '';
			loadingAccounts = false;
			return;
		}

		const workspaceChanged = accountsWorkspaceId !== workspaceId;
		const selectionToPreserve = preferredAccountIds
			? [...preferredAccountIds]
			: workspaceChanged
				? undefined
				: [...selectedAccountIds];
		accountRetryIds = selectionToPreserve;
		accountsWorkspaceId = workspaceId;
		accountLoadError = '';
		loadingAccounts = true;

		if (workspaceChanged) {
			accounts = [];
			selectedAccountIds = [];
			activeVariantAccountId = null;
			if (preferredAccountIds === undefined) {
				variants = new Map();
			}
		}

		try {
			const data = await loadWorkspaceAccounts(workspaceId, force);
			if (requestSequence !== accountRequestSequence || selectedWorkspaceId !== workspaceId) {
				return;
			}

			const nextAccounts = data;
			const nextCompatibleAccounts = nextAccounts;
			accounts = nextAccounts;
			if (selectionToPreserve && selectionToPreserve.length > 0) {
				const validIds = nextCompatibleAccounts.map((account) => account.id);
				selectedAccountIds = selectionToPreserve.filter((id) => validIds.includes(id));
				if (force && selectedAccountIds.length === selectionToPreserve.length) {
					onHandoffSelected?.();
				}
			} else {
				selectedAccountIds = nextCompatibleAccounts.map((account) => account.id);
			}
			sanitizeSelectedAccounts(nextCompatibleAccounts);
		} catch (e) {
			if (
				composerDestroyed ||
				requestSequence !== accountRequestSequence ||
				selectedWorkspaceId !== workspaceId
			) {
				return;
			}
			console.error('Failed to load accounts:', e);
			accountLoadError = m.compose_load_accounts_failed();
		} finally {
			if (requestSequence === accountRequestSequence && selectedWorkspaceId === workspaceId) {
				loadingAccounts = false;
			}
		}
	}

	function handleWorkspaceChange(value: string) {
		if (!value || value === selectedWorkspaceId) return;
		if (hasPendingPasteMediaUploads) {
			error = pasteMediaUploadBlocker();
			return;
		}
		const resetWorkspaceState = Boolean(
			publicationId ||
			hasContent ||
			selectedDate ||
			selectedTime ||
			posts.some((post) => post.mediaIds.length > 0)
		);
		pasteMediaUploadQueue.reset();
		unsubscribeComposerSession?.();
		unsubscribeComposerSession = null;
		composerSession = null;
		clearAutoSaveTimer();
		aiRequestController?.abort();
		aiVoiceRequestController?.abort();
		if (aiPollTimer) clearTimeout(aiPollTimer);
		aiPollTimer = null;
		if (aiOpportunitySlowTimer) clearTimeout(aiOpportunitySlowTimer);
		aiOpportunitySlowTimer = null;
		aiOpportunitySlow = false;
		aiMemeRequestGeneration += 1;
		buildingPost = false;
		aiOpportunityLoading = false;
		aiFindingMore = false;
		aiWorkspaceOpen = false;
		aiActiveBuild = null;
		aiPendingResult = null;
		aiAppliedResult = null;
		aiAppliedStrategies = [];
		aiAttachmentRequirements = {};
		aiApplyPending = false;
		aiBuildCreateRejected = false;
		aiBuildPublicationID = '';
		aiVoiceName = m.compose_ai_default_voice();
		aiVoiceProfileID = '';
		aiMemeCandidates = [];
		aiMemeTargetAccountIDs = [];
		aiMemeWorkspaceID = '';
		aiMemeError = '';
		saveGeneration += 1;
		nextSlotRequestSequence += 1;
		suggestingSlot = false;
		publicationId = '';
		selectedSocialSetId = '';
		requestedOutputProfiles = {};
		formatLockedByAccount = {};
		scheduleOverridesByAccount = {};
		lastSavedSnapshot = '';
		lastSavedScheduleAt = '';
		isSaving = false;
		showDeleteConfirm = false;
		selectedDate = undefined;
		selectedTime = null;
		showScheduleDialog = false;
		scheduleInputError = '';
		randomDelayOverride = 'default';
		posts = [makeEmptyPost()];
		activePostIndex = 0;
		onThreadStateChange?.(false);
		mediaAltTexts = new Map();
		mediaMimeTypes = new Map();
		mediaPreviewMetadata.clear();
		mediaSizes = new Map();
		linkUrl = '';
		settingsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		resolvedCapabilities = {};
		validationIssues = [];
		generationUndo = null;
		latestGenerationUndo = null;
		postBuilderError = '';
		settingsDialogOpen = false;
		settingsAccountId = '';
		destinationOptionsByAccount = {};
		destinationOptionCursorsByAccount = {};
		destinationOptionSearchByAccount = {};
		destinationOptionsErrors = {};
		destinationOptionsRequestSequences.clear();
		destinationOptionsLoadingCounts.clear();
		destinationOptionsLoadingAccountIds.clear();
		lastResolvedCapabilityInputSnapshot = '';
		lastResolvedCapabilityStructureSnapshot = '';
		capabilityResolveError = '';
		selectedWorkspaceId = value;
		accounts = [];
		selectedAccountIds = [];
		variants = new Map();
		activeVariantAccountId = null;
		accountLoadError = '';
		workspaceChangeNotice = resetWorkspaceState ? m.compose_workspace_context_reset() : '';
		if (resetWorkspaceState) {
			ui.clearActiveComposerDraft();
			// The layout remounts the app shell on workspace switches, destroying
			// this instance before the notice above can render. Stash it so the
			// remounted composer can show it.
			ui.setPendingComposerWorkspaceNotice({
				message: m.compose_workspace_context_reset(),
				workspaceId: value
			});
			replaceState(resolve('/'), {});
		}
		void loadAccounts(value);
	}

	function toggleAccount(id: string) {
		const account = accounts.find((candidate) => candidate.id === id);
		if (!account) return;
		selectedSocialSetId = '';
		if (selectedAccountIds.includes(id)) {
			pasteMediaUploadQueue.discardWhere((upload) => upload.target.variantAccountId === id);
			selectedAccountIds = selectedAccountIds.filter((a) => a !== id);
			if (variants.has(id)) {
				const nextVariants = new SvelteMap(variants);
				nextVariants.delete(id);
				variants = nextVariants;
			}
			if (activeVariantAccountId === id) {
				activeVariantAccountId = null;
			}
		} else {
			selectedAccountIds = [...selectedAccountIds, id];
		}
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function selectAllAccounts() {
		selectedAccountIds = compatibleAccounts.map((account) => account.id);
		selectedSocialSetId = '';
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function clearAllAccounts() {
		pasteMediaUploadQueue.discardWhere((upload) => upload.target.variantAccountId !== null);
		selectedAccountIds = [];
		selectedSocialSetId = '';
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function applySocialSet(set: SocialSet | null) {
		if (!set) {
			selectedSocialSetId = '';
			scheduleAutoSave();
			return;
		}
		selectedSocialSetId = set.id;
		const nextAccountIds = (set.accounts ?? [])
			.map((membership) => membership.social_account_id)
			.filter((id) => accounts.some((account) => account.id === id));
		pasteMediaUploadQueue.discardWhere(
			(upload) =>
				upload.target.variantAccountId !== null &&
				!nextAccountIds.includes(upload.target.variantAccountId)
		);
		selectedAccountIds = nextAccountIds;
		requestedOutputProfiles = Object.fromEntries(
			(set.accounts ?? [])
				.filter((membership) => membership.default_output_profile)
				.map((membership) => [membership.social_account_id, membership.default_output_profile!])
		);
		formatLockedByAccount = Object.fromEntries(
			(set.accounts ?? [])
				.filter((membership) => membership.default_output_profile)
				.map((membership) => [membership.social_account_id, true])
		);
		settingsByAccount = Object.fromEntries(
			(set.accounts ?? []).map((membership) => [
				membership.social_account_id,
				{
					...parseComposerSettingsRecord(membership.default_settings ?? {}),
					...(settingsByAccount[membership.social_account_id] ?? {})
				}
			])
		);
		segmentSettingsByPost = Object.fromEntries(
			posts.map((post) => [
				post.key,
				Object.fromEntries(
					(set.accounts ?? []).map((membership) => [
						membership.social_account_id,
						{
							...parseComposerSettingsRecord(membership.default_segment_settings ?? {}),
							...(segmentSettingsByPost[post.key]?.[membership.social_account_id] ?? {})
						}
					])
				)
			])
		);
		activeVariantAccountId = null;
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function accountLabel(account: SocialAccount): string {
		return (
			formatSocialAccountName(account.account_username, account.platform, account.alias) ||
			account.slug ||
			getPlatformName(account.platform)
		);
	}

	function accountContextLabel(account: SocialAccount): string {
		return formatSocialAccountLabel(
			account.account_username,
			account.platform,
			account.slug || account.account_id
		);
	}

	function destinationFormatOptions(account: SocialAccount) {
		const resolved = resolvedCapabilities[account.id];
		const current = requestedOutputProfiles[account.id] || resolved?.output_profile || '';
		const options = (resolved?.available_formats ?? []).map((format) => ({
			value: format.output_profile,
			label: format.compatible
				? format.label
				: m.compose_format_needs_changes({ format: format.label })
		}));
		if (current && !options.some((option) => option.value === current)) {
			options.unshift({ value: current, label: current });
		}
		return options;
	}

	function accountUsesManualFormat(account: SocialAccount): boolean {
		return ['instagram', 'facebook', 'tiktok'].includes(getPlatformKey(account.platform));
	}

	function selectDestinationFormat(account: SocialAccount, outputProfile: string) {
		requestedOutputProfiles = { ...requestedOutputProfiles, [account.id]: outputProfile };
		formatLockedByAccount = { ...formatLockedByAccount, [account.id]: true };
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	// --------------------------------------------------------------------------
	// Draft saving
	// --------------------------------------------------------------------------
	function scheduleAutoSave() {
		if (!autoSavesDraft) return;
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			if (!hasContent) return;
			const snapshot = getSaveSnapshot();
			if (snapshot !== lastSavedSnapshot) {
				saveDraft();
			}
		}, 2000);
	}

	function saveDraft(
		options: {
			saveAsCopy?: boolean;
			scheduledAt?: string | null;
			allowEmpty?: boolean;
		} = {}
	): Promise<string | null> {
		return saveDraftNow(options);
	}

	function saveMutationViewIsCurrent(
		session: QueryMutationSession,
		generation: number,
		workspaceId: string
	): boolean {
		return (
			!composerDestroyed &&
			generation === saveGeneration &&
			selectedWorkspaceId === workspaceId &&
			queryMutationSessionIsCurrent(session)
		);
	}

	async function saveDraftNow(options: {
		saveAsCopy?: boolean;
		scheduledAt?: string | null;
		allowEmpty?: boolean;
	}): Promise<string | null> {
		if (!selectedWorkspaceId || (!hasContent && !options.allowEmpty)) return null;
		const generation = saveGeneration;
		const operationSequence = ++saveOperationSequence;
		const workspaceId = selectedWorkspaceId;
		const mutationSession = captureQueryMutationSession();
		const startingPublicationId = options.saveAsCopy ? '' : publicationId;
		const snapshot = getSaveSnapshot();
		clearSavedIndicator();
		isSaving = true;
		error = '';

		try {
			const proposedSchedule =
				options.scheduledAt === undefined ? (getScheduledAt() ?? null) : options.scheduledAt;
			const canonicalID = startingPublicationId || `publication-draft:${posts[0].key}`;
			const canonical = publicationPayload(canonicalID);
			const { workspace_id: _workspaceID, ...canonicalDraft } = canonical;
			const publication: PublicationDraft = {
				...canonicalDraft,
				repost_override: $state.snapshot(repostOverride)
			};
			if (proposedSchedule) publication.scheduled_at = proposedSchedule;
			if (proposedSchedule && randomDelayOverride !== 'default') {
				publication.random_delay_minutes = effectiveRandomDelayMinutes;
			}
			const session = await sessionFor(workspaceId, startingPublicationId);
			if (options.saveAsCopy) session.reset();
			session.edit(publication);
			const saved = await session.save();
			const savedPublicationId = saved.id;

			if (!saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) return null;
			const createdPublication = !startingPublicationId;
			publicationId = savedPublicationId;
			revision = saved.revision;
			reviewState = saved.review_state ?? '';
			savedCardRenditions = saved.renditions;
			refreshSavedTextCardPreviews();
			draftConflict = null;
			lastSavedSnapshot = snapshot;
			showSavedIndicator();
			ui.setActiveComposerDraft(savedPublicationId);
			const previousScheduleAt = lastSavedScheduleAt;
			lastSavedScheduleAt = proposedSchedule ?? '';
			const scheduleChanged = previousScheduleAt !== lastSavedScheduleAt;
			const affectedDateKeys = publicationDateKeys(previousScheduleAt, lastSavedScheduleAt);
			ui.invalidatePublications({
				workspaceId,
				scopes: scheduleChanged ? ['activity', 'calendar', 'drafts'] : ['drafts'],
				dateKeys: affectedDateKeys
			});
			if (createdPublication) onDraftCreated?.(savedPublicationId);
			return savedPublicationId;
		} catch (cause) {
			console.error('Failed to save text post draft:', cause);
			if (saveMutationViewIsCurrent(mutationSession, generation, workspaceId)) {
				error = cause instanceof Error ? cause.message : m.compose_save_draft_failed();
			}
			return null;
		} finally {
			if (operationSequence === saveOperationSequence) isSaving = false;
		}
	}

	function publicationDateKeys(...timestamps: Array<string | null | undefined>) {
		return [
			...new Set(
				timestamps
					.map((value) => (value ? workspaceDateKeyFromISO(value, scheduleTimezoneLabel) : null))
					.filter((value): value is string => Boolean(value))
			)
		];
	}

	async function reloadSavedTextDraft() {
		if (!draftConflict) return;
		const { data, error: loadError } = await client.GET('/publications/{id}', {
			params: { path: { id: publicationId || draftConflict.conflict.aggregate_id } }
		});
		if (loadError || !data) {
			throw new Error(loadError?.detail || m.compose_update_draft_failed());
		}
		await initializeFromPublication(data);
		error = '';
		draftConflict = null;
	}

	async function saveConflictedTextDraftAsCopy() {
		const saved = await saveDraft({ saveAsCopy: true });
		if (!saved) throw new Error(error || m.compose_save_draft_failed());
		lastSavedSnapshot = getSaveSnapshot();
		draftConflict = null;
		conflictDialogOpen = false;
		success = m.compose_draft_saved();
		error = '';
	}

	let reviewBaseline: { id: string; workspaceId: string; snapshot: string } | undefined;
	async function applyClientReview(post: Publication) {
		if (
			composerDestroyed ||
			!reviewBaseline ||
			post.id !== publicationId ||
			post.id !== reviewBaseline.id ||
			selectedWorkspaceId !== reviewBaseline.workspaceId ||
			getSaveSnapshot() !== reviewBaseline.snapshot
		)
			throw new Error(m.compose_ai_build_failed());
		await initializeFromPublication(post);
		reviewBaseline = { id: post.id, workspaceId: selectedWorkspaceId, snapshot: getSaveSnapshot() };
	}
	async function prepareClientReview(): Promise<Publication> {
		clearAutoSaveTimer();
		if (!(await flushPendingTextDraft())) throw new Error(m.compose_save_draft_failed());
		const id = publicationId || (await saveDraft({ allowEmpty: true }));
		if (!id) throw new Error(m.compose_save_draft_failed());
		const baseline = { id, workspaceId: selectedWorkspaceId, snapshot: getSaveSnapshot() };
		const post = await queryClient.query({
			...publicationDetailQueryOptions(queryAPI, baseline.workspaceId, id),
			staleTime: 0
		});
		if (!post) throw new Error(m.compose_save_draft_failed());
		if (
			composerDestroyed ||
			publicationId !== id ||
			selectedWorkspaceId !== baseline.workspaceId ||
			getSaveSnapshot() !== baseline.snapshot
		)
			throw new Error(m.compose_ai_build_failed());
		reviewBaseline = baseline;
		return post;
	}

	async function overwriteSavedTextDraft() {
		if (!draftConflict) return;
		const session = await sessionFor(selectedWorkspaceId, publicationId);
		const saved = await session.overwriteConflict();
		publicationId = saved.id;
		revision = saved.revision;
		reviewState = saved.review_state ?? '';
		savedCardRenditions = saved.renditions;
		refreshSavedTextCardPreviews();
		lastSavedSnapshot = getSaveSnapshot();
		draftConflict = null;
		success = m.compose_changes_saved();
		error = '';
	}

	async function flushPendingTextDraft(): Promise<boolean> {
		clearAutoSaveTimer();
		await composerSession?.flush().catch(() => undefined);
		if (autoSavesDraft && hasContent && getSaveSnapshot() !== lastSavedSnapshot && !draftConflict) {
			await saveDraft();
		}
		return !draftConflict && getSaveSnapshot() === lastSavedSnapshot;
	}

	async function deleteDraft(): Promise<DestructiveActionOutcome> {
		if (!publicationId || isDeleting) return { ok: false };
		clearAutoSaveTimer();
		isDeleting = true;
		error = '';
		try {
			const session = await sessionFor(selectedWorkspaceId, publicationId);
			await session.delete();

			const affectedDateKeys = publicationDateKeys(lastSavedScheduleAt);
			ui.invalidatePublications(
				{
					workspaceId: selectedWorkspaceId,
					scopes:
						affectedDateKeys.length > 0
							? ['activity', 'calendar', 'drafts']
							: ['activity', 'drafts'],
					dateKeys: affectedDateKeys
				},
				{ immediate: true }
			);
			pasteMediaUploadQueue.reset();
			posts = [makeEmptyPost()];
			activePostIndex = 0;
			publicationId = '';
			lastSavedSnapshot = '';
			lastSavedScheduleAt = '';
			variants = new Map();
			activeVariantAccountId = null;
			selectedDate = undefined;
			selectedTime = null;
			randomDelayOverride = 'default';
			showDeleteConfirm = false;
			unsavedChanges?.clear(unsavedChangesKey);
			await onDeleted?.();
			return {
				ok: true,
				successMessage: m.compose_delete_success(),
				returnFocus: document.getElementById('post-textarea-0')
			};
		} catch (cause) {
			soundPreferences.play('error');
			return {
				ok: false,
				message: cause instanceof Error ? cause.message : m.compose_delete_post_failed()
			};
		} finally {
			isDeleting = false;
		}
	}

	function requestDraftDelete(event: MouseEvent) {
		void requestDestructiveAction(event, () => (showDeleteConfirm = true), deleteDraft);
	}

	async function saveEditedPost(navigateOnSuccess = true): Promise<boolean> {
		if (!publicationId || !initialPublication) return false;
		error = '';
		success = '';

		if (!selectedWorkspaceId) {
			error = m.compose_please_select_workspace();
			return false;
		}
		if (!hasContent) {
			error = m.compose_please_enter_content();
			return false;
		}
		const pasteUploadBlocker = pasteMediaUploadBlocker();
		if (pasteUploadBlocker) {
			error = pasteUploadBlocker;
			return false;
		}
		if (selectedAccountIds.length === 0) {
			error = m.compose_select_account();
			return false;
		}
		if ((selectedDate && !selectedTime) || (!selectedDate && selectedTime)) {
			error = m.compose_select_date_time();
			return false;
		}
		const pollError = selectedDate && selectedTime ? configuredPollError() : '';
		if (pollError) {
			error = pollError;
			return false;
		}
		if (selectedDate && selectedTime && !selectedWorkspaceSettingsReady) {
			error = m.compose_load_workspace_settings_failed();
			workspaceSettingsError = error;
			return false;
		}
		const scheduledAt = getScheduledAt();
		if (selectedDate && selectedTime && !scheduledAt) {
			error = m.compose_invalid_timezone_time();
			return false;
		}
		isSaving = true;
		try {
			const targetPublicationID = await saveDraft({ scheduledAt: scheduledAt ?? null });
			if (!targetPublicationID) {
				throw new Error(error || m.compose_save_publication_failed());
			}
			if (scheduledAt) {
				try {
					await (await sessionFor(selectedWorkspaceId, targetPublicationID)).schedule();
				} catch (scheduleError) {
					const resolvedCurrent = await resolveCapabilitiesCurrent();
					const readinessFailure = resolvedCurrent
						? operationReadinessBlocker('publish_scheduled')
						: capabilityResolveError || m.compose_load_readiness_failed();
					if (readinessFailure) {
						const blockingIssue =
							globalIssues.find((candidate) => candidate.severity === 'error') ?? null;
						if (blockingIssue) await focusComposerIssue(blockingIssue);
						throw new Error(readinessFailure);
					}
					const blockingIssue = await refreshPublicationValidation(targetPublicationID);
					if (blockingIssue) await focusComposerIssue(blockingIssue);
					throw new Error(
						blockingIssue
							? m.compose_fix_before_scheduling()
							: scheduleError instanceof Error
								? scheduleError.message
								: m.compose_schedule_failed()
					);
				}
			}

			lastSavedSnapshot = getSaveSnapshot();
			success = m.compose_changes_saved();
			soundPreferences.play('success');
			if (scheduledAt) void celebrateSchedule();
			ui.invalidatePublications(
				{
					workspaceId: selectedWorkspaceId,
					scopes: ['activity', 'drafts'],
					activities: scheduledAt ? ['draft', 'scheduled'] : ['draft']
				},
				{ immediate: true }
			);

			if (navigateOnSuccess && onSuccess) {
				setTimeout(() => onSuccess(), 500);
			}
			return true;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.compose_save_changes_failed();
			soundPreferences.play('error');
			return false;
		} finally {
			isSaving = false;
		}
	}

	// --------------------------------------------------------------------------
	// Publishing
	// --------------------------------------------------------------------------
	async function publish(publishNow: boolean = false) {
		clearAutoSaveTimer();
		error = '';
		success = '';
		deliveryFeedback = [];
		deliveryPublicationID = '';

		if (!selectedWorkspaceId) {
			error = m.compose_please_select_workspace();
			return;
		}
		if (!hasContent) {
			error = m.compose_please_enter_content();
			return;
		}
		const pasteUploadBlocker = pasteMediaUploadBlocker();
		if (pasteUploadBlocker) {
			error = pasteUploadBlocker;
			return;
		}
		if (selectedAccountIds.length === 0) {
			error = m.compose_select_account();
			return;
		}
		const pollError = configuredPollError();
		if (pollError) {
			error = pollError;
			return;
		}

		let scheduledAt: string | undefined;
		if (publishNow) {
			scheduledAt = new Date().toISOString();
		} else {
			if (!selectedWorkspaceSettingsReady) {
				error = m.compose_load_workspace_settings_failed();
				workspaceSettingsError = error;
				return;
			}
			scheduledAt = getScheduledAt();
			if (!scheduledAt) {
				error =
					selectedDate && selectedTime
						? m.compose_invalid_timezone_time()
						: m.compose_select_date_time();
				return;
			}
			if (new Date(scheduledAt).getTime() <= Date.now()) {
				error = m.compose_schedule_future();
				return;
			}
		}

		let issueToFocusAfterSubmit: ComposerIssue | null = null;
		isSubmitting = true;

		try {
			if (isThread) {
				const validPosts = posts.filter(
					(post) => post.content.trim().length > 0 || post.mediaIds.length > 0
				);
				if (validPosts.length < 2) {
					throw new Error(m.compose_thread_minimum());
				}
			}
			if (!(await resolveCapabilitiesCurrent())) {
				throw new Error(capabilityResolveError || m.compose_load_readiness_failed());
			}
			const readinessBlocker = operationReadinessBlocker(
				publishNow ? 'publish_immediate' : 'publish_scheduled'
			);
			if (readinessBlocker) {
				issueToFocusAfterSubmit =
					globalIssues.find((candidate) => candidate.severity === 'error') ?? null;
				throw new Error(readinessBlocker);
			}
			const targetPublicationID = await saveDraft({
				scheduledAt: publishNow ? null : (scheduledAt ?? null)
			});
			if (!targetPublicationID) {
				throw new Error(error || m.compose_save_publication_failed());
			}
			let action;
			try {
				const session = await sessionFor(selectedWorkspaceId, targetPublicationID);
				action = publishNow ? await session.publishNow() : await session.schedule();
				validationIssues = [...session.snapshot.validationIssues];
			} catch (actionError) {
				const blocker = validationIssues.find((issue) => issue.severity === 'error');
				if (blocker) issueToFocusAfterSubmit = firstValidationIssue();
				const resolvedCurrent = await resolveCapabilitiesCurrent();
				const readinessFailure = resolvedCurrent
					? operationReadinessBlocker(publishNow ? 'publish_immediate' : 'publish_scheduled')
					: capabilityResolveError || m.compose_load_readiness_failed();
				if (readinessFailure) {
					issueToFocusAfterSubmit =
						globalIssues.find((candidate) => candidate.severity === 'error') ?? null;
					throw new Error(readinessFailure);
				}
				const blockingIssue = await refreshPublicationValidation(targetPublicationID);
				issueToFocusAfterSubmit = blockingIssue;
				throw new Error(
					blockingIssue
						? publishNow
							? m.compose_fix_before_publishing()
							: m.compose_fix_before_scheduling()
						: actionError instanceof Error
							? actionError.message
							: publishNow
								? m.compose_publish_failed()
								: m.compose_schedule_failed()
				);
			}
			if (action?.workspace_activated && action.activation_publication_id) {
				activationPublicationID = action.activation_publication_id;
			}
			deliveryPublicationID = action?.publication_id || targetPublicationID;
			deliveryFeedback = action?.renditions ?? [];

			if (publishNow) {
				captureTelemetryEvent('publication publish requested', {
					account_count: selectedAccountIds.length,
					is_thread: isThread
				});
			} else {
				captureTelemetryEvent('publication schedule requested', {
					account_count: selectedAccountIds.length,
					is_thread: isThread
				});
			}
			success = publishNow ? m.compose_publishing_now() : m.compose_scheduled_success();
			soundPreferences.play('success');
			void celebrateSchedule();
			ui.invalidatePublications(
				{
					workspaceId: selectedWorkspaceId,
					scopes: ['activity', 'calendar', 'drafts'],
					dateKeys: publicationDateKeys(scheduledAt),
					activities: ['draft', publishNow ? 'published' : 'scheduled']
				},
				{ immediate: true }
			);
			ui.refreshWorkspaceSetup();

			if (activationPublicationID || deliveryFeedback.length > 0) {
				// Keep the completion actions available until the author chooses where to go next.
			} else if (isEditMode && onSuccess) {
				setTimeout(() => onSuccess(), 800);
			} else {
				resetAfterSuccessfulPublication();
				onSuccess?.();
				setTimeout(() => (success = ''), 3000);
			}
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.compose_publish_failed();
			soundPreferences.play('error');
		} finally {
			isSubmitting = false;
			if (issueToFocusAfterSubmit) {
				await tick();
				await focusComposerIssue(issueToFocusAfterSubmit);
			}
		}
	}

	async function retryDeliveryRendition(renditionID: string) {
		const rendition = deliveryFeedback.find((item) => item.id === renditionID);
		if (!deliveryPublicationID || !rendition) return;
		retryingDeliveryRenditionID = renditionID;
		error = '';
		try {
			const action = await (
				await sessionFor(selectedWorkspaceId, deliveryPublicationID)
			).retry(rendition.social_account_id, rendition.target_key);
			deliveryFeedback = action.renditions ?? [];
			success = m.publication_delivery_retry_queued();
		} catch (cause: unknown) {
			error = cause instanceof Error ? cause.message : m.publication_delivery_retry_failed();
		} finally {
			retryingDeliveryRenditionID = '';
		}
	}

	function resetAfterDeliveryFeedback() {
		deliveryFeedback = [];
		deliveryPublicationID = '';
		activationPublicationID = '';
		if (isEditMode) {
			onSuccess?.();
			return;
		}
		resetAfterSuccessfulPublication();
	}

	// --------------------------------------------------------------------------
	// Thread management
	// --------------------------------------------------------------------------
	function addPost() {
		void startFirstComposition('content_mode');
		const newIndex = activePostIndex + 1;
		posts = [...posts.slice(0, newIndex), makeEmptyPost(), ...posts.slice(newIndex)];
		variants = normalizeVariantsMap(variants, posts);
		activePostIndex = newIndex;
		onThreadStateChange?.(true);
		scheduleAutoSave();
		tick().then(() => {
			document.getElementById(`post-textarea-${newIndex}`)?.focus();
		});
	}

	function removePost(index: number) {
		if (posts.length <= 1) return;
		const removedPostKey = posts[index]?.key;
		if (removedPostKey) {
			pasteMediaUploadQueue.discardWhere((upload) => upload.target.postKey === removedPostKey);
		}
		posts = posts.filter((_, i) => i !== index);
		variants = normalizeVariantsMap(variants, posts);
		if (activePostIndex >= posts.length) {
			activePostIndex = posts.length - 1;
		}
		onThreadStateChange?.(posts.length > 1);
		scheduleAutoSave();
	}

	function handleReorder(newItems: PostItem[]) {
		if (newItems.every((post, index) => post.key === posts[index]?.key)) return;
		undoReorderIDs = posts.map((post) => post.key);
		const activeKey = posts[activePostIndex]?.key;
		posts = newItems;
		variants = normalizeVariantsMap(variants, newItems);
		activePostIndex = Math.max(
			0,
			newItems.findIndex((post) => post.key === activeKey)
		);
		scheduleAutoSave();
	}
	function undoThreadReorder() {
		if (!undoReorderIDs) return;
		const activeKey = posts[activePostIndex]?.key;
		posts = undoReorderIDs.flatMap((key) => posts.find((post) => post.key === key) ?? []);
		variants = normalizeVariantsMap(variants, posts);
		activePostIndex = Math.max(
			0,
			posts.findIndex((post) => post.key === activeKey)
		);
		undoReorderIDs = null;
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// Media
	// --------------------------------------------------------------------------
	function pasteMediaTargetForPost(post: PostItem): PasteMediaUploadTarget | null {
		if (!selectedWorkspaceId) return null;
		return {
			workspaceId: selectedWorkspaceId,
			postKey: post.key,
			variantAccountId: activeVariantAccountId
		};
	}

	function pasteMediaUploadsForTarget(target: PasteMediaUploadTarget): PasteMediaUploadItem[] {
		return pasteMediaUploads.filter(
			(upload) =>
				upload.target.workspaceId === target.workspaceId &&
				upload.target.postKey === target.postKey &&
				upload.target.variantAccountId === target.variantAccountId
		);
	}

	function visiblePasteMediaUploads(post: PostItem): PasteMediaUploadItem[] {
		const target = pasteMediaTargetForPost(post);
		return target ? pasteMediaUploadsForTarget(target) : [];
	}

	function visiblePasteMediaFeedback(post: PostItem): string[] {
		const target = pasteMediaTargetForPost(post);
		if (!target || pasteMediaFeedback?.targetKey !== pasteMediaTargetKey(target)) return [];
		return pasteMediaFeedback.messages;
	}

	function pastedImageRejectionMessage(reason: PastedImageRejectionReason, file: File): string {
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
				return m.media_upload_too_many({ maximum: composerMediaLimit });
		}
	}

	function mediaIdsForPasteTarget(target: PasteMediaUploadTarget): string[] {
		const post = posts.find((candidate) => candidate.key === target.postKey);
		if (!post) return [];
		if (!target.variantAccountId) return post.mediaIds;
		return getVariantMediaIds(target.variantAccountId, post.key) ?? post.mediaIds;
	}

	function pasteMediaTargetIsCurrent(target: PasteMediaUploadTarget): boolean {
		if (selectedWorkspaceId !== target.workspaceId) return false;
		if (!posts.some((post) => post.key === target.postKey)) return false;
		return (
			!target.variantAccountId ||
			(selectedAccountIds.includes(target.variantAccountId) &&
				variants.has(target.variantAccountId))
		);
	}

	function setPasteTargetMediaIds(target: PasteMediaUploadTarget, mediaIds: string[]): void {
		const postIndex = posts.findIndex((post) => post.key === target.postKey);
		if (postIndex < 0) return;
		if (mediaIds.length > 0) void startFirstComposition('media');
		if (target.variantAccountId) {
			setVariantMediaIds(target.variantAccountId, postIndex, mediaIds);
		} else {
			posts = posts.map((post, index) => (index === postIndex ? { ...post, mediaIds } : post));
		}
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function completePastedMediaUpload(
		upload: PasteMediaUploadItem,
		result: MediaUploadResult
	): boolean {
		if (!pasteMediaTargetIsCurrent(upload.target)) return false;
		const currentMediaIds = mediaIdsForPasteTarget(upload.target);
		if (!currentMediaIds.includes(result.id)) {
			const nextMediaIds = mergeMediaIds(currentMediaIds, [result.id]);
			if (!nextMediaIds.includes(result.id)) {
				throw new Error(m.media_upload_too_many({ maximum: composerMediaLimit }));
			}
			setPasteTargetMediaIds(upload.target, nextMediaIds);
		}

		if (result.parent_media_id && ['image_optimization', 'image_fit'].includes(result.source ?? ''))
			imagePreparationSources.set(result.id, result.parent_media_id);
		if (result.source === 'image_optimization') losslessPreparedImageIds.add(result.id);
		const nextMimeTypes = new SvelteMap(mediaMimeTypes);
		nextMimeTypes.set(
			result.id,
			result.mime_type || upload.file.type || 'application/octet-stream'
		);
		mediaMimeTypes = nextMimeTypes;
		const nextSizes = new SvelteMap(mediaSizes);
		nextSizes.set(result.id, result.size || upload.file.size);
		mediaSizes = nextSizes;
		if (result.alt_text) {
			mediaAltTexts = new SvelteMap(mediaAltTexts).set(result.id, result.alt_text);
		}
		pasteMediaAnnouncement = `${upload.file.name}: ${m.media_upload_complete()}`;

		const post = posts.find((candidate) => candidate.key === upload.target.postKey);
		const postContext = upload.target.variantAccountId
			? (getVariantContent(upload.target.variantAccountId, upload.target.postKey) ??
				post?.content ??
				'')
			: (post?.content ?? '');
		void generateMissingMediaAltText([result.id], postContext);
		return true;
	}

	async function prepareNewImageIds(ids: string[], workspaceId: string): Promise<string[] | null> {
		const generation = saveGeneration,
			session = captureQueryMutationSession();
		const controller = new AbortController();
		imagePreparationRequests.add(controller);
		const prepared = [...ids];
		try {
			await hydrateMediaMetadata(workspaceId, ids, true);
			for (const [index, id] of ids.entries()) {
				if (
					!saveMutationViewIsCurrent(session, generation, workspaceId) ||
					controller.signal.aborted
				)
					return null;
				if (mediaMimeTypes.get(id) !== 'image/png') continue;
				try {
					const result = await optimizeStoredImage(id, controller.signal);
					if (
						!saveMutationViewIsCurrent(session, generation, workspaceId) ||
						controller.signal.aborted
					)
						return null;
					if (result) {
						prepared[index] = result.id;
						imagePreparationSources.set(result.id, id);
						losslessPreparedImageIds.add(result.id);
						if (mediaAltTexts.has(id))
							mediaAltTexts = new SvelteMap(mediaAltTexts).set(result.id, mediaAltTexts.get(id)!);
						imagePreparationNotice = m.compose_image_optimized();
					}
				} catch {
					if (controller.signal.aborted) return null;
				}
			}
			await hydrateMediaMetadata(workspaceId, prepared, true);
			return saveMutationViewIsCurrent(session, generation, workspaceId) &&
				!controller.signal.aborted
				? prepared
				: null;
		} finally {
			imagePreparationRequests.delete(controller);
		}
	}

	function imageFitCandidates(account: SocialAccount): string[] {
		const resolved = resolvedCapabilities[account.id];
		if (!resolved) return [];
		const ids = [
			...new Set(posts.flatMap((post) => getVariantMediaIds(account.id, post.key) ?? post.mediaIds))
		];
		return ids.filter(
			(id) =>
				mediaMimeTypes.get(id)?.startsWith('image/') &&
				((resolved.issues ?? []).some(
					(issue) => issue.media_id === id && issue.code.startsWith('media_')
				) ||
					((resolved.media.max_image_size_bytes || resolved.media.max_size_bytes) &&
						(mediaSizes.get(id) ?? 0) >
							Math.min(
								...[resolved.media.max_image_size_bytes, resolved.media.max_size_bytes].filter(
									(n): n is number => !!n && n > 0
								)
							)))
		);
	}

	function imagePreparationInput(mediaId: string): string {
		const seen = new Set<string>();
		while (losslessPreparedImageIds.has(mediaId) && !seen.has(mediaId)) {
			seen.add(mediaId);
			const parent = imagePreparationSources.get(mediaId);
			if (!parent) break;
			mediaId = parent;
		}
		return mediaId;
	}

	async function fitAccountImage(account: SocialAccount, mediaId: string) {
		if (fittingImageId) return;
		const resolved = resolvedCapabilities[account.id];
		if (!resolved) return;
		const workspaceId = selectedWorkspaceId,
			generation = saveGeneration;
		const session = captureQueryMutationSession();
		const sources = posts.flatMap((post) =>
			(getVariantMediaIds(account.id, post.key) ?? post.mediaIds).includes(mediaId)
				? [{ key: post.key, ids: [...(getVariantMediaIds(account.id, post.key) ?? post.mediaIds)] }]
				: []
		);
		const alt = mediaAltTextForAccount(mediaId, account.id);
		const authoredContext = imagePreparationContext;
		pendingImagePreparationContext = authoredContext;
		const controller = new AbortController();
		imagePreparationRequests.add(controller);
		fittingImageId = mediaId;
		error = '';
		try {
			let optimized: MediaUploadResult | null = null;
			if (mediaMimeTypes.get(mediaId) === 'image/png') {
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
							mediaId: imagePreparationInput(mediaId),
							accountId: account.id,
							outputProfile: resolved.output_profile,
							settings: settingsForAccount(account),
							altText: alt,
							signal: controller.signal
						});
			await hydrateMediaMetadata(workspaceId, [result.id], true);
			if (
				!saveMutationViewIsCurrent(session, generation, workspaceId) ||
				controller.signal.aborted ||
				imagePreparationContext !== authoredContext ||
				!selectedAccountIds.includes(account.id) ||
				resolvedCapabilities[account.id]?.output_profile !== resolved.output_profile ||
				sources.some((source) => {
					const post = posts.find((post) => post.key === source.key);
					return (
						!post ||
						!arraysEqual(getVariantMediaIds(account.id, source.key) ?? post.mediaIds, source.ids)
					);
				})
			)
				return;
			// End the fence before applying our own authored mutation.
			pendingImagePreparationContext = null;
			imagePreparationSources.set(result.id, imagePreparationInput(mediaId));
			const preparedSize = mediaPreviewMetadata.get(result.id);
			transferPreparedImageSettings(
				mediaId,
				result.id,
				account.id,
				preparedSize?.width,
				preparedSize?.height
			);
			mediaAltTexts = new SvelteMap(mediaAltTexts).set(
				result.id,
				mediaAltTextForAccount(mediaId, account.id)
			);
			for (const source of sources) {
				const index = posts.findIndex((post) => post.key === source.key);
				setVariantMediaIds(
					account.id,
					index,
					source.ids.map((id) => (id === mediaId ? result.id : id))
				);
			}
			followPreparedImageCaption(mediaId, result.id, account.id);
			validationIssues = [];
			scheduleAutoSave();
			scheduleCapabilityResolve();
			imagePreparationNotice =
				activeVariantAccountId === account.id ? m.compose_image_fit_success() : '';
		} catch (cause) {
			if (saveMutationViewIsCurrent(session, generation, workspaceId) && !controller.signal.aborted)
				error = cause instanceof Error ? cause.message : m.compose_image_fit_failed();
		} finally {
			imagePreparationRequests.delete(controller);
			fittingImageId = '';
			pendingImagePreparationContext = null;
			if (saveMutationViewIsCurrent(session, generation, workspaceId)) scheduleAutoSave();
		}
	}

	// Reuse the in-flight caption request across preparation, retaining explicit edits.
	function followPreparedImageCaption(from: string, to: string, accountId: string | null) {
		const pending = pendingCaptionResults.get(from);
		if (
			!pending ||
			suppressedCaptionMediaIds.has(from) ||
			(accountId && accountCaptionSuppressions.get(from)?.has(accountId))
		)
			return;
		const workspaceId = selectedWorkspaceId,
			generation = saveGeneration,
			session = captureQueryMutationSession();
		if (!pendingCaptionResults.has(to)) pendingCaptionResults.set(to, pending);
		captioningMediaIds.add(to);
		const clear = () => {
			if (pendingCaptionResults.get(to) === pending) {
				pendingCaptionResults.delete(to);
				captioningMediaIds.delete(to);
			}
		};
		void pending.then((result) => {
			clear();
			if (
				!result ||
				!saveMutationViewIsCurrent(session, generation, workspaceId) ||
				suppressedCaptionMediaIds.has(to) ||
				(accountId && accountCaptionSuppressions.get(to)?.has(accountId))
			)
				return;
			const attached = accountId
				? selectedAccountIds.includes(accountId) &&
					posts.some((post) =>
						(getVariantMediaIds(accountId, post.key) ?? post.mediaIds).includes(to)
					)
				: posts.some((post) => post.mediaIds.includes(to));
			if (!attached) return;
			if (accountId) {
				if (mediaAltTextForAccount(to, accountId).trim()) return;
				mediaSettingsByAccount = {
					...mediaSettingsByAccount,
					[to]: {
						...mediaSettingsByAccount[to],
						[accountId]: { ...mediaSettingsByAccount[to]?.[accountId], alt_text: result.alt_text }
					}
				};
			} else {
				if (mediaAltTexts.get(to)?.trim()) return;
				mediaAltTexts = new SvelteMap(mediaAltTexts).set(to, result.alt_text);
			}
			scheduleAutoSave();
		}, clear);
	}

	function transferPreparedImageSettings(
		from: string,
		to: string,
		accountId: string,
		width?: number,
		height?: number,
		restore = false
	) {
		const sourceSize = mediaPreviewMetadata.get(restore ? to : from) ?? {};
		const fittedSize = restore ? (mediaPreviewMetadata.get(from) ?? {}) : { width, height };
		mediaSettingsByAccount = {
			...mediaSettingsByAccount,
			[to]: {
				...mediaSettingsByAccount[to],
				[accountId]: {
					...fittedImageSettings(
						mediaSettingsByAccount[from]?.[accountId] ?? {},
						sourceSize,
						fittedSize,
						restore
					),
					alt_text: mediaAltTextForAccount(from, accountId)
				}
			}
		};
	}

	const restorableImages = $derived.by(() => {
		const ids = [...new Set(posts.flatMap((post) => getEditorMediaIdsForPost(post)))];
		return ids
			.filter((id) => imagePreparationSources.has(id))
			.map((id) => ({ id, number: ids.indexOf(id) + 1 }));
	});

	async function restoreOriginalImage(mediaId: string) {
		const original = imagePreparationSources.get(mediaId);
		if (!original || fittingImageId) return;
		const accountId = activeVariantAccountId;
		// A prepared media id without a per-account variant override belongs to the shared
		// segments; restoring it replaces that attachment for every account, like the
		// shared view does, while preserving per-account settings and captions.
		const overrideAccount = (() => {
			if (!accountId) return null;
			const overridden = posts.some((post) => {
				const variantIds = getVariantMediaIds(accountId, post.key);
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
		const context = imagePreparationContext,
			workspaceId = selectedWorkspaceId,
			generation = saveGeneration;
		const session = captureQueryMutationSession();
		await hydrateMediaMetadata(workspaceId, [original]);
		if (
			!saveMutationViewIsCurrent(session, generation, workspaceId) ||
			(overrideAccount && overrideAccount !== activeVariantAccountId) ||
			context !== imagePreparationContext
		)
			return;
		const alt = overrideAccount
			? mediaAltTextForAccount(mediaId, overrideAccount)
			: (mediaAltTexts.get(mediaId) ?? '');
		if (overrideAccount) {
			transferPreparedImageSettings(mediaId, original, overrideAccount, undefined, undefined, true);
		} else {
			for (const id of selectedAccountIds) {
				if (
					!posts.some(
						(post) => post.mediaIds.includes(mediaId) && getVariantMediaIds(id, post.key) === null
					)
				)
					continue;
				transferPreparedImageSettings(mediaId, original, id, undefined, undefined, true);
				followPreparedImageCaption(mediaId, original, id);
			}
			mediaAltTexts = new SvelteMap(mediaAltTexts).set(original, alt);
		}
		followPreparedImageCaption(mediaId, original, overrideAccount);
		let swappedSharedMedia = false;
		for (let index = 0; index < posts.length; index++) {
			if (overrideAccount) {
				const ids = getEditorMediaIdsForPost(posts[index]);
				if (ids.includes(mediaId))
					setEditorMediaIds(
						index,
						ids.map((id) => (id === mediaId ? original : id))
					);
			} else if (posts[index].mediaIds.includes(mediaId)) {
				// Shared restores keep detached per-account media decisions intact; write
				// through the post owner instead of the active destination variant.
				posts = posts.map((item, postIndex) =>
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
		if (swappedSharedMedia) scheduleAutoSave();
		imagePreparationNotice = '';
	}

	function queueMediaFiles(files: FileList | File[], targetPostIndex = activePostIndex): void {
		if (!selectedWorkspaceId || isSubmitting) return;
		const targetPost = posts[targetPostIndex];
		if (!targetPost || getEditorMediaIdsForPost(targetPost).length >= composerMediaLimit) return;
		const pasteTarget = pasteMediaTargetForPost(targetPost);
		if (pasteTarget && pasteMediaUploadsForTarget(pasteTarget).length > 0) return;
		mediaPickerPostIndex = targetPostIndex;
		mediaPickerInitialMode = 'upload';
		mediaPickerMemeIdea = '';
		mediaPickerMemeCandidate = undefined;
		mediaPickerMemePreview = '';
		mediaPickerInitialFiles = Array.from(files).slice(
			0,
			Math.max(0, composerMediaLimit - getEditorMediaIdsForPost(targetPost).length)
		);
		mediaPickerOpen = true;
	}

	function handlePaste(e: ClipboardEvent, postIndex: number = activePostIndex) {
		const items = e.clipboardData?.items;
		const post = posts[postIndex];
		if (!items || !post || !selectedWorkspaceId || isSubmitting) {
			return;
		}

		const target = pasteMediaTargetForPost(post);
		if (!target) return;
		const targetUploads = pasteMediaUploadsForTarget(target);
		const capacity = availablePasteMediaSlots(
			mediaIdsForPasteTarget(target).length,
			targetUploads.length,
			composerMediaLimit
		);
		const selection = selectPastedImageFiles(
			Array.from(items),
			capacity,
			targetUploads.map((upload) => mediaFileSignature(upload.file))
		);
		if (selection.hasImageFiles && selection.rejected.length > 0) {
			pasteMediaFeedback = {
				targetKey: pasteMediaTargetKey(target),
				messages: uniqueIssueMessages(
					selection.rejected.map(({ file, reason }) => pastedImageRejectionMessage(reason, file))
				)
			};
		} else if (
			selection.hasImageFiles &&
			pasteMediaFeedback?.targetKey === pasteMediaTargetKey(target)
		) {
			pasteMediaFeedback = null;
		}
		if (selection.accepted.length === 0) return;

		e.preventDefault();
		error = '';
		pasteMediaAnnouncement = '';
		if (target.variantAccountId) {
			setVariantMediaIds(target.variantAccountId, postIndex, [...mediaIdsForPasteTarget(target)]);
		}
		pasteMediaUploadQueue.enqueue(selection.accepted, target);
	}

	function handleDragOver(e: DragEvent) {
		e.preventDefault();
		isDraggingFile = true;
	}

	function handleDragLeave(e: DragEvent) {
		e.preventDefault();
		isDraggingFile = false;
	}

	function handleDrop(e: DragEvent, postIndex: number = activePostIndex) {
		e.preventDefault();
		isDraggingFile = false;
		const files = e.dataTransfer?.files;
		if (files && files.length > 0) {
			queueMediaFiles(files, postIndex);
		}
	}

	function removeMedia(postIndex: number, mediaIndex: number) {
		const post = posts[postIndex];
		if (!post) return;
		const mediaIds = getEditorMediaIdsForPost(post);
		const mediaId = mediaIds[mediaIndex];
		if (activeVariantAccountId) {
			setVariantMediaIds(
				activeVariantAccountId,
				postIndex,
				mediaIds.filter((_, mi) => mi !== mediaIndex)
			);
		} else {
			posts = posts.map((p, i) =>
				i === postIndex ? { ...p, mediaIds: p.mediaIds.filter((_, mi) => mi !== mediaIndex) } : p
			);
		}
		const stillAttached =
			mediaId &&
			posts.some(
				(source) =>
					source.mediaIds.includes(mediaId) ||
					[...variants.values()].some((record) => record[source.key]?.mediaIds.includes(mediaId))
			);
		if (mediaId && !stillAttached) {
			captionRequests.get(mediaId)?.abort();
			captionRequests.delete(mediaId);
			captioningMediaIds.delete(mediaId);
			failedCaptionMediaIds.delete(mediaId);
			suppressedCaptionMediaIds.delete(mediaId);
			captionPostContexts.delete(mediaId);
			const newAlts = new SvelteMap(mediaAltTexts);
			newAlts.delete(mediaId);
			mediaAltTexts = newAlts;
			const newMimeTypes = new SvelteMap(mediaMimeTypes);
			newMimeTypes.delete(mediaId);
			mediaMimeTypes = newMimeTypes;
			const newSizes = new SvelteMap(mediaSizes);
			newSizes.delete(mediaId);
			mediaSizes = newSizes;
		}
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function addMediaToPost(postIndex: number, mediaId: string) {
		const post = posts[postIndex];
		if (!post) return;
		if (activeVariantAccountId) {
			setVariantMediaIds(activeVariantAccountId, postIndex, [
				...getEditorMediaIdsForPost(post),
				mediaId
			]);
			return;
		}
		posts = posts.map((p, i) =>
			i === postIndex ? { ...p, mediaIds: [...p.mediaIds, mediaId] } : p
		);
	}

	function snapshotAccountMediaAltTexts(accountId: string, mediaIds: string[]) {
		const next = { ...mediaSettingsByAccount };
		for (const id of mediaIds) {
			if (
				!mediaAltTexts.has(id) &&
				parseComposerSettingOptionalString(next[id]?.[accountId]?.alt_text) === undefined
			)
				continue;
			next[id] = {
				...next[id],
				[accountId]: { ...next[id]?.[accountId], alt_text: mediaAltTextForAccount(id, accountId) }
			};
		}
		mediaSettingsByAccount = next;
	}

	function resetAccountMediaAltTexts(accountId: string) {
		for (const suppressed of accountCaptionSuppressions.values()) suppressed.delete(accountId);
		const next = { ...mediaSettingsByAccount };
		for (const [id, accounts] of Object.entries(next)) {
			if (!accounts[accountId]) continue;
			const settings = { ...accounts[accountId] };
			delete settings.alt_text;
			next[id] = { ...accounts, [accountId]: settings };
		}
		mediaSettingsByAccount = next;
	}

	function setVariantMediaIds(accountId: string, index: number, mediaIds: string[]) {
		const postKey = posts[index]?.key;
		if (!postKey) return;
		const previousIds = getVariantMediaIds(accountId, postKey) ?? posts[index].mediaIds;
		snapshotAccountMediaAltTexts(
			accountId,
			mediaIds.filter((id) => previousIds.includes(id))
		);
		const newVariants = new SvelteMap(variants);
		const record = normalizeVariantRecord(
			newVariants.get(accountId) ?? makeVariantRecord(posts),
			posts
		);
		const current = {
			...record,
			[postKey]: { ...record[postKey], mediaIds, mediaInherited: false }
		};
		newVariants.set(accountId, current);
		variants = newVariants;
	}

	function mediaAltTextForAccount(mediaId: string, accountId: string): string {
		const override = mediaSettingsByAccount[mediaId]?.[accountId]?.alt_text;
		return parseComposerSettingOptionalString(override) ?? mediaAltTexts.get(mediaId) ?? '';
	}

	function setMediaAltText(mediaId: string, alt: string) {
		if (activeVariantAccountId) {
			const suppressed = accountCaptionSuppressions.get(mediaId) ?? new Set<string>();
			suppressed.add(activeVariantAccountId);
			accountCaptionSuppressions.set(mediaId, suppressed);
		} else {
			captionRequests.get(mediaId)?.abort();
			suppressedCaptionMediaIds.add(mediaId);
		}
		failedCaptionMediaIds.delete(mediaId);
		if (activeVariantAccountId) {
			for (let index = 0; index < posts.length; index++) {
				const ids =
					getVariantMediaIds(activeVariantAccountId, posts[index].key) ?? posts[index].mediaIds;
				if (ids.includes(mediaId)) setVariantMediaIds(activeVariantAccountId, index, [...ids]);
			}
			mediaSettingsByAccount = {
				...mediaSettingsByAccount,
				[mediaId]: {
					...mediaSettingsByAccount[mediaId],
					[activeVariantAccountId]: {
						...mediaSettingsByAccount[mediaId]?.[activeVariantAccountId],
						alt_text: alt.trim()
					}
				}
			};
			scheduleAutoSave();
			return;
		}
		mediaAltTexts = new SvelteMap(mediaAltTexts).set(mediaId, alt.trim());
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// AI post builder
	// --------------------------------------------------------------------------
	function aiBuildStorageKey(workspaceID: string): string {
		return `openpost:publication-build:${workspaceID}`;
	}

	function composerAISnapshot(): string {
		return (
			JSON.stringify(aiAttachmentRequirements) +
			composerBuildFingerprint({
				posts,
				variants,
				linkUrl,
				accountIds: selectedAccountIds,
				requestedOutputProfiles,
				formatLockedByAccount
			})
		);
	}

	function selectedAIPlatforms(): string[] {
		return [...new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))];
	}

	function selectedAIAssets(): NonNullable<PublicationBuildRequest['assets']> {
		return [...new Set(posts.flatMap((post) => post.mediaIds))].slice(0, 10).map((mediaID) => ({
			media_id: mediaID,
			role: 'context' as const,
			may_publish: true
		}));
	}

	function parsedAIContextURLs(): string[] {
		return [
			...new Set(
				aiContextURLs
					.split(/\s+/)
					.map((value) => value.trim())
					.filter(Boolean)
			)
		].slice(0, 10);
	}

	function publicationBuildRequest(
		idea: string,
		angle?: PublicationBuildAngle
	): PublicationBuildRequest {
		const buildDirection = angle?.build_direction;
		const request: PublicationBuildRequest = {
			workspace_id: selectedWorkspaceId,
			idea,
			account_ids: [...selectedAccountIds],
			direction: {
				outcome: aiObjective.trim() || buildDirection?.outcome,
				audience: buildDirection?.audience,
				angle: buildDirection?.angle,
				tone_adjustment: aiChangeRequest.trim() || undefined,
				media_preference: buildDirection?.media_preference
			},
			destination_policy: 'require_all'
		};
		if (selectedSocialSetId) request.social_set_id = selectedSocialSetId;
		if (aiVoiceProfileID) request.voice_profile_id = aiVoiceProfileID;
		const contextURLs = parsedAIContextURLs();
		if (contextURLs.length > 0) request.context_urls = contextURLs;
		const privateContextNotes = repurposePrivateContextNotes.trim();
		const contextNotes = [privateContextNotes, aiContextNotes.trim()].filter(Boolean).join('\n\n');
		if (contextNotes) {
			request.context_notes = contextNotes;
			request.context_may_publish = privateContextNotes ? false : aiContextMayPublish;
		}
		const assets = selectedAIAssets();
		if (assets.length > 0) request.assets = assets;
		return request;
	}

	async function loadAIWorkspaceVoice(workspaceID: string): Promise<void> {
		if (!workspaceID) return;
		aiVoiceRequestController?.abort();
		const controller = new AbortController();
		aiVoiceRequestController = controller;
		if (workspaceID === selectedWorkspaceId) {
			aiVoiceName = m.compose_ai_default_voice();
			aiVoiceProfileID = '';
		}
		try {
			const profiles = await queryVoiceProfiles(workspaceID, controller.signal);
			if (workspaceID !== selectedWorkspaceId) return;
			const profile = profiles.find((candidate) => candidate.is_default) ?? profiles[0];
			if (profile) {
				aiVoiceName = profile.name;
				aiVoiceProfileID = '';
			}
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			if (workspaceID !== selectedWorkspaceId) return;
			aiVoiceName = m.compose_ai_default_voice();
			aiVoiceProfileID = '';
		} finally {
			if (aiVoiceRequestController === controller) aiVoiceRequestController = null;
		}
	}

	async function loadPublicationOpportunities(findMore = false): Promise<void> {
		if (!selectedWorkspaceId || selectedAIPlatforms().length === 0) return;
		aiBuildCreateRejected = false;
		aiRequestController?.abort();
		const controller = new AbortController();
		aiRequestController = controller;
		if (aiOpportunitySlowTimer) clearTimeout(aiOpportunitySlowTimer);
		aiOpportunitySlow = false;
		aiOpportunitySlowTimer = setTimeout(() => {
			if (aiRequestController === controller) aiOpportunitySlow = true;
		}, AI_OPPORTUNITY_SLOW_DELAY_MS);
		if (findMore) aiFindingMore = true;
		else aiOpportunityLoading = true;
		postBuilderError = '';
		try {
			const result = await discoverPublicationOpportunities(
				{
					workspace_id: selectedWorkspaceId,
					focus: aiIdeationBrief.trim() || undefined,
					voice_profile_id: aiVoiceProfileID || undefined,
					platforms: selectedAIPlatforms().slice(0, 5),
					limit: 4
				},
				controller.signal
			);
			aiOpportunities = findMore
				? [
						...aiOpportunities,
						...result.opportunities.filter(
							(candidate) => !aiOpportunities.some((current) => current.id === candidate.id)
						)
					].slice(0, 12)
				: result.opportunities;
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_find_ideas_failed();
		} finally {
			if (aiRequestController === controller) {
				if (aiOpportunitySlowTimer) clearTimeout(aiOpportunitySlowTimer);
				aiOpportunitySlowTimer = null;
				aiOpportunitySlow = false;
				aiOpportunityLoading = false;
				aiFindingMore = false;
			}
		}
	}

	async function discoverPublicationIdeas(): Promise<void> {
		aiWorkspaceStep = 'opportunities';
		aiSelectedOpportunityID = '';
		aiGenerationIdea = '';
		await loadPublicationOpportunities();
	}

	async function loadPublicationAngles(idea: string): Promise<void> {
		aiBuildCreateRejected = false;
		aiRequestController?.abort();
		aiRequestController = new AbortController();
		buildingPost = true;
		postBuilderError = '';
		aiWorkspaceStep = 'angles';
		aiAngles = [];
		aiSelectedAngleID = '';
		try {
			const result = await planPublicationAngles(
				publicationBuildRequest(idea),
				aiRequestController.signal
			);
			aiAngles = result.angles;
			const selectedAngle = result.angles.find((angle) => angle.id === 'recommended');
			aiSelectedAngleID = selectedAngle?.id ?? '';
			aiObjective = selectedAngle?.objective ?? '';
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === 'AbortError') return;
			postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_plan_angles_failed();
		} finally {
			buildingPost = false;
		}
	}

	function selectPublicationOpportunity(opportunity: AIOpportunity): void {
		const selected = aiOpportunities.find((candidate) => candidate.id === opportunity.id);
		if (!selected) return;
		aiSelectedOpportunityID = selected.id;
		aiGenerationIdea = [selected.title, selected.hook, selected.why_now]
			.filter(Boolean)
			.join('\n\n');
	}

	async function continuePublicationOpportunity(): Promise<void> {
		if (!aiSelectedOpportunityID || !aiGenerationIdea.trim()) return;
		aiIdeationBrief = aiGenerationIdea;
		await startSelectedPublicationBuild();
	}

	async function buildPostWithAI() {
		if (buildingPost || isThread || activeVariantAccountId || hasPendingPasteMediaUploads) return;
		const sourcePost = posts[0];
		if (!sourcePost || !selectedWorkspaceId) return;
		const workspaceID = selectedWorkspaceId;
		const targetID = publicationId;
		const baseline = composerAISnapshot();
		const request = publicationBuildRequest(sourcePost.content.trim());
		modalApply = async (option, media) => {
			if (
				composerDestroyed ||
				workspaceID !== selectedWorkspaceId ||
				(targetID && targetID !== publicationId) ||
				composerAISnapshot() !== baseline
			) {
				throw new Error(m.compose_ai_progress_conflict());
			}
			aiPendingResult = option;
			aiOptionMedia = media;
			applyReadyPublicationBuild(option.destinations.map((destination) => destination.account_id));
		};
		ideate.show({
			workspaceId: workspaceID,
			contextKey: `composer:${targetID || sourcePost.key}`,
			input: request,
			apply: modalApply
		});
	}

	function persistActivePublicationBuild(
		build: PublicationBuild,
		publicationID = aiBuildPublicationID,
		baseline = aiGenerationBaseline
	): void {
		if (!publicationID) return;
		localStorage.setItem(
			aiBuildStorageKey(build.workspace_id),
			JSON.stringify({ id: build.id, publication_id: publicationID, baseline })
		);
	}

	function clearActivePublicationBuild(): void {
		if (selectedWorkspaceId) localStorage.removeItem(aiBuildStorageKey(selectedWorkspaceId));
		if (aiPollTimer) clearTimeout(aiPollTimer);
		aiPollTimer = null;
		aiBuildPublicationID = '';
		aiActiveBuild = null;
	}

	async function ensureAIBuildPublicationID(workspaceID: string): Promise<string | null> {
		if (publicationId) return publicationId;
		const savedPublicationID = await saveDraft({ allowEmpty: true });
		if (savedPublicationID) return savedPublicationID;
		if (selectedWorkspaceId !== workspaceID) return null;
		postBuilderError = error || m.compose_save_draft_failed();
		return null;
	}

	async function startSelectedPublicationBuild(): Promise<void> {
		if (buildingPost) return;
		const angle = aiAngles.find((candidate) => candidate.id === aiSelectedAngleID);
		const idea = repurposeReviewActive ? aiGenerationIdea : aiIdeationBrief;
		if ((repurposeReviewActive && !angle) || !idea.trim()) return;
		const buildWorkspaceID = selectedWorkspaceId;
		buildingPost = true;
		postBuilderError = '';
		aiBuildCreateRejected = false;
		aiApplyPending = false;
		aiPendingResult = null;
		const buildPublicationID = await ensureAIBuildPublicationID(buildWorkspaceID);
		if (!buildPublicationID) {
			if (selectedWorkspaceId === buildWorkspaceID) {
				buildingPost = false;
				aiBuildCreateRejected = true;
			}
			return;
		}
		if (selectedWorkspaceId !== buildWorkspaceID) return;
		const buildBaseline = composerAISnapshot();
		try {
			const build = await createPublicationBuild(
				{ ...publicationBuildRequest(idea, angle), option_count: repurposeReviewActive ? 0 : 4 },
				`composer-${crypto.randomUUID()}`
			);
			if (
				build.workspace_id !== buildWorkspaceID ||
				selectedWorkspaceId !== buildWorkspaceID ||
				publicationId !== buildPublicationID
			) {
				return;
			}
			aiWorkspaceStep = 'generating';
			aiBuildPublicationID = buildPublicationID;
			aiGenerationBaseline = buildBaseline;
			aiActiveBuild = build;
			persistActivePublicationBuild(build, buildPublicationID, buildBaseline);
			await handlePublicationBuildState(build);
		} catch (cause) {
			if (selectedWorkspaceId !== buildWorkspaceID || publicationId !== buildPublicationID) {
				return;
			}
			buildingPost = false;
			aiWorkspaceStep = 'angles';
			aiBuildCreateRejected = true;
			aiBuildPublicationID = '';
			aiActiveBuild = null;
			postBuilderError =
				cause instanceof Error && cause.message ? cause.message : m.compose_ai_build_failed();
			soundPreferences.play('error');
		}
	}

	async function pollPublicationBuild(id: string): Promise<void> {
		if (aiPollTimer) clearTimeout(aiPollTimer);
		aiPollTimer = setTimeout(async () => {
			try {
				await handlePublicationBuildState(await getPublicationBuild(id));
			} catch (cause) {
				buildingPost = false;
				postBuilderError =
					cause instanceof Error && cause.message
						? cause.message
						: m.compose_ai_check_build_failed();
			}
		}, 1200);
	}

	async function handlePublicationBuildState(build: PublicationBuild): Promise<void> {
		if (
			build.workspace_id !== selectedWorkspaceId ||
			!aiBuildPublicationID ||
			aiBuildPublicationID !== publicationId
		) {
			return;
		}
		aiActiveBuild = build;
		if (build.state === 'queued' || build.state === 'building') {
			buildingPost = true;
			persistActivePublicationBuild(build);
			await pollPublicationBuild(build.id);
			return;
		}
		buildingPost = false;
		if (build.state === 'ready' && build.result) {
			if (build.result.options?.length) {
				aiPostOptions = structuredClone(build.result.options);
				aiPendingResult = build.result;
				aiWorkspaceStep = 'options';
				aiWorkspaceOpen = true;
				return;
			}
			aiPendingResult = build.result;
			if (aiGenerationBaseline && composerAISnapshot() !== aiGenerationBaseline) {
				aiApplyPending = true;
				aiWorkspaceOpen = true;
				aiWorkspaceStep = 'generating';
				return;
			}
			applyReadyPublicationBuild();
			return;
		}
		if (build.state === 'failed') {
			postBuilderError = build.error_message || m.compose_ai_build_failed();
			soundPreferences.play('error');
			return;
		}
		if (build.state === 'cancelled') {
			clearActivePublicationBuild();
			aiWorkspaceOpen = false;
		}
	}

	async function useAIPostOption(option: PublicationPostOption): Promise<void> {
		if (buildingPost) return;
		const workspaceID = selectedWorkspaceId;
		const expectedPublicationID = publicationId;
		buildingPost = true;
		postBuilderError = '';
		const mediaByAccount: Record<string, string[]> = {};
		try {
			const saved = new Map<string, string>();
			for (const destination of option.destinations) {
				mediaByAccount[destination.account_id] = [];
				if (
					destination.media.treatment === 'use_source' &&
					destination.media.source_ref?.startsWith('media:')
				)
					mediaByAccount[destination.account_id] = [destination.media.source_ref.slice(6)];
				const recipe = destination.media.document;
				if (!recipe) continue;
				const key = JSON.stringify(recipe);
				let id = saved.get(key);
				if (!id) {
					const visual = await renderPostVisual(workspaceID, recipe);
					try {
						id = (await savePostVisual(workspaceID, visual, destination.media.alt_text ?? '')).id;
					} finally {
						releasePostVisual(visual);
					}
					saved.set(key, id);
				}
				if (workspaceID !== selectedWorkspaceId || expectedPublicationID !== publicationId) return;
				mediaByAccount[destination.account_id] = [id];
			}
			aiOptionMedia = mediaByAccount;
			aiPendingResult = option;
			if (aiGenerationBaseline && composerAISnapshot() !== aiGenerationBaseline) {
				aiApplyPending = true;
				aiWorkspaceStep = 'generating';
				return;
			}
			applyReadyPublicationBuild();
		} catch (cause) {
			if (workspaceID === selectedWorkspaceId)
				postBuilderError = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		} finally {
			if (workspaceID === selectedWorkspaceId) buildingPost = false;
		}
	}

	function captureAIComposerCheckpoint(): AIComposerCheckpoint {
		return {
			selectedAccountIds: [...selectedAccountIds],
			selectedSocialSetId,
			posts: posts.map((post) => ({ ...post, mediaIds: [...post.mediaIds] })),
			variants: Array.from(variants.entries()).map(([accountID, record]) => [
				accountID,
				structuredClone(record)
			]),
			linkUrl,
			requestedOutputProfiles: { ...requestedOutputProfiles },
			formatLockedByAccount: { ...formatLockedByAccount },
			strategies: structuredClone(aiAppliedStrategies),
			attachmentRequirements: structuredClone(aiAttachmentRequirements)
		};
	}

	function restoreAIComposerCheckpoint(checkpoint: AIComposerCheckpoint): void {
		selectedAccountIds = [...checkpoint.selectedAccountIds];
		selectedSocialSetId = checkpoint.selectedSocialSetId;
		posts = checkpoint.posts.map((post) => ({ ...post, mediaIds: [...post.mediaIds] }));
		variants = new SvelteMap(
			checkpoint.variants.map(([accountID, record]) => [accountID, structuredClone(record)])
		);
		linkUrl = checkpoint.linkUrl;
		requestedOutputProfiles = { ...checkpoint.requestedOutputProfiles };
		formatLockedByAccount = { ...checkpoint.formatLockedByAccount };
		aiAppliedStrategies = structuredClone(checkpoint.strategies);
		aiAttachmentRequirements = structuredClone(checkpoint.attachmentRequirements);
		aiAppliedResult = null;
		aiMemeCandidates = [];
		aiMemeError = '';
		postBuilderError = '';
		activePostIndex = 0;
		activeVariantAccountId = null;
		void resolveCapabilities();
		scheduleAutoSave();
	}

	function applyReadyPublicationBuild(destinations?: string[]): void {
		const result = aiPendingResult;
		const sourcePost = posts[0];
		if (!result || !sourcePost) return;
		const checkpoint = captureAIComposerCheckpoint();
		if (!generationUndo) generationUndo = checkpoint;
		latestGenerationUndo = checkpoint;
		if (destinations) {
			selectedAccountIds = destinations;
			selectedSocialSetId = '';
		}
		const applied = applyPublicationBuildResult(result, sourcePost, aiOptionMedia);
		posts = applied.posts;
		variants = new SvelteMap(Object.entries(applied.variants));
		requestedOutputProfiles = {
			...requestedOutputProfiles,
			...applied.requestedOutputProfiles
		};
		formatLockedByAccount = { ...formatLockedByAccount, ...applied.formatLockedByAccount };
		activePostIndex = 0;
		activeVariantAccountId = null;
		linkUrl = firstComposerURL(posts[0]?.content ?? '');
		aiAttachmentRequirements = Object.fromEntries(
			result.destinations.flatMap((destination) => {
				const kind =
					destination.media.treatment === 'attach_image'
						? 'image'
						: destination.media.treatment === 'attach_video'
							? 'video'
							: '';
				return kind
					? [
							[
								destination.account_id,
								attachmentRequirementSchema.parse({ kind, brief: destination.media.brief })
							]
						]
					: [];
			})
		);
		aiAppliedResult = result;
		aiAppliedStrategies = result.destinations.map((destination) => ({
			account_id: destination.account_id,
			platform: destination.platform,
			objective: destination.objective,
			archetype: destination.archetype,
			media: structuredClone(destination.media),
			warnings: destination.warnings ? [...destination.warnings] : undefined
		}));
		aiApplyPending = false;
		aiPendingResult = null;
		aiWorkspaceOpen = false;
		clearActivePublicationBuild();
		postBuilderError = (result.skipped ?? [])
			.map((destination) => `${getPlatformName(destination.platform)}: ${destination.reason}`)
			.join(' ');
		if (!aiOptionMedia) void loadAIMemeRecommendations(result);
		aiPostOptions = [];
		aiOptionMedia = undefined;
		void startFirstComposition('text');
		void resolveCapabilities();
		soundPreferences.play('success');
		scheduleAutoSave();
	}

	function aiMemeRecipe(candidate: AIMemeRecommendationCandidate) {
		return {
			workspaceId: selectedWorkspaceId,
			templateId: candidate.suggestion.template_id,
			captions: candidate.suggestion.caption_lines,
			overlayMediaIds: [],
			format: 'png' as const,
			altText: candidate.suggestion.alt_text
		};
	}

	async function previewAIMemeCandidate(
		candidate: AIMemeRecommendationCandidate,
		generation = aiMemeRequestGeneration,
		workspaceID = aiMemeWorkspaceID
	): Promise<void> {
		if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
		aiMemeCandidates = aiMemeCandidates.map((current) =>
			current.id === candidate.id ? { ...current, previewState: 'loading' } : current
		);
		try {
			const preview = await previewMeme(aiMemeRecipe(candidate));
			if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
			aiMemeCandidates = aiMemeCandidates.map((current) =>
				current.id === candidate.id
					? { ...current, previewUrl: memePreviewDataURL(preview), previewState: 'ready' }
					: current
			);
		} catch {
			if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
			aiMemeCandidates = aiMemeCandidates.map((current) =>
				current.id === candidate.id ? { ...current, previewState: 'failed' } : current
			);
		}
	}

	async function loadAIMemeRecommendations(result: PublicationBuildResult): Promise<void> {
		const generation = ++aiMemeRequestGeneration;
		const workspaceID = selectedWorkspaceId;
		const memeDestinations = result.destinations.filter(
			(destination) => destination.media.treatment === 'meme'
		);
		aiMemeCandidates = [];
		aiMemeTargetAccountIDs = [];
		aiMemeWorkspaceID = '';
		aiMemeError = '';
		if (memeDestinations.length === 0) {
			return;
		}
		const targetAccountIDs = memeDestinations.map((destination) => destination.account_id);
		aiMemeTargetAccountIDs = targetAccountIDs;
		aiMemeWorkspaceID = workspaceID;
		try {
			const suggestions = await suggestMemes({
				workspaceId: workspaceID,
				idea: [result.direction.angle, memeDestinations[0]?.media.brief]
					.filter(Boolean)
					.join('\n\n'),
				tone: 'balanced',
				language: getLocaleTag(),
				count: 3
			});
			if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
			aiMemeCandidates = suggestions.candidates.slice(0, 3).map((suggestion, index) => ({
				id: `${suggestion.template_id}:${index}`,
				suggestion,
				previewState: 'loading'
			}));
			aiMemeSelectedID = aiMemeCandidates[0]?.id ?? '';
			for (let index = 0; index < aiMemeCandidates.length; index += 2) {
				await Promise.all(
					aiMemeCandidates
						.slice(index, index + 2)
						.map((candidate) => previewAIMemeCandidate(candidate, generation, workspaceID))
				);
			}
		} catch (cause) {
			if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
			aiMemeError = cause instanceof Error ? cause.message : m.compose_ai_meme_unavailable();
		}
	}

	function canAttachAIMemeToTargets(
		targetAccountIDs = aiMemeTargetAccountIDs,
		workspaceID = aiMemeWorkspaceID,
		mediaID = ''
	): boolean {
		aiMemeError = '';
		const post = posts[0];
		if (
			!post ||
			targetAccountIDs.length === 0 ||
			workspaceID !== selectedWorkspaceId ||
			targetAccountIDs.some((accountID) => !selectedAccountIds.includes(accountID))
		) {
			aiMemeError = aiMemeCopy.actionFailed;
			return false;
		}
		for (const accountID of targetAccountIDs) {
			const record = normalizeVariantRecord(variants.get(accountID), posts);
			const current = record[post.key];
			const currentMediaIDs = current?.mediaInherited === false ? current.mediaIds : post.mediaIds;
			if (!currentMediaIDs.includes(mediaID) && currentMediaIDs.length >= composerMediaLimit) {
				const account = accounts.find((candidate) => candidate.id === accountID);
				aiMemeError = m.compose_ai_meme_remove_media({
					account: account ? accountContextLabel(account) : m.compose_ai_this_destination()
				});
				return false;
			}
		}
		return true;
	}

	async function attachAIMemeToTargets(
		mediaID: string,
		targetAccountIDs = aiMemeTargetAccountIDs,
		workspaceID = aiMemeWorkspaceID
	): Promise<boolean> {
		if (!mediaID || !canAttachAIMemeToTargets(targetAccountIDs, workspaceID, mediaID)) return false;
		const post = posts[0];
		if (!post) return false;
		const context = imagePreparationContext;
		const prepared = await prepareNewImageIds([mediaID], workspaceID);
		if (
			!prepared ||
			context !== imagePreparationContext ||
			!canAttachAIMemeToTargets(targetAccountIDs, workspaceID, prepared[0])
		)
			return false;
		mediaID = prepared[0];
		const nextVariants = new SvelteMap(variants);
		for (const accountID of targetAccountIDs) {
			const record = normalizeVariantRecord(nextVariants.get(accountID), posts);
			const current = record[post.key];
			const currentMediaIDs = current?.mediaInherited === false ? current.mediaIds : post.mediaIds;
			record[post.key] = {
				...current,
				mediaIds: [...new Set([...currentMediaIDs, mediaID])],
				mediaInherited: false
			};
			nextVariants.set(accountID, record);
		}
		variants = nextVariants;
		await hydrateMediaMetadata(selectedWorkspaceId, [mediaID], true);
		void generateMissingMediaAltText([mediaID], post.content);
		scheduleAutoSave();
		return true;
	}

	async function useAIMeme(candidate: AIMemeRecommendationCandidate): Promise<void> {
		const generation = aiMemeRequestGeneration;
		const workspaceID = aiMemeWorkspaceID;
		const targetAccountIDs = [...aiMemeTargetAccountIDs];
		if (!canAttachAIMemeToTargets(targetAccountIDs, workspaceID)) return;
		const rendered = await renderMeme(aiMemeRecipe(candidate));
		if (generation !== aiMemeRequestGeneration || workspaceID !== selectedWorkspaceId) return;
		if (!(await attachAIMemeToTargets(rendered.media.id, targetAccountIDs, workspaceID))) return;
		aiMemeCandidates = [];
		soundPreferences.play('success');
	}

	function editAIMeme(candidate: AIMemeRecommendationCandidate): void {
		if (!canAttachAIMemeToTargets(aiMemeTargetAccountIDs, aiMemeWorkspaceID)) return;
		mediaPickerPostIndex = 0;
		mediaPickerInitialFiles = [];
		mediaPickerInitialMode = 'meme';
		mediaPickerMemeIdea = aiGenerationIdea;
		mediaPickerMemeCandidate = candidate.suggestion;
		mediaPickerMemePreview = candidate.previewUrl ?? '';
		mediaPickerMemeTargetAccountIDs = [...aiMemeTargetAccountIDs];
		mediaPickerMemeRequestGeneration = aiMemeRequestGeneration;
		mediaPickerOpen = true;
	}

	function keepCurrentComposerEdits(): void {
		aiApplyPending = false;
		aiPendingResult = null;
		aiWorkspaceOpen = false;
		clearActivePublicationBuild();
	}

	async function cancelActivePublicationBuild(): Promise<void> {
		if (!aiActiveBuild) return;
		aiCancelling = true;
		try {
			await handlePublicationBuildState(await cancelPublicationBuild(aiActiveBuild.id));
		} catch (cause) {
			postBuilderError =
				cause instanceof Error ? cause.message : m.compose_ai_cancel_build_failed();
		} finally {
			aiCancelling = false;
		}
	}

	async function retryActivePublicationBuild(): Promise<void> {
		if (!aiActiveBuild) return;
		postBuilderError = '';
		buildingPost = true;
		try {
			await handlePublicationBuildState(await retryPublicationBuild(aiActiveBuild.id));
		} catch (cause) {
			buildingPost = false;
			postBuilderError = cause instanceof Error ? cause.message : m.compose_ai_build_failed();
		}
	}

	async function restoreActivePublicationBuild(): Promise<void> {
		if (!selectedWorkspaceId) return;
		const saved = localStorage.getItem(aiBuildStorageKey(selectedWorkspaceId));
		if (!saved) return;
		try {
			const parsed = z
				.object({
					id: z.string().min(1),
					publication_id: z.string().min(1),
					baseline: z.string().optional()
				})
				.safeParse(JSON.parse(saved));
			if (!parsed.success) {
				localStorage.removeItem(aiBuildStorageKey(selectedWorkspaceId));
				return;
			}
			if (parsed.data.publication_id !== publicationId) return;
			aiBuildPublicationID = parsed.data.publication_id;
			aiGenerationBaseline = parsed.data.baseline ?? '';
			aiWorkspaceEntry = posts[0]?.content.trim() ? 'build' : 'ideate';
			aiWorkspaceStep = 'generating';
			aiWorkspaceOpen = true;
			await handlePublicationBuildState(await getPublicationBuild(parsed.data.id));
		} catch {
			clearActivePublicationBuild();
		}
	}

	function restoreIdea() {
		if (!generationUndo) return;
		restoreAIComposerCheckpoint(generationUndo);
		generationUndo = null;
		latestGenerationUndo = null;
	}

	function undoLatestGenerationApply() {
		if (!latestGenerationUndo) return;
		const restoresOriginalIdea = latestGenerationUndo === generationUndo;
		restoreAIComposerCheckpoint(latestGenerationUndo);
		latestGenerationUndo = null;
		if (restoresOriginalIdea) generationUndo = null;
	}

	function convertGeneratedThreadToPost(): void {
		if (!generationUndo || posts.length < 2) return;
		if (posts.slice(1).some((post) => post.poll)) {
			error = m.compose_poll_join_conflict();
			return;
		}
		const source = posts[0];
		let joinedSource: PostItem;
		const nextVariants = new SvelteMap<string, Record<string, VariantPost>>();
		try {
			const joined = joinPostText(
				posts.map((post) => ({ body: post.content, mentions: post.mentions?.spans }))
			);
			joinedSource = {
				...source,
				content: joined.body,
				mentions:
					joined.mentions === undefined ? undefined : { version: 1, spans: joined.mentions },
				mediaIds: [...new Set(posts.flatMap((post) => post.mediaIds))]
			};
			for (const [accountID, record] of variants.entries()) {
				const values = posts.map(
					(post) =>
						record[post.key] ?? {
							content: post.content,
							mentions: post.mentions,
							mediaIds: post.mediaIds,
							contentInherited: true,
							mediaInherited: true
						}
				);
				const projected = joinPostText(
					values.map((value, index) => ({
						body: value.contentInherited ? posts[index].content : value.content,
						mentions: (value.contentInherited ? posts[index].mentions : value.mentions)?.spans
					}))
				);
				nextVariants.set(accountID, {
					[joinedSource.key]: {
						content: projected.body,
						mentions:
							projected.mentions === undefined
								? undefined
								: { version: 1, spans: projected.mentions },
						mediaIds: [...new Set(values.flatMap((value) => value.mediaIds))],
						contentInherited: values.every((value) => value.contentInherited),
						mediaInherited: values.every((value) => value.mediaInherited)
					}
				});
			}
		} catch {
			error = m.editor_mention_limit();
			return;
		}
		posts = [joinedSource];
		variants = nextVariants;
		activePostIndex = 0;
		linkUrl = firstComposerURL(joinedSource.content);
		void resolveCapabilities();
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// Variants
	// --------------------------------------------------------------------------
	function handleVariantChange(
		accountId: string,
		index: number,
		value: string,
		mentions?: MentionMetadata
	) {
		const newVariants = new SvelteMap(variants);
		const postKey = posts[index]?.key;
		if (!postKey) return;
		const current = {
			...normalizeVariantRecord(newVariants.get(accountId), posts),
			[postKey]: {
				...(normalizeVariantRecord(newVariants.get(accountId), posts)[postKey] ?? {
					content: posts[index].content,
					mediaIds: [...posts[index].mediaIds]
				}),
				content: value,
				mentions:
					mentions ??
					remapMentionMetadata(
						getVariantContent(accountId, postKey) ?? posts[index].content,
						value,
						normalizeVariantRecord(newVariants.get(accountId), posts)[postKey]?.mentions
					),
				contentInherited: false
			}
		};
		newVariants.set(accountId, current);
		variants = newVariants;
		scheduleAutoSave();
	}

	function activateVariantTab(accountId: string | null) {
		activeVariantAccountId = accountId;
		previewMediaOpen = false;
		previewPollEditingKeys.clear();
	}

	function unsyncAccount(accountId: string) {
		if (!variants.has(accountId)) {
			variants = new Map([...variants, [accountId, makeVariantRecord(posts)]]);
		}
		activeVariantAccountId = accountId;
		scheduleAutoSave();
	}

	function editAccountVersion(accountId: string) {
		if (variants.has(accountId)) {
			activateVariantTab(accountId);
			return;
		}
		unsyncAccount(accountId);
	}

	function detachSharedContent(accountId: string) {
		const record = normalizeVariantRecord(variants.get(accountId), posts);
		for (const post of posts) {
			const variant = record[post.key];
			variant.content = getVariantContent(accountId, post.key) ?? post.content;
			variant.mediaIds = [...(getVariantMediaIds(accountId, post.key) ?? post.mediaIds)];
			variant.contentInherited = false;
			variant.mediaInherited = false;
			snapshotAccountMediaAltTexts(accountId, variant.mediaIds);
		}
		variants = new SvelteMap(variants).set(accountId, record);
		scheduleAutoSave();
	}

	function restoreSharedContent(account: SocialAccount) {
		const key = nativeDescriptionKey(account);
		if (key) updateAccountSetting(account, key, '');
		resyncAccount(account.id);
	}

	function resyncAccount(accountId: string) {
		resetAccountMediaAltTexts(accountId);
		if (!variants.has(accountId)) return;
		pasteMediaUploadQueue.discardWhere((upload) => upload.target.variantAccountId === accountId);
		const nextVariants = new SvelteMap(variants);
		nextVariants.delete(accountId);
		variants = nextVariants;
		scheduleAutoSave();
	}

	function variantHasContentOverride(accountId: string): boolean {
		return Object.values(variants.get(accountId) ?? {}).some(
			(variant) => !variant.contentInherited
		);
	}

	function variantHasMediaOverride(accountId: string): boolean {
		return Object.values(variants.get(accountId) ?? {}).some((variant) => !variant.mediaInherited);
	}

	function resetVariantField(accountId: string, field: 'content' | 'media') {
		const existing = variants.get(accountId);
		if (!existing) return;
		if (field === 'media') {
			resetAccountMediaAltTexts(accountId);
			pasteMediaUploadQueue.discardWhere((upload) => upload.target.variantAccountId === accountId);
		}
		const nextRecord = normalizeVariantRecord(existing, posts);
		for (const post of posts) {
			const variant = nextRecord[post.key];
			if (!variant) continue;
			if (field === 'content') {
				variant.content = post.content;
				variant.contentInherited = true;
			} else {
				variant.mediaIds = [...post.mediaIds];
				variant.mediaInherited = true;
			}
		}
		if (
			Object.values(nextRecord).every(
				(variant) => variant.contentInherited && variant.mediaInherited
			)
		) {
			resyncAccount(accountId);
			return;
		}
		variants = new SvelteMap(variants).set(accountId, nextRecord);
		scheduleAutoSave();
	}

	function openDestinationAction(action: 'copy' | 'media') {
		if (!activeVariantAccountId) return;
		if (hasPendingPasteMediaUploads) {
			error = pasteMediaUploadBlocker();
			return;
		}
		destinationAction = action;
		destinationCopyError = '';
		destinationActionTargetIds = selectedAccountIds.filter(
			(accountId) => accountId !== activeVariantAccountId
		);
		destinationActionOpen = true;
	}

	function toggleDestinationActionTarget(accountId: string) {
		if (hasPendingPasteMediaUploads || !selectedAccountIds.includes(accountId)) return;
		destinationCopyError = '';
		destinationActionTargetIds = destinationActionTargetIds.includes(accountId)
			? destinationActionTargetIds.filter((id) => id !== accountId)
			: [...destinationActionTargetIds, accountId];
	}

	function inheritedVariantRecord(): Record<string, VariantPost> {
		return makeVariantRecord(posts);
	}

	function applyDestinationAction() {
		const sourceAccountId = activeVariantAccountId;
		if (hasPendingPasteMediaUploads) {
			error = pasteMediaUploadBlocker();
			return;
		}
		if (!sourceAccountId || !selectedAccountIds.includes(sourceAccountId)) {
			destinationActionOpen = false;
			return;
		}
		const currentTargetIds = destinationActionTargetIds.filter(
			(accountId) => accountId !== sourceAccountId && selectedAccountIds.includes(accountId)
		);
		destinationActionTargetIds = currentTargetIds;
		if (currentTargetIds.length === 0) return;
		const source = normalizeVariantRecord(
			variants.get(sourceAccountId) ?? inheritedVariantRecord(),
			posts
		);
		if (
			destinationAction === 'copy' &&
			currentTargetIds.some((targetId) => {
				const account = selectedAccounts.find((account) => account.id === targetId);
				return posts.some((post) => {
					const variant = source[post.key];
					const metadata = variant?.contentInherited ? post.mentions : variant?.mentions;
					return metadata?.spans.some(
						(span) =>
							(span.target.provider !== 'workspace' &&
								span.target.provider !== account?.platform) ||
							(span.target.provider === 'mastodon' &&
								span.target.authority?.replace(/\/$/, '').toLowerCase() !==
									account?.instance_url?.replace(/\/$/, '').toLowerCase())
					);
				});
			})
		) {
			destinationCopyError = m.compose_copy_mentions_incompatible();
			return;
		}
		const nextVariants = new SvelteMap(variants);
		const nextSchedules = { ...scheduleOverridesByAccount };

		for (const targetId of currentTargetIds) {
			const target = normalizeVariantRecord(
				nextVariants.get(targetId) ?? inheritedVariantRecord(),
				posts
			);
			for (const post of posts) {
				const sourceVariant = source[post.key];
				const targetVariant = target[post.key];
				if (!sourceVariant || !targetVariant) continue;
				if (destinationAction === 'copy') {
					targetVariant.content = sourceVariant.contentInherited
						? post.content
						: sourceVariant.content;
					targetVariant.contentInherited = sourceVariant.contentInherited;
					targetVariant.mentions = sourceVariant.contentInherited
						? post.mentions
						: (sourceVariant.mentions ?? { version: 1, spans: [] });
				}
				targetVariant.mediaIds = sourceVariant.mediaInherited
					? [...post.mediaIds]
					: [...sourceVariant.mediaIds];
				targetVariant.mediaInherited = sourceVariant.mediaInherited;
			}
			if (
				Object.values(target).every((variant) => variant.contentInherited && variant.mediaInherited)
			) {
				nextVariants.delete(targetId);
			} else {
				nextVariants.set(targetId, target);
			}
			if (destinationAction === 'copy') {
				if (scheduleOverridesByAccount[sourceAccountId]) {
					nextSchedules[targetId] = scheduleOverridesByAccount[sourceAccountId];
				} else {
					delete nextSchedules[targetId];
				}
			}
		}

		variants = nextVariants;
		scheduleOverridesByAccount = nextSchedules;
		destinationActionOpen = false;
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// Scheduling
	// --------------------------------------------------------------------------
	function openScheduleDialog() {
		if (!selectedWorkspaceSettingsReady) {
			error = m.compose_load_workspace_settings_failed();
			workspaceSettingsError = error;
			return;
		}
		scheduleInputError = '';
		showScheduleDialog = true;
	}

	async function fillNextSlot(showComposerError = false): Promise<boolean> {
		if (!selectedWorkspaceId) return false;
		if (!selectedWorkspaceSettingsReady) {
			workspaceSettingsError = m.compose_load_workspace_settings_failed();
			if (showComposerError) error = workspaceSettingsError;
			return false;
		}
		const requestSequence = ++nextSlotRequestSequence;
		const workspaceId = selectedWorkspaceId;
		const timeZone = scheduleTimezoneLabel;
		suggestingSlot = true;
		try {
			const { data, error: err } = await client.GET('/posting-schedules/next-slot', {
				params: {
					query: { workspace_id: workspaceId }
				}
			});
			if (
				requestSequence !== nextSlotRequestSequence ||
				selectedWorkspaceId !== workspaceId ||
				scheduleTimezoneLabel !== timeZone
			) {
				return false;
			}
			if (err) throw err;
			if (data?.slot_time) {
				// Parse date directly from ISO string to avoid timezone conversion issues
				const iso = data.slot_time;
				const [datePart, timePart] = iso.split('T');
				const [year, month, day] = datePart.split('-').map(Number);
				const rawHours = parseInt(timePart.split(':')[0], 10);
				const rawMinutes = parseInt(timePart.split(':')[1], 10);

				selectedDate = new CalendarDate(year, month, day);
				selectedTime = `${rawHours.toString().padStart(2, '0')}:${rawMinutes.toString().padStart(2, '0')}`;

				// Guard: if the slot is in the past, advance by one day
				const slotInstant = workspaceScheduleToISO(selectedDate, selectedTime, timeZone);
				if (!slotInstant) {
					scheduleInputError = m.compose_invalid_timezone_time();
					if (showComposerError) error = scheduleInputError;
					return false;
				}
				if (slotInstant && new Date(slotInstant).getTime() <= Date.now()) {
					selectedDate = selectedDate.add({ days: 1 });
				}
				scheduleInputError = '';
				return true;
			}
			scheduleInputError = m.compose_no_free_slot();
			if (showComposerError) {
				error = scheduleInputError;
			}
		} catch (e) {
			if (requestSequence !== nextSlotRequestSequence || selectedWorkspaceId !== workspaceId) {
				return false;
			}
			console.error('Failed to get next available slot:', e);
			scheduleInputError = m.compose_next_free_slot_failed();
			if (showComposerError) {
				error = scheduleInputError;
			}
		} finally {
			if (requestSequence === nextSlotRequestSequence) suggestingSlot = false;
		}
		return false;
	}

	async function suggestNextSlot() {
		await fillNextSlot(false);
	}

	async function quickSchedule() {
		if (selectedDate && selectedTime) {
			showScheduleDialog = false;
			await publish(false);
			return;
		}

		const didApplySlot = await fillNextSlot(true);
		if (!didApplySlot) return;
		showScheduleDialog = false;
		await publish(false);
	}

	function formatScheduledDisplay(): string {
		if (!selectedDate) return m.compose_schedule();
		const now = workspaceClock(scheduleTimezoneLabel).date;
		const diffDays = selectedDate.compare(now);
		const timeSuffix = selectedTime ? ` ${selectedTime}` : '';

		if (diffDays === 0) return `${m.common_today()}${timeSuffix}`;
		if (diffDays === 1) return `${m.common_tomorrow()}${timeSuffix}`;
		const date = selectedDate.toDate(scheduleTimezoneLabel);
		return `${date.toLocaleDateString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			timeZone: scheduleTimezoneLabel
		})}${timeSuffix}`;
	}

	// --------------------------------------------------------------------------
	// Snippets
	// --------------------------------------------------------------------------
	function nativePreviewTitle(account: SocialAccount): string | undefined {
		const provider = getPlatformKey(account.platform);
		if (!['youtube', 'peertube', 'pinterest', 'lemmy', 'piefed', 'reddit'].includes(provider))
			return undefined;
		const values = settingsForAccount(account);
		return String(
			values.title ||
				values.video_title ||
				values.pin_title ||
				posts[0]?.content.split('\n')[0] ||
				''
		);
	}

	function nativeDescriptionKey(account: SocialAccount): string | undefined {
		const provider = getPlatformKey(account.platform);
		if (provider === 'youtube' || provider === 'peertube') return 'description';
		if (provider === 'facebook' && ['video', 'reel'].includes(previewForAccount(account).format))
			return 'video_description';
		return undefined;
	}
	function joinedDescriptionKey(account: SocialAccount): string | undefined {
		return posts.length > 1 && resolvedCapabilities[account.id]?.segment_strategy === 'join'
			? nativeDescriptionKey(account)
			: undefined;
	}
	function nativeHasCustomText(account: SocialAccount): boolean {
		const key = nativeDescriptionKey(account);
		return (
			variantHasContentOverride(account.id) || Boolean(key && settingsByAccount[account.id]?.[key])
		);
	}
	function nativeEditableText(post: PostItem): string {
		if (activeVariantAccount && posts.indexOf(post) === 0) {
			const key = nativeDescriptionKey(activeVariantAccount);
			const value = key
				? parseComposerSettingOptionalString(settingsByAccount[activeVariantAccount.id]?.[key])
				: undefined;
			if (value) return value;
		}
		if (activeVariantAccount && joinedDescriptionKey(activeVariantAccount))
			return authoredJoinedBody(activeVariantAccount);
		return getEditorContentForPost(post);
	}
	function resetNativeField(account: SocialAccount, field: 'content' | 'media') {
		if (field === 'content') {
			const key = nativeDescriptionKey(account);
			const hasCaptionOverride = Boolean(key && settingsByAccount[account.id]?.[key]);
			const resetCaptionOnly = Boolean(
				joinedDescriptionKey(account) &&
				hasCaptionOverride &&
				!variantHasContentOverride(account.id)
			);
			if (key && hasCaptionOverride) updateAccountSetting(account, key, '');
			if (resetCaptionOnly) return;
		}
		resetVariantField(account.id, field);
	}

	function initialLinkDraft(post: PostItem): LinkDraft {
		return {
			destinations: Object.fromEntries(
				selectedAccounts.map((account) => {
					const values = {
						...settingsByAccount[account.id],
						...segmentSettingsByPost[post.key]?.[account.id]
					};
					return [account.id, { mode: values.url || values.link_url ? 'legacy' : 'post' }];
				})
			)
		};
	}
	function authoredJoinedBody(account: SocialAccount): string {
		return posts
			.map((post) => (getVariantContent(account.id, post.key) ?? post.content).trim())
			.filter(Boolean)
			.join('\n\n');
	}
	function previewLinkURL(post: PostItem, account: SocialAccount): string {
		const body = getVariantContent(account.id, post.key) ?? post.content;
		const mediaCount = (getVariantMediaIds(account.id, post.key) ?? post.mediaIds).length;
		const values = {
			...settingsForAccount(account),
			...segmentSettingsByPost[post.key]?.[account.id]
		};
		const provider = getPlatformKey(account.platform);
		if (mediaCount && (provider !== 'bluesky' || linkChoice(post.link, account.id).mode === 'post'))
			return '';
		if (
			post.poll &&
			['native', 'custom'].includes(post.poll.destinations[account.id]?.mode ?? '') &&
			provider !== 'bluesky'
		)
			return '';
		return linkURL(post.link, account.id, body, values);
	}
	function joinedPreviewLinkURL(account: SocialAccount): string {
		return linkURL(
			posts[0]?.link,
			account.id,
			authoredJoinedBody(account),
			settingsForAccount(account)
		);
	}
	function previewSourcePosts(segment: PreviewSegment): PostItem[] {
		if (activeVariantAccount && joinedDescriptionKey(activeVariantAccount))
			return posts.slice(0, 1);
		if (
			activeVariantAccount &&
			posts.length > 1 &&
			resolvedCapabilities[activeVariantAccount.id]?.segment_strategy === 'join'
		)
			return posts;
		const post = posts.find((item) => item.key === segment.id);
		return post ? [post] : [];
	}
	function handleNativeTextChange(
		post: PostItem,
		index: number,
		value: string,
		mentions?: MentionMetadata
	) {
		if (!activeVariantAccountId) return;
		const id = activeVariantAccountId;
		if (!post.link && accountTextURL(value))
			posts = posts.map((item) =>
				item.key === post.key ? { ...item, link: initialLinkDraft(post) } : item
			);
		const account = activeVariantAccount;
		if (account && joinedDescriptionKey(account)) {
			// The caption replaces joined text. Keep media decisions on their sources.
			unsyncAccount(id);
			posts.forEach((_source, sourceIndex) =>
				handleVariantChange(
					id,
					sourceIndex,
					sourceIndex === 0 ? value : '',
					sourceIndex === 0 ? mentions : { version: 1, spans: [] }
				)
			);
			updateAccountSetting(account, joinedDescriptionKey(account)!, value);
			return;
		}
		if (account) {
			const key = nativeDescriptionKey(account);
			if (key) updateAccountSetting(account, key, value);
		}
		unsyncAccount(id);
		handleVariantChange(id, index, value, mentions);
	}
	function pollDestinationFor(post: PostItem, account: SocialAccount) {
		return {
			id: account.id,
			label: accountContextLabel(account),
			fields: visibleSettings(account),
			body: getVariantContent(account.id, post.key) ?? post.content,
			error: sharedPollError(post, account)
		};
	}
	function updatePreviewSettings(account: SocialAccount, index: number, changes: ComposerSettings) {
		activePostIndex = index;
		for (const [key, value] of Object.entries(changes)) updateAccountSetting(account, key, value);
	}
	function savePreviewLink(
		post: PostItem,
		account: SocialAccount,
		choice: LinkChoice,
		changes: ComposerSettings
	) {
		const index = posts.findIndex((item) => item.key === post.key);
		if (index < 0 || !selectedAccountIds.includes(account.id)) return;
		updatePreviewSettings(account, index, changes);
		const link = post.link ?? initialLinkDraft(post);
		posts = posts.map((item) =>
			item.key === post.key
				? {
						...item,
						link: { ...link, destinations: { ...link.destinations, [account.id]: choice } }
					}
				: item
		);
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}
	function customizePollText(post: PostItem, account: SocialAccount, index: number) {
		activeVariantAccountId = account.id;
		activePostIndex = index;
		unsyncAccount(account.id);
		if (post.poll?.destinations[account.id]?.mode === 'text') {
			const body = pollProjection(post, account).body;
			handleVariantChange(account.id, index, body);
			updateSharedPoll(post, {
				...post.poll,
				destinations: { ...post.poll.destinations, [account.id]: { mode: 'omit' } }
			});
		}
	}

	function setPostContent(index: number, value: string, mentions?: MentionMetadata) {
		posts = posts.map((p, pi) =>
			pi === index
				? {
						...p,
						content: value,
						mentions: mentions ?? remapMentionMetadata(p.content, value, p.mentions),
						link: p.link ?? (firstComposerURL(value) ? initialLinkDraft(p) : undefined)
					}
				: p
		);
		if (index === 0) linkUrl = firstComposerURL(value);
		postBuilderError = '';
		scheduleAutoSave();
	}

	function setEditorContent(index: number, value: string, mentions?: MentionMetadata) {
		if (value.trim()) void startFirstComposition('text');
		if (activeVariantAccountId && activeVariantIsUnsynced) {
			handleVariantChange(activeVariantAccountId, index, value, mentions);
			return;
		}
		setPostContent(index, value, mentions);
	}

	function destinationSettingsForAccount(account: SocialAccount): ComposerSettings {
		const destinationSettings = { ...settingsForAccount(account) };
		const provider = getPlatformKey(account.platform);
		const descriptionKey =
			provider === 'youtube' || provider === 'peertube'
				? 'description'
				: provider === 'facebook'
					? 'video_description'
					: undefined;
		const description = descriptionKey
			? parseComposerSettingOptionalString(destinationSettings[descriptionKey])
			: undefined;
		if (descriptionKey && description !== undefined && posts[0]) {
			destinationSettings[descriptionKey] = postTextForDestination(
				accountEditorValue(posts[0], account, description, true),
				account.platform,
				account.instance_url
			).body;
		}
		return destinationSettings;
	}
	function accountEditorValue(
		post: PostItem,
		account: SocialAccount | undefined | null,
		body: string,
		native: boolean
	): PostTextValue {
		const variant = account ? variants.get(account.id)?.[post.key] : undefined;
		const metadata = variant && !variant.contentInherited ? variant.mentions : post.mentions;
		if (
			native &&
			account &&
			posts.length > 1 &&
			resolvedCapabilities[account.id]?.segment_strategy === 'join'
		) {
			try {
				const joined = joinPostText(
					posts.map((source) => {
						const version = variants.get(account.id)?.[source.key];
						return {
							body: version && !version.contentInherited ? version.content : source.content,
							mentions: (version && !version.contentInherited ? version.mentions : source.mentions)
								?.spans
						};
					})
				);
				if (body === joined.body) return joined;
			} catch {
				/* The destination readiness owner reports invalid joined metadata. */
			}
		}
		return { body, mentions: metadata ? validTextMentions(body, metadata.spans) : undefined };
	}
	function editorValue(post: PostItem, native = false): PostTextValue {
		const body = native ? nativeEditableText(post) : getEditorContentForPost(post);
		return accountEditorValue(post, activeVariantAccount, body, native);
	}
	function editorChanged(post: PostItem, index: number, value: PostTextValue, native = false) {
		const metadata: MentionMetadata | undefined =
			value.mentions === undefined ? undefined : { version: 1, spans: value.mentions };
		if (native && activeVariantAccount) {
			if (nativeDescriptionKey(activeVariantAccount)) {
				handleNativeTextChange(post, index, value.body, metadata);
				return;
			}
			if (!activeVariantIsUnsynced) unsyncAccount(activeVariantAccount.id);
		}
		setEditorContent(index, value.body, metadata);
	}
	function mentionLookup(
		native = false
	): ((query: string, signal: AbortSignal) => Promise<MentionCandidate[]>) | undefined {
		const account = activeVariantAccount;
		const workspaceId = selectedWorkspaceId;
		if (!account) return (query, signal) => searchSavedMentions(workspaceId, query, signal);
		if (
			!account ||
			!['bluesky', 'mastodon', 'linkedin'].includes(account.platform) ||
			(native && nativeDescriptionKey(account))
		)
			return undefined;
		return (query, signal) => lookupComposerMentions(workspaceId, account.id, query, signal);
	}
	function createSavedMention(query: string, complete: (candidate: MentionCandidate) => void) {
		mentionDialog = {
			id: ++mentionDialogSequence,
			workspaceId: selectedWorkspaceId,
			name: query,
			complete,
			session: captureQueryMutationSession()
		};
	}
	function insertSavedMention(entry: SavedMention, origin: number) {
		const target = mentionDialog;
		if (target?.id !== origin) return;
		mentionDialog = null;
		if (
			target &&
			target.workspaceId === selectedWorkspaceId &&
			queryMutationSessionIsCurrent(target.session)
		)
			target.complete(savedMentionCandidate(entry));
	}
	function destinationText(post: PostItem, account: SocialAccount) {
		const variant = variants.get(account.id)?.[post.key];
		const body = getVariantContent(account.id, post.key) ?? post.content;
		const metadata = variant && !variant.contentInherited ? variant.mentions : post.mentions;
		return postTextForDestination(
			{ body, mentions: metadata?.spans },
			account.platform,
			account.instance_url
		).body;
	}
	function setActivePost(index: number) {
		activePostIndex = index;
	}

	async function startFirstComposition(signal: 'text' | 'media' | 'content_mode') {
		const workspaceID = selectedWorkspaceId;
		if (
			!workspaceID ||
			compositionClaimedWorkspaceIDs.has(workspaceID) ||
			compositionClaimPendingWorkspaceIDs.has(workspaceID)
		) {
			return;
		}
		compositionClaimPendingWorkspaceIDs.add(workspaceID);
		const originKey = compositionClaimOrigins.get(workspaceID) ?? crypto.randomUUID();
		compositionClaimOrigins.set(workspaceID, originKey);
		try {
			const { data, error: claimError } = await client.POST('/workspaces/{id}/setup/composition', {
				params: { path: { id: workspaceID } },
				body: { signal, origin_key: originKey }
			});
			if (claimError || !data) return;
			compositionClaimedWorkspaceIDs.add(workspaceID);
			compositionClaimOrigins.delete(workspaceID);
			if (selectedWorkspaceId === workspaceID) ui.refreshWorkspaceSetup();
		} finally {
			compositionClaimPendingWorkspaceIDs.delete(workspaceID);
		}
	}

	function resetAfterSuccessfulPublication() {
		pasteMediaUploadQueue.reset();
		composerSession?.reset();
		posts = [makeEmptyPost()];
		activePostIndex = 0;
		publicationId = '';
		lastSavedSnapshot = '';
		lastSavedScheduleAt = '';
		variants = new Map();
		activeVariantAccountId = null;
		linkUrl = '';
		settingsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		resolvedCapabilities = {};
		validationIssues = [];
		generationUndo = null;
		latestGenerationUndo = null;
		aiAppliedResult = null;
		aiAppliedStrategies = [];
		aiAttachmentRequirements = {};
		repurposePrivateContextNotes = '';
		repurposeReviewActive = false;
		postBuilderError = '';
		selectedDate = undefined;
		selectedTime = null;
		randomDelayOverride = 'default';
	}
</script>

{#if mentionDialog}
	{#key mentionDialog.workspaceId}
		<SavedMentionDialog
			dialogId={mentionDialog.id}
			workspaceId={mentionDialog.workspaceId}
			{accounts}
			initialName={mentionDialog.name}
			onclose={() => {
				mentionDialog = null;
			}}
			oninsert={insertSavedMention}
		/>
	{/key}
{/if}

{#snippet sharedPollControl(post: PostItem, i: number, presentation: 'summary' | 'dialog')}
	<SharedPollEditor
		{presentation}
		creationAccountID={pollCreationAccountID}
		value={post.poll}
		body={post.content}
		destinations={selectedAccounts.map((account) => ({
			id: account.id,
			label: accountContextLabel(account),
			fields: visibleSettings(account),
			body: getVariantContent(account.id, post.key) ?? post.content,
			error: sharedPollError(post, account)
		}))}
		onChange={(poll) => updateSharedPoll(post, poll)}
		activeDestinationId={activeVariantAccountId}
		open={pollEditorPostKey === post.key}
		onOpenChange={(open) => (pollEditorPostKey = open ? post.key : null)}
		onOpenDestination={(id) => {
			activeVariantAccountId = id;
			activePostIndex = i;
		}}
		onLegacySettings={(id) => {
			activePostIndex = i;
			const account = selectedAccounts.find((item) => item.id === id);
			if (account) openDestinationSettings(account);
		}}
		onCustomizeText={(id) => {
			activeVariantAccountId = id;
			activePostIndex = i;
			unsyncAccount(id);
			const account = selectedAccounts.find((item) => item.id === id);
			if (account && post.poll?.destinations[id]?.mode === 'text') {
				const text = pollProjection(post, account).body;
				handleVariantChange(id, i, text);
				updateSharedPoll(post, {
					...post.poll,
					destinations: { ...post.poll.destinations, [id]: { mode: 'omit' } }
				});
			}
		}}
	/>
{/snippet}

{#snippet nativePostMedia(
	media: PreviewMedia,
	display: Snippet,
	segment: PreviewSegment | undefined
)}
	{@const sourceIndexes = posts.flatMap((post, index) =>
		(resolvedCapabilities[activeVariantAccountId!]?.segment_strategy === 'join' ||
			post.key === (segment?.id ?? posts[0]?.key)) &&
		getEditorMediaIdsForPost(post).includes(media.id)
			? [index]
			: []
	)}
	{#if sourceIndexes.length}
		<div class="relative h-full w-full" tabindex="-1" data-composer-media-id={media.id}>
			{@render display()}
			<ComposerMediaActions
				mediaId={media.id}
				altTexts={editorMediaAltTexts}
				captioningIds={captioningMediaIds}
				editing={editingAltMediaId === media.id}
				onRemove={() => {
					for (const index of sourceIndexes) {
						const ids = getEditorMediaIdsForPost(posts[index]);
						removeMedia(index, ids.indexOf(media.id));
					}
				}}
				onAltText={setMediaAltText}
				onToggleAlt={() => (editingAltMediaId = editingAltMediaId === media.id ? null : media.id)}
				onDoneAlt={() => (editingAltMediaId = null)}
			/>
		</div>
	{:else}
		{@render display()}
	{/if}
{/snippet}

{#snippet nativePostText(segment: PreviewSegment)}
	{@const sourcePosts = previewSourcePosts(segment)}
	{#each sourcePosts as post (post.key)}
		{@const index = posts.findIndex((item) => item.key === post.key)}
		<div
			class="min-w-0"
			role="region"
			aria-label={m.compose_drop_zone({ number: index + 1 })}
			onfocusin={() => setActivePost(index)}
			ondragover={handleDragOver}
			ondragleave={handleDragLeave}
			ondrop={(event) => handleDrop(event, index)}
		>
			{#key `${post.key}:${activeVariantAccountId ?? 'shared'}`}
				<PostEditor
					id="post-textarea-{index}"
					label={editorTextIsYouTubeDescription ? m.compose_description() : m.compose_post_text()}
					value={editorValue(post, true)}
					onchange={(value) => editorChanged(post, index, value, true)}
					lookup={mentionLookup(true)}
					minimumQueryLength={activeVariantAccountId ? 2 : 0}
					oncreate={activeVariantAccountId ? undefined : createSavedMention}
					mentionScope={activeVariantAccount
						? {
								provider: activeVariantAccount.platform,
								authority: activeVariantAccount.instance_url
							}
						: undefined}
					onpaste={(event) => handlePaste(event, index)}
					onfocus={() => setActivePost(index)}
					placeholder={m.compose_ai_idea_placeholder()}
					disabled={isSubmitting || buildingPost}
					class="native-post-input w-full rounded-sm border-0 bg-transparent p-0 shadow-none outline-none"
					style="min-height:44px; font:inherit; color:inherit; line-height:inherit;"
				/>
			{/key}
			{#if !previewPollEditingKeys.has(post.key)}
				{@const body = nativeEditableText(post).trim()}
				{@const output = (
					sourcePosts.length === 1 ? segment.text : pollProjection(post, activeVariantAccount!).body
				).trim()}
				{#if output.startsWith(body) && output.trim() !== body}<p
						class="mt-2 whitespace-pre-wrap"
						dir="auto"
					>
						{output.slice(body.length).trim()}
					</p>{/if}
			{/if}
		</div>
	{/each}
{/snippet}

{#snippet nativePostTitle(title: string, segment: PreviewSegment)}
	{@const fields = activeVariantAccount ? visibleSettings(activeVariantAccount) : []}
	{@const definition = fields.find(
		(field) =>
			['title', 'video_title', 'pin_title', 'event_title'].includes(field.key) &&
			!field.unavailable_reason
	)}
	{#if definition && activeVariantAccount}
		<Input
			aria-label={settingLabel(definition)}
			value={String(settingsForAccount(activeVariantAccount)[definition.key] ?? '')}
			placeholder={title}
			maxlength={definition.constraints?.max_length}
			disabled={isSubmitting || buildingPost}
			oninput={(event) =>
				updateAccountSetting(activeVariantAccount!, definition.key, event.currentTarget.value)}
			class="w-full border-transparent bg-transparent px-0 shadow-none"
			style="font:inherit; color:inherit;"
		/>
	{:else}{title}{/if}
{/snippet}

{#snippet nativeLinkCard(card: PreviewCard, segment: PreviewSegment, display: Snippet)}
	{@const post = posts.find((item) => item.key === segment.id) ?? posts[0]}
	{#if post && activeVariantAccount}
		<PreviewLinkEditor
			disabled={isSubmitting || buildingPost}
			{card}
			{display}
			provider={getPlatformKey(activeVariantAccount.platform)}
			fields={visibleSettings(activeVariantAccount, post)}
			values={{
				...settingsForAccount(activeVariantAccount),
				...segmentSettingsByPost[post.key]?.[activeVariantAccount.id]
			}}
			choice={linkChoice(post.link, activeVariantAccount.id)}
			postURL={accountTextURL(getVariantContent(activeVariantAccount.id, post.key) ?? post.content)}
			onSave={(choice, changes) => savePreviewLink(post, activeVariantAccount!, choice, changes)}
		/>
	{/if}
{/snippet}

{#snippet nativePoll(preview: PreviewPoll, segment: PreviewSegment, display: Snippet)}
	{@const post = posts.find((item) => item.key === segment.id) ?? posts[0]}
	{@const index = posts.findIndex((item) => item.key === post?.key)}
	{#if post && activeVariantAccount}
		<PreviewPollEditor
			value={post.poll}
			{preview}
			{display}
			destination={pollDestinationFor(post, activeVariantAccount)}
			settings={pollProjection(post, activeVariantAccount).settings}
			disabled={isSubmitting || buildingPost}
			onChange={(poll) => updateSharedPoll(post, poll)}
			onLegacyChange={(changes) => updatePreviewSettings(activeVariantAccount!, index, changes)}
			onCustomizeText={() => customizePollText(post, activeVariantAccount!, index)}
			onEditingChange={(editing) => {
				if (editing) previewPollEditingKeys.add(post.key);
				else previewPollEditingKeys.delete(post.key);
			}}
		/>
	{/if}
{/snippet}

<!-- ====================================================================== -->
<!-- Top Bar -->
<!-- ====================================================================== -->
<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden"
	data-testid="text-thread-composer-content"
>
	{#if selectedWorkspaceId}
		<WorkspaceSetupGuide
			workspaceID={selectedWorkspaceId}
			context="composer"
			wrapperClass={hideSetupGuideOnDesktop
				? 'border-b px-3 py-3 sm:px-4 md:hidden'
				: 'border-b px-3 py-3 sm:px-4'}
		/>
	{/if}
	{#if !desktopComposerControls.current}
		<div
			class="sticky top-0 z-20 border-b bg-background/94 px-3 py-2 backdrop-blur-md"
			data-testid="mobile-composer-controls"
		>
			<div class="flex min-w-0 flex-wrap items-center gap-1.5">
				{#if selectedWorkspaceId && accounts.length > 0}
					<SocialSetControl
						workspaceId={selectedWorkspaceId}
						{accounts}
						{capabilities}
						{selectedAccountIds}
						customAccountIds={[...variants.keys()]}
						{accountIssues}
						bind:selectedSetId={selectedSocialSetId}
						disabled={isSaving || isSubmitting}
						autoApplyDefault={!initialPublication && !publicationId}
						onApply={applySocialSet}
						onToggle={(account) => toggleAccount(account.id)}
						onSelectAll={selectAllAccounts}
						onClearAll={clearAllAccounts}
					/>
				{/if}
				{#if accountControlLoading}
					<Button
						type="button"
						variant="outline"
						size="icon"
						class="size-11 shrink-0"
						disabled
						aria-label={m.compose_accounts_loading()}
						data-testid="composer-account-loading"
					>
						<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					</Button>
				{/if}
				{#if autoSavesDraft}
					<SaveIndicator
						saving={isSaving}
						saved={savedIndicatorVisible}
						savingLabel={m.common_saving()}
						savedLabel={m.compose_saved_state()}
						testId="composer-save-indicator"
					/>
				{/if}
				{#if accounts.length > 0}
					<ComposerValidationMenu issues={visibleGlobalIssues} onSelect={focusComposerIssue} />
				{/if}
				<Button
					type="button"
					variant="ghost"
					size="icon"
					class="size-11 text-muted-foreground"
					onclick={() => (composerSettingsOpen = true)}
					aria-label={m.compose_post_settings()}
				>
					<ThemeIcon role="settings" class="size-4" />
				</Button>
				{#if isEditMode && !autoSavesDraft}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-11 text-muted-foreground hover:text-destructive md:size-8"
						aria-label={m.common_delete()}
						title={m.common_delete()}
						onclick={requestDraftDelete}
						disabled={isDeleting || isSaving || isSubmitting}
					>
						<ThemeIcon role="delete" class="size-4" />
					</Button>
					<Button
						size="sm"
						class="ml-auto h-11 shrink-0 px-3"
						onclick={() => saveEditedPost()}
						disabled={isSaving || isSubmitting || !canSaveEditedPost}
					>
						{#if isSaving}<ProtectedIcon
								icon="loading"
								class="size-3.5 animate-spin motion-reduce:animate-none"
							/>{/if}
						<span>{isSaving ? m.compose_saving_changes() : m.compose_save_changes()}</span>
					</Button>
				{:else}
					<ComposerPublishActions
						class="w-full"
						scheduleLabel={formatScheduledDisplay()}
						quickScheduleLabel={selectedDate && selectedTime
							? m.compose_schedule_selected_time({ schedule: formatScheduledDisplay() })
							: m.compose_queue_next_slot()}
						publishLabel={m.compose_publish_now()}
						moreLabel={m.sidebar_more()}
						deleteLabel={m.common_delete()}
						busy={isSubmitting || isSaving || deliveryFeedback.length > 0}
						deleting={isDeleting}
						quickScheduleBusy={suggestingSlot}
						canOpenSchedule={selectedWorkspaceSettingsReady}
						canQuickSchedule={canSchedulePublication && selectedWorkspaceSettingsReady}
						canPublish={canPublishNow}
						onSchedule={openScheduleDialog}
						onQuickSchedule={quickSchedule}
						onPublish={() => publish(true)}
						onDelete={publicationId ? requestDraftDelete : undefined}
					/>
				{/if}
			</div>
		</div>
	{:else}
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
			data-testid="desktop-composer-controls"
		>
			<div class="flex flex-wrap items-center gap-2">
				{#if selectedWorkspaceId && accounts.length > 0}
					<SocialSetControl
						workspaceId={selectedWorkspaceId}
						{accounts}
						{capabilities}
						{selectedAccountIds}
						customAccountIds={[...variants.keys()]}
						{accountIssues}
						bind:selectedSetId={selectedSocialSetId}
						disabled={isSaving || isSubmitting}
						autoApplyDefault={!initialPublication && !publicationId}
						onApply={applySocialSet}
						onToggle={(account) => toggleAccount(account.id)}
						onSelectAll={selectAllAccounts}
						onClearAll={clearAllAccounts}
					/>
				{/if}

				<!-- Account selector -->
				{#if accountControlLoading}
					<Button
						type="button"
						variant="ghost"
						size="sm"
						class="gap-1.5 text-xs"
						disabled
						data-testid="composer-account-loading"
					>
						<ProtectedIcon
							icon="loading"
							class="size-3.5 animate-spin motion-reduce:animate-none"
						/>
						{m.compose_accounts_loading()}
					</Button>
				{/if}
				{#if autoSavesDraft}
					<SaveIndicator
						saving={isSaving}
						saved={savedIndicatorVisible}
						savingLabel={m.common_saving()}
						savedLabel={m.compose_saved_state()}
						testId="composer-save-indicator"
					/>
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-1.5 md:gap-2">
				{#if accounts.length > 0}
					<ComposerValidationMenu issues={visibleGlobalIssues} onSelect={focusComposerIssue} />
				{/if}
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="text-muted-foreground"
								onclick={() => (composerSettingsOpen = true)}
								aria-label={m.compose_post_settings()}
							>
								<ThemeIcon role="settings" class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content><p class="text-sm">{m.compose_post_settings()}</p></Tooltip.Content>
				</Tooltip.Root>

				{#if isEditMode && !autoSavesDraft}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-8 text-muted-foreground hover:text-destructive"
						aria-label={m.common_delete()}
						title={m.common_delete()}
						onclick={requestDraftDelete}
						disabled={isDeleting || isSaving || isSubmitting}
					>
						<ThemeIcon role="delete" class="size-4" />
					</Button>
					<Button
						size="sm"
						class="gap-1.5"
						onclick={() => saveEditedPost()}
						disabled={isSaving || isSubmitting || !canSaveEditedPost}
					>
						{#if isSaving}<ProtectedIcon
								icon="loading"
								class="h-3.5 w-3.5 animate-spin motion-reduce:animate-none"
							/>{/if}
						<span>{isSaving ? m.compose_saving_changes() : m.compose_save_changes()}</span>
					</Button>
				{:else}
					<ComposerPublishActions
						scheduleLabel={formatScheduledDisplay()}
						quickScheduleLabel={selectedDate && selectedTime
							? m.compose_schedule_selected_time({ schedule: formatScheduledDisplay() })
							: m.compose_queue_next_slot()}
						publishLabel={m.compose_publish_now()}
						moreLabel={m.sidebar_more()}
						deleteLabel={m.common_delete()}
						busy={isSubmitting || isSaving || deliveryFeedback.length > 0}
						deleting={isDeleting}
						quickScheduleBusy={suggestingSlot}
						canOpenSchedule={selectedWorkspaceSettingsReady}
						canQuickSchedule={canSchedulePublication && selectedWorkspaceSettingsReady}
						canPublish={canPublishNow}
						onSchedule={openScheduleDialog}
						onQuickSchedule={quickSchedule}
						onPublish={() => publish(true)}
						onDelete={publicationId ? requestDraftDelete : undefined}
					/>
				{/if}
			</div>
		</div>
	{/if}

	<ComposerScheduleDialog
		workspaceId={selectedWorkspaceId}
		bind:open={showScheduleDialog}
		bind:selectedDate
		bind:selectedTime
		{timeSlots}
		timezone={scheduleTimezoneLabel}
		weekStartsOn={workspaceCtx.weekStartsOn}
		externalError={scheduleInputError}
		suggesting={suggestingSlot}
		submitting={isSubmitting}
		canSchedule={canSchedulePublication}
		bind:randomDelayOverride
		randomDelayOptions={randomDelaySelectOptions}
		defaultRandomDelayMinutes={workspaceCtx.settings.random_delay_minutes}
		onSuggest={suggestNextSlot}
		onSchedule={() => publish(false)}
		onClear={() => (scheduleInputError = '')}
	/>

	{#if workspaceLoadError}
		<AppToast
			message={workspaceLoadError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (workspaceLoadError = '')}
			actionLabel={m.common_retry()}
			onAction={() => void initializeComposer()}
		/>
	{:else if workspaceSettingsError}
		<AppToast
			message={workspaceSettingsError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (workspaceSettingsError = '')}
			actionLabel={m.common_retry()}
			onAction={() => void retryComposerWorkspaceSettings()}
		/>
	{:else if accountLoadError}
		<AppToast
			message={accountLoadError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (accountLoadError = '')}
			actionLabel={m.common_retry()}
			onAction={() => void loadAccounts(selectedWorkspaceId, accountRetryIds, true)}
		/>
	{:else if capabilityResolveError}
		<AppToast
			message={capabilityResolveError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (capabilityResolveError = '')}
			actionLabel={m.common_retry()}
			onAction={() => void resolveCapabilities()}
		/>
	{/if}
	{#if workspaceChangeNotice}
		<AppToast
			message={workspaceChangeNotice}
			dismissLabel={m.common_dismiss()}
			onDismiss={() => {
				workspaceChangeNotice = '';
				ui.clearPendingComposerWorkspaceNotice();
			}}
		/>
	{/if}
	{#if captionGenerationError}
		<AppToast
			message={captionGenerationError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (captionGenerationError = '')}
			actionLabel={m.common_retry()}
			onAction={retryFailedMediaAltText}
		/>
	{/if}
	{#if error}
		<AppToast
			message={error}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (error = '')}
		/>
	{/if}
	{#if success}
		<AppToast
			message={success}
			tone="success"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (success = '')}
		/>
	{/if}
	<p class="sr-only" role="status" aria-live="polite">{pasteMediaAnnouncement}</p>

	<!-- ====================================================================== -->
	<!-- Main Content Area -->
	<!-- ====================================================================== -->
	<div class="flex min-h-0 flex-1 overflow-hidden">
		<!-- Compose Column -->
		<div class="flex min-h-0 flex-1 flex-col overflow-y-auto">
			{#if activationPublicationID && deliveryFeedback.length === 0}
				<WorkspaceActivationCompletion
					publicationID={activationPublicationID}
					onCreateAnother={resetAfterDeliveryFeedback}
				/>
			{/if}
			{#if deliveryPublicationID && deliveryFeedback.length > 0}
				<ComposerDeliveryFeedback
					publicationID={deliveryPublicationID}
					renditions={deliveryFeedback}
					accountLabels={deliveryAccountLabels}
					workspaceActivated={Boolean(activationPublicationID)}
					retryingRenditionID={retryingDeliveryRenditionID}
					onRetry={retryDeliveryRendition}
					onManualResolution={(renditionID) => {
						const accountID = deliveryFeedback.find(
							(rendition) => rendition.id === renditionID
						)?.social_account_id;
						return goto(
							resolveAppPath(
								accountID
									? `/settings?tab=accounts&account_id=${encodeURIComponent(accountID)}`
									: '/settings?tab=accounts'
							)
						);
					}}
					onCreateAnother={resetAfterDeliveryFeedback}
				/>
			{/if}
			<div class="mx-auto w-full max-w-2xl px-3 py-4 md:px-6 md:py-6">
				{#each Object.entries(aiAttachmentRequirements).filter(([accountID]) => selectedAccountIds.includes(accountID) && (!activeVariantAccountId || activeVariantAccountId === accountID)) as [accountID, requirement] (accountID)}
					{@const account = selectedAccounts.find((item) => item.id === accountID)}
					{@const attached = posts.some((post) =>
						(getVariantMediaIds(accountID, post.key) ?? post.mediaIds).some((id) =>
							mediaMimeTypes.get(id)?.startsWith(`${requirement.kind}/`)
						)
					)}
					{#if !attached}
						<section class="mb-3 rounded-lg border border-dashed p-3 text-sm">
							<p class="font-medium">
								{account ? accountLabel(account) : ''}: {requirement.kind === 'video'
									? m.ideate_video_needed()
									: m.ideate_image_needed()}
							</p>
							<p class="mt-1 text-muted-foreground">{requirement.brief}</p>
							<Button
								type="button"
								variant="ghost"
								size="sm"
								class="mt-2"
								onclick={() => {
									requirementReviewId = accountID;
									requirementReviewText = posts[0]
										? (getVariantContent(accountID, posts[0].key) ?? posts[0].content)
										: '';
								}}>{m.ideate_remove_requirement()}</Button
							>
						</section>
					{/if}
				{/each}
				{#if selectedAccounts.length > 0}
					<section
						class="mb-3 flex items-center gap-1 border-b"
						aria-label={m.compose_destination_tabs()}
					>
						<ComposerDestinationTabs
							accounts={selectedAccounts}
							activeAccountId={activeVariantAccountId}
							onActivate={activateVariantTab}
							{accountLabel}
							issueCountFor={(account) => accountIssueMessages(account).length}
							isCustomFor={(account) =>
								nativeHasCustomText(account) || variantHasMediaOverride(account.id)}
						/>
						{#if activeVariantAccount}
							<ComposerVariantToolbar
								hasContentOverride={nativeHasCustomText(activeVariantAccount)}
								resetTextLabel={nativeHasCustomText(activeVariantAccount) &&
								(!joinedDescriptionKey(activeVariantAccount) ||
									settingsByAccount[activeVariantAccount.id]?.[
										joinedDescriptionKey(activeVariantAccount)!
									])
									? joinedDescriptionKey(activeVariantAccount)
										? m.compose_preview_reset()
										: m.compose_reset_field()
									: undefined}
								hasMediaOverride={variantHasMediaOverride(activeVariantAccount.id)}
								isUnsynced={activeVariantIsUnsynced}
								uploadsPending={hasPendingPasteMediaUploads}
								{restorableImages}
								restorablePending={!!fittingImageId}
								multiAccount={selectedAccounts.length > 1}
								segmentStrategy={resolvedCapabilities[activeVariantAccount.id]?.segment_strategy}
								postCount={posts.length}
								onPreview={() => openAccountPreview(activeVariantAccount!)}
								onUseOriginalImage={restoreOriginalImage}
								onSettings={() => openDestinationSettings(activeVariantAccount!)}
								onResetField={(field) => resetNativeField(activeVariantAccount!, field)}
								onToggleSync={() => {
									const account = activeVariantAccount!;
									if (nativeHasCustomText(account) || variantHasMediaOverride(account.id))
										restoreSharedContent(account);
									else detachSharedContent(account.id);
								}}
								onResync={() => restoreSharedContent(activeVariantAccount!)}
								onDestinationAction={openDestinationAction}
							/>
						{/if}
					</section>
				{/if}

				{#if !activeVariantAccountId && selectedAccounts.length > 0}
					<ComposerRequiredFields
						accounts={selectedAccounts}
						resolvedByAccount={resolvedCapabilities}
						valuesByAccount={requiredValuesByAccount}
						optionGroupsByAccount={destinationOptionsByAccount}
						optionErrorsByAccount={destinationOptionsErrors}
						optionsLoadingAccountIds={destinationOptionsLoadingAccountIds}
						onChange={updateAccountSetting}
						onFormatChange={selectDestinationFormat}
						onAddMedia={() => openMediaPicker(activePostIndex)}
						mediaActionDisabled={hasPendingPasteMediaUploads}
					/>
				{/if}

				{#if visibleAIStrategies.length > 0}
					<details>
						<summary class="min-h-11 cursor-pointer py-3 text-sm text-muted-foreground"
							>{m.compose_ai_strategy_label()}</summary
						>
						<div
							class="mb-3 flex gap-2 overflow-x-auto border-y py-3"
							aria-label={m.compose_ai_strategy_label()}
						>
							{#each visibleAIStrategies as destination (destination.account_id)}
								<div class="min-w-48 rounded-lg border bg-muted/30 px-3 py-2 text-xs">
									<p class="font-medium text-foreground">
										{getPlatformName(destination.platform)} · {localizedAIObjective(
											destination.objective
										)}
									</p>
									<p class="mt-1 text-muted-foreground">
										{destination.media.treatment === 'none'
											? m.compose_ai_no_media_recommended()
											: destination.media.brief ||
												localizedAIMediaTreatment(destination.media.treatment)}
									</p>
									{#if destination.warnings?.length}
										<p class="mt-1 text-amber-700 dark:text-amber-300">
											{destination.warnings.join(' ')}
										</p>
									{/if}
								</div>
							{/each}
						</div>
					</details>
				{/if}

				{#if textCardAccounts.length && !textCardNoticeDismissed}
					<InlineNotice
						class="mb-3"
						message={m.text_card_notice({
							platform: [
								...new Set(textCardAccounts.map((account) => getPlatformName(account.platform)))
							].join(', ')
						})}
						dismissLabel={m.common_dismiss()}
						onDismiss={() => (textCardNoticeDismissed = true)}
					>
						{#snippet actions()}<Button
								variant="ghost"
								size="sm"
								aria-label={m.text_card_customize()}
								onclick={() =>
									openDestinationSettings(
										activeVariantAccount && textCardAccounts.includes(activeVariantAccount)
											? activeVariantAccount
											: textCardAccounts[0]
									)}
								><ThemeIcon role="settings" class="size-4 sm:hidden" /><span
									class="hidden sm:inline">{m.text_card_customize()}</span
								></Button
							>{/snippet}
					</InlineNotice>
				{/if}
				{#each selectedAccounts as account (account.id)}
					<TextCardPreview
						request={cardRequestForAccount(account)}
						savedPreview={savedCardPreviews[account.id]}
						identity={textCardIdentityForAccount(account)}
						defaults={textCardDefaultsForAccount(account)}
						showImages={false}
						onResult={(result) => textCardResults.set(account.id, result)}
					/>
				{/each}

				{#if imagePreparationNotice}<p class="py-2 text-sm text-muted-foreground" role="status">
						{imagePreparationNotice}
					</p>{/if}
				{#if activeVariantAccount}
					{@const accountPreview = previewForAccount(activeVariantAccount)}
					{@const post = activePost}
					{#key activeVariantAccount.id}
						<div data-testid="composer-account-editor">
							<ComposerPreview
								model={previewForAccount(activeVariantAccount)}
								editor={{
									text: nativePostText,
									media: previewMediaOpen ? undefined : nativePostMedia,
									title: nativePostTitle,
									card: nativeLinkCard,
									poll: nativePoll
								}}
							/>
							{#if imageFitCandidates(activeVariantAccount).length}
								<div class="space-y-2 border-t py-3" data-testid="composer-image-fit">
									<p class="text-sm text-muted-foreground">{m.compose_image_fit_help()}</p>
									<div class="flex flex-wrap gap-2">
										{#each imageFitCandidates(activeVariantAccount) as id (id)}
											<Button
												variant="outline"
												size="sm"
												disabled={!!fittingImageId}
												aria-busy={fittingImageId === id}
												onclick={() => fitAccountImage(activeVariantAccount!, id)}
												>{fittingImageId === id
													? m.compose_image_preparing()
													: m.compose_image_fit_named({
															number:
																[
																	...new Set(
																		posts.flatMap(
																			(post) =>
																				getVariantMediaIds(activeVariantAccount!.id, post.key) ??
																				post.mediaIds
																		)
																	)
																].indexOf(id) + 1,
															network: getPlatformName(activeVariantAccount.platform)
														})}</Button
											>
										{/each}
									</div>
								</div>
							{/if}
							{#if post}
								{@const pendingMediaUploads = visiblePasteMediaUploads(post)}
								<div class="flex flex-wrap items-center gap-2 py-2">
									<Button
										variant="ghost"
										size="icon"
										aria-label={m.media_picker_add_media()}
										disabled={isSubmitting ||
											pendingMediaUploads.length > 0 ||
											getEditorMediaIdsForPost(post).length >= composerMediaLimit}
										onclick={() => openMediaPicker(activePostIndex)}
										><ThemeIcon role="image" class="size-4" /></Button
									>
									{#if posts.some((source) => getEditorMediaIdsForPost(source).length)}
										<Button
											variant="ghost"
											size="sm"
											aria-expanded={previewMediaOpen}
											onclick={() => (previewMediaOpen = !previewMediaOpen)}
											>{m.compose_edit_media()}</Button
										>
									{/if}
									{#if !post.poll && !accountPreview.poll && supportsNativePoll(visibleSettings(activeVariantAccount))}
										<Button
											variant="ghost"
											size="icon"
											aria-label={m.compose_add_poll()}
											disabled={accountControlLoading}
											aria-busy={accountControlLoading}
											onclick={() => {
												pollCreationAccountID = activeVariantAccount!.id;
												pollEditorPostKey = post.key;
											}}><ThemeIcon role="poll" class="size-4" /></Button
										>
									{/if}
									<ComposerCharCounter
										content={accountPreview.segments[0]?.text ?? ''}
										limits={editorPlatformLimits}
									/>
								</div>
								{#if previewMediaOpen}
									<div data-testid="composer-media-editor">
										{#each posts as source, index (source.key)}
											<div
												role="region"
												aria-label={m.compose_drop_zone({ number: index + 1 })}
												onfocusin={() => setActivePost(index)}
											>
												<ComposerMediaGrid
													mediaIds={getEditorMediaIdsForPost(source)}
													mediaCount={getEditorMediaIdsForPost(source).length +
														visiblePasteMediaUploads(source).length}
													altTexts={editorMediaAltTexts}
													captioningIds={captioningMediaIds}
													bind:editingAltMediaId
													pendingUploads={visiblePasteMediaUploads(source)}
													queue={pasteMediaUploadQueue}
													{isVideoMedia}
													onRemoveMedia={(mediaIndex) => removeMedia(index, mediaIndex)}
													onAltText={setMediaAltText}
												/>
											</div>
										{/each}
									</div>
								{:else}
									<PasteUploadList
										uploads={pendingMediaUploads}
										mediaCount={getEditorMediaIdsForPost(post).length + pendingMediaUploads.length}
										baseCount={getEditorMediaIdsForPost(post).length}
										queue={pasteMediaUploadQueue}
									/>
								{/if}
							{/if}
							{#each posts as sourcePost, index (sourcePost.key)}
								{#if sourcePost.poll && !accountPreview.segments.some((segment) => segment.id === sourcePost.key && segment.poll)}
									<div class="border-t py-3">
										<PreviewPollEditor
											value={sourcePost.poll}
											destination={pollDestinationFor(sourcePost, activeVariantAccount)}
											settings={pollProjection(sourcePost, activeVariantAccount).settings}
											onChange={(poll) => updateSharedPoll(sourcePost, poll)}
											onLegacyChange={(values) =>
												updatePreviewSettings(activeVariantAccount!, index, values)}
											onCustomizeText={() =>
												customizePollText(sourcePost, activeVariantAccount!, index)}
										/>
									</div>
								{/if}
								{@render sharedPollControl(sourcePost, index, 'dialog')}
							{/each}
						</div>
					{/key}
				{:else}
					<!-- Posts -->
					<div class="space-y-0">
						{#if undoReorderIDs}<Button variant="ghost" size="sm" onclick={undoThreadReorder}
								>{m.interaction_reorder_undo()}</Button
							>{/if}
						<ReorderList
							items={posts}
							scope={`${selectedWorkspaceId}:${publicationId}`}
							label={m.compose_post_text()}
							onReorder={handleReorder}
						>
							{#snippet item(post, i, handle)}
								{@const editorContent = getEditorContentForPost(post)}
								{@const editorMediaIds = getEditorMediaIdsForPost(post)}
								{@const pendingMediaUploads = visiblePasteMediaUploads(post)}
								{@const pasteFeedback = visiblePasteMediaFeedback(post)}
								{@const editorMediaCount = editorMediaIds.length + pendingMediaUploads.length}
								<div
									class="group/post relative {isDraggingFile && activePostIndex === i
										? 'bg-primary/5'
										: ''}"
									role="region"
									aria-label={m.compose_drop_zone({ number: i + 1 })}
									onfocusin={() => setActivePost(i)}
									ondragover={handleDragOver}
									ondragleave={handleDragLeave}
									ondrop={(e) => handleDrop(e, i)}
								>
									{#if isThread && i < posts.length - 1}
										<div class="absolute top-0 bottom-0 left-3 w-px bg-border"></div>
									{/if}

									<div class="relative flex gap-3 {isThread ? 'pl-7' : ''}">
										{#if isThread}
											<div class="relative flex flex-col items-center pt-3">
												<button
													type="button"
													class="drag-handle -ml-6 flex size-11 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 focus-visible:opacity-100 active:cursor-grabbing md:-ml-4 md:size-6 md:opacity-0 md:group-hover/post:opacity-60 [@media(pointer:coarse)]:size-11"
													title={m.compose_drag_to_reorder()}
													aria-label={m.compose_drag_to_reorder()}
													{...handle}
												>
													<ThemeIcon role="drag" class="h-4 w-4" />
												</button>
											</div>
										{/if}

										<div class="min-w-0 flex-1">
											<div class="relative">
												{#key `${post.key}:${activeVariantAccountId ?? 'shared'}`}
													<PostEditor
														id="post-textarea-{i}"
														label={editorTextIsYouTubeDescription
															? m.compose_description()
															: m.compose_post_text()}
														value={editorValue(post)}
														onchange={(value) => editorChanged(post, i, value)}
														lookup={mentionLookup()}
														minimumQueryLength={activeVariantAccountId ? 2 : 0}
														oncreate={activeVariantAccountId ? undefined : createSavedMention}
														onpaste={(event) => handlePaste(event, i)}
														onfocus={() => setActivePost(i)}
														placeholder={i === 0
															? editorTextIsYouTubeDescription
																? m.compose_describe_video()
																: m.compose_ai_idea_placeholder()
															: m.compose_add_to_thread()}
														class="relative z-10 w-full border-0 bg-transparent py-2 {isThread
															? 'pr-12'
															: 'pr-3 md:pr-4'} text-base leading-7 text-foreground md:py-3 md:text-lg md:leading-8"
														style="min-height: {i === 0 ? '120px' : '56px'};"
														disabled={isSubmitting ||
															buildingPost ||
															(!!activeVariantAccountId && !activeVariantIsUnsynced)}
													/>
												{/key}
											</div>

											{#if pasteFeedback.length > 0}
												<div
													class="mb-3 flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive"
													role="status"
													aria-live="polite"
													data-testid="composer-paste-feedback"
												>
													<ul class="min-w-0 flex-1 space-y-1">
														{#each pasteFeedback as message (message)}
															<li>{message}</li>
														{/each}
													</ul>
													<button
														type="button"
														class="flex size-7 shrink-0 items-center justify-center rounded-md hover:bg-destructive/10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
														onclick={() => (pasteMediaFeedback = null)}
														aria-label={m.common_dismiss()}
													>
														<ThemeIcon role="close" class="size-3.5" />
													</button>
												</div>
											{/if}

											<ComposerMediaGrid
												mediaIds={editorMediaIds}
												mediaCount={editorMediaCount}
												altTexts={editorMediaAltTexts}
												captioningIds={captioningMediaIds}
												bind:editingAltMediaId
												pendingUploads={pendingMediaUploads}
												queue={pasteMediaUploadQueue}
												{isVideoMedia}
												onRemoveMedia={(mi) => removeMedia(i, mi)}
												onAltText={setMediaAltText}
											/>

											{@render sharedPollControl(post, i, 'summary')}

											<!-- Bottom bar -->
											<div
												class="flex flex-wrap items-center gap-2 pb-2 transition-opacity {activePostIndex ===
												i
													? 'opacity-100'
													: 'pointer-events-none opacity-0'}"
											>
												{#if isThread}<span
														class="text-xs font-medium text-muted-foreground tabular-nums"
														>#{i + 1}</span
													>{/if}

												<button
													type="button"
													class="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:size-7"
													disabled={isSubmitting ||
														pendingMediaUploads.length > 0 ||
														editorMediaCount >= composerMediaLimit ||
														(!!activeVariantAccountId && !activeVariantIsUnsynced)}
													aria-busy={pendingMediaUploads.length > 0}
													onclick={() => openMediaPicker(i)}
													aria-label={m.media_picker_add_media()}
												>
													<ThemeIcon role="image" class="h-3.5 w-3.5" />
												</button>
												{#if !post.poll}
													<button
														type="button"
														class="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50 md:size-7"
														disabled={accountControlLoading}
														aria-busy={accountControlLoading}
														onclick={() => {
															pollCreationAccountID = undefined;
															pollEditorPostKey = post.key;
														}}
														aria-label={m.compose_add_poll()}
													>
														<ThemeIcon role="poll" class="h-3.5 w-3.5" />
													</button>
												{/if}

												<ComposerCharCounter
													content={getEditorContentForPost(post)}
													limits={editorPlatformLimits}
												/>

												<button
													type="button"
													class="-mx-2 flex min-h-11 items-center gap-1.5 px-2 text-xs whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground md:mx-0 md:min-h-7 md:px-0"
													onclick={addPost}
												>
													<ThemeIcon role="add" class="h-3 w-3" />{m.compose_add_post()}
												</button>

												{#if i === 0 && !activeVariantAccountId && !isThread}
													<ComposerAIActionButton
														hasText={Boolean(posts[0]?.content.trim())}
														building={buildingPost}
														disabled={!canBuildPost}
														ideateLabel={m.compose_ai_ideate()}
														buildLabel={generationUndo
															? m.compose_ai_build_again()
															: m.compose_ai_build()}
														buildingLabel={m.compose_ai_building()}
														onclick={buildPostWithAI}
													/>
												{/if}
											</div>

											{#if i === 0 && !activeVariantAccountId && !isThread && postBuilderError}
												<p class="border-t py-3 text-sm text-destructive" role="alert">
													{postBuilderError}
												</p>
											{:else if i === 0 && !activeVariantAccountId && generationUndo}
												<div class="space-y-3 border-t py-3">
													<div class="flex flex-wrap items-center gap-2">
														<p class="min-w-0 flex-1 text-sm text-muted-foreground">
															{m.compose_ai_ready({ count: selectedAccounts.length })}
														</p>
														{#if isThread}
															<Button
																type="button"
																variant="ghost"
																size="sm"
																class="min-h-11 md:min-h-8"
																onclick={convertGeneratedThreadToPost}
															>
																{m.compose_ai_convert_to_post()}
															</Button>
														{/if}
														{#if latestGenerationUndo && latestGenerationUndo !== generationUndo}
															<Button
																type="button"
																variant="ghost"
																size="sm"
																class="min-h-11 gap-1.5 md:min-h-8"
																onclick={undoLatestGenerationApply}
															>
																<ThemeIcon role="undo" class="size-3.5" />
																{m.image_editor_undo()}
															</Button>
														{/if}
														<Button
															type="button"
															variant="ghost"
															size="sm"
															class="min-h-11 gap-1.5 md:min-h-8"
															onclick={restoreIdea}
														>
															<ThemeIcon role="undo" class="size-3.5" />
															{m.compose_ai_restore_idea()}
														</Button>
													</div>
												</div>
												{#if aiMemeCandidates.length > 0 || aiMemeError}
													<div class="border-t py-4">
														<AIMemeRecommendation
															candidates={aiMemeCandidates}
															copy={aiMemeCopy}
															bind:selectedCandidateId={aiMemeSelectedID}
															error={aiMemeError}
															onUse={useAIMeme}
															onEdit={editAIMeme}
															onRetry={previewAIMemeCandidate}
														/>
													</div>
												{/if}
											{/if}
											{#if isThread}
												<button
													type="button"
													class="absolute top-1 right-0 z-20 flex size-11 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 md:top-3 md:size-7 md:opacity-0 md:group-hover/post:opacity-100 [@media(pointer:coarse)]:size-11"
													onclick={() => removePost(i)}
													title={m.compose_remove_post()}
													aria-label={m.compose_remove_post()}
												>
													<ThemeIcon role="delete" class="h-3.5 w-3.5" />
												</button>
											{/if}
										</div>
									</div>
								</div>
							{/snippet}
						</ReorderList>
					</div>
				{/if}
			</div>
		</div>
	</div>
</div>

<AIWorkspaceDialog
	bind:open={aiWorkspaceOpen}
	entry={aiWorkspaceEntry}
	step={aiWorkspaceStep}
	copy={repurposeReviewActive
		? repurposeWorkspaceCopy
		: { ...aiWorkspaceCopy, getIdeas: m.ideate_generate() }}
	opportunities={aiWorkspaceOpportunities}
	selectedOpportunityId={aiSelectedOpportunityID}
	angles={aiWorkspaceAngles}
	selectedAngleId={aiSelectedAngleID}
	generationPhases={aiGenerationPhases}
	generationMessage={aiGenerationMessage}
	destinationSummary={selectedAccounts.length === 1
		? m.compose_ai_destination_summary_one({ count: selectedAccounts.length })
		: m.compose_ai_destination_summary_many({ count: selectedAccounts.length })}
	voiceSummary={m.compose_ai_writing_as({ voice: aiVoiceName })}
	loadingOpportunities={aiOpportunityLoading}
	opportunityLoadingMessage={aiOpportunitySlow
		? m.compose_ai_finding_ideas_slow()
		: m.compose_ai_finding_ideas()}
	findingMore={aiFindingMore}
	generating={buildingPost}
	generationActive={aiGenerationActive}
	cancelling={aiCancelling}
	canCancel={aiActiveBuild?.state === 'queued' || aiActiveBuild?.state === 'building'}
	applyPending={aiApplyPending}
	error={postBuilderError}
	onSelectOpportunity={selectPublicationOpportunity}
	onSelectAngle={(angle) => {
		aiSelectedAngleID = angle.id;
		const selected = aiAngles.find((candidate) => candidate.id === angle.id);
		if (selected) aiObjective = selected.objective;
	}}
	onDiscover={() => void startSelectedPublicationBuild()}
	onContinue={() => void continuePublicationOpportunity()}
	onFindMore={() => void loadPublicationOpportunities(true)}
	onBack={aiWorkspaceEntry === 'ideate'
		? () => {
				postBuilderError = '';
				aiWorkspaceStep = 'opportunities';
				aiAngles = [];
				aiSelectedAngleID = '';
			}
		: undefined}
	onBuild={() => void startSelectedPublicationBuild()}
	onCancel={() => void cancelActivePublicationBuild()}
	onRetry={aiActiveBuild?.state === 'failed'
		? () => void retryActivePublicationBuild()
		: aiBuildCreateRejected
			? undefined
			: aiWorkspaceStep === 'opportunities'
				? () => void loadPublicationOpportunities()
				: () => void loadPublicationAngles(aiGenerationIdea)}
	onApply={() => applyReadyPublicationBuild()}
	onKeepEditing={keepCurrentComposerEdits}
	onDismissError={() => (postBuilderError = '')}
>
	{#snippet context()}
		{#if aiWorkspaceStep === 'brief'}
			<label class="mx-auto grid max-w-2xl gap-2 text-sm font-medium">
				{m.compose_ai_brief()}
				<Textarea
					bind:value={aiIdeationBrief}
					maxlength={20000}
					rows={5}
					placeholder={m.compose_ai_brief_placeholder()}
				/>
			</label>
			<Button
				type="button"
				variant="ghost"
				class="mt-2"
				onclick={() => void discoverPublicationIdeas()}
				disabled={buildingPost}>{m.compose_ai_ideate()}</Button
			>
		{:else if aiWorkspaceStep === 'angles'}
			<div class="grid gap-3 rounded-lg border bg-muted/25 p-3 sm:grid-cols-2">
				<label class="grid gap-1.5 text-xs font-medium">
					{m.compose_ai_context_objective()}
					<Input
						bind:value={aiObjective}
						maxlength={200}
						placeholder={m.compose_ai_context_objective_placeholder()}
					/>
				</label>
				<label class="grid gap-1.5 text-xs font-medium">
					{m.compose_ai_context_change()}
					<Input
						bind:value={aiChangeRequest}
						maxlength={500}
						placeholder={m.compose_ai_context_change_placeholder()}
					/>
				</label>
				<details class="sm:col-span-2">
					<summary class="min-h-8 cursor-pointer text-xs font-medium text-muted-foreground">
						{m.compose_ai_context_add()}
					</summary>
					<div class="mt-2 grid gap-3 sm:grid-cols-2">
						<label class="grid gap-1.5 text-xs font-medium">
							{m.compose_ai_context_notes()}
							<Textarea
								bind:value={aiContextNotes}
								maxlength={10000}
								rows={3}
								placeholder={m.compose_ai_context_notes_placeholder()}
							/>
						</label>
						<label class="grid gap-1.5 text-xs font-medium">
							{m.compose_ai_context_links()}
							<Textarea
								bind:value={aiContextURLs}
								rows={3}
								placeholder={m.compose_ai_context_links_placeholder()}
							/>
						</label>
						<label class="flex min-h-11 items-center gap-2 text-xs sm:col-span-2">
							<Checkbox
								checked={aiContextMayPublish}
								onCheckedChange={(checked) => (aiContextMayPublish = checked === true)}
							/>
							{m.compose_ai_context_allow_notes()}
						</label>
						{#if selectedAIAssets().length > 0}
							<p class="text-xs text-muted-foreground sm:col-span-2">
								{selectedAIAssets().length === 1
									? m.compose_ai_context_attachment_one({ count: selectedAIAssets().length })
									: m.compose_ai_context_attachment_many({ count: selectedAIAssets().length })}
							</p>
						{/if}
					</div>
				</details>
			</div>
		{/if}
	{/snippet}
	{#snippet results()}
		<PostOptions
			sources={aiPendingResult?.sources ?? []}
			options={aiPostOptions}
			accounts={selectedAccounts}
			workspaceId={selectedWorkspaceId}
			busy={buildingPost}
			onUse={(option) => void useAIPostOption(option)}
			onChange={(option) =>
				(aiPostOptions = aiPostOptions.map((item) => (item.id === option.id ? option : item)))}
		/>
	{/snippet}
</AIWorkspaceDialog>

<Dialog.Root
	open={!!requirementReviewId}
	onOpenChange={(open) => {
		if (!open) requirementReviewId = '';
	}}
>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header
			><Dialog.Title>{m.ideate_review_without_media()}</Dialog.Title><Dialog.Description
				>{m.ideate_review_without_media_description()}</Dialog.Description
			></Dialog.Header
		>
		<label class="grid gap-2 text-sm font-medium"
			>{m.ideate_post_text()}<Textarea bind:value={requirementReviewText} rows={5} /></label
		>
		<Dialog.Footer
			><Button variant="outline" onclick={() => (requirementReviewId = '')}
				>{m.common_cancel()}</Button
			><Button
				disabled={!requirementReviewText.trim()}
				onclick={() => {
					if (!posts[0]) return;
					handleVariantChange(requirementReviewId, 0, requirementReviewText);
					const next = { ...aiAttachmentRequirements };
					delete next[requirementReviewId];
					aiAttachmentRequirements = next;
					const profiles = { ...requestedOutputProfiles };
					delete profiles[requirementReviewId];
					requestedOutputProfiles = profiles;
					formatLockedByAccount = { ...formatLockedByAccount, [requirementReviewId]: false };
					validationIssues = [];
					aiAppliedStrategies = aiAppliedStrategies.map((strategy) =>
						strategy.account_id === requirementReviewId
							? { ...strategy, media: { treatment: 'none', role: 'none', brief: '' } }
							: strategy
					);
					requirementReviewId = '';
					scheduleCapabilityResolve();
					scheduleAutoSave();
				}}>{m.ideate_save_without_media()}</Button
			></Dialog.Footer
		>
	</Dialog.Content>
</Dialog.Root>

<Dialog.Root bind:open={destinationActionOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header>
			<Dialog.Title>
				{destinationAction === 'copy' ? m.compose_copy_rendition() : m.compose_apply_media()}
			</Dialog.Title>
			<Dialog.Description>
				{destinationAction === 'copy'
					? m.compose_copy_rendition_description()
					: m.compose_apply_media_description()}
			</Dialog.Description>
		</Dialog.Header>
		<div class="space-y-2 py-2">
			{#each selectedAccounts.filter((account) => account.id !== activeVariantAccountId) as account (account.id)}
				<label class="flex min-h-12 items-center gap-3 rounded-md border px-3 py-2 text-sm">
					<Checkbox
						checked={destinationActionTargetIds.includes(account.id)}
						disabled={hasPendingPasteMediaUploads}
						onCheckedChange={() => toggleDestinationActionTarget(account.id)}
					/>
					<SocialAccountIdentity
						class="min-w-0 flex-1"
						name={accountLabel(account)}
						platform={account.platform}
						avatarUrl={account.account_avatar_url}
					/>
				</label>
			{/each}
		</div>
		<Dialog.Footer>
			{#if destinationCopyError}<p role="alert" class="text-sm text-destructive">
					{destinationCopyError}
				</p>{/if}
			<Button type="button" variant="outline" onclick={() => (destinationActionOpen = false)}>
				{m.common_cancel()}
			</Button>
			<Button
				type="button"
				disabled={hasPendingPasteMediaUploads || destinationActionTargetIds.length === 0}
				onclick={applyDestinationAction}
			>
				{m.compose_apply_changes()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<Sheet.Root bind:open={composerSettingsOpen}>
	<Sheet.Content
		side="right"
		class="w-full! gap-0 overflow-y-auto p-0 sm:max-w-lg!"
		data-testid="composer-settings-sheet"
	>
		<Sheet.Header class="border-b px-5 py-5 pr-16 text-left">
			<Sheet.Title>{m.compose_post_settings()}</Sheet.Title>
			<Sheet.Description>{m.compose_post_settings_body()}</Sheet.Description>
		</Sheet.Header>
		{#if onOpenVersionHistory || onCopyAsDraft}
			<div class="grid gap-1 border-b p-3">
				{#if onOpenVersionHistory}
					<Button
						type="button"
						variant="ghost"
						class="h-11 w-full justify-start gap-3 px-3"
						onclick={openVersionHistory}
					>
						<ThemeIcon role="history" class="size-4 text-muted-foreground" />
						{m.image_editor_version_history()}
					</Button>
				{/if}
				{#if onCopyAsDraft}
					<Button
						type="button"
						variant="ghost"
						class="h-11 w-full justify-start gap-3 px-3"
						onclick={onCopyAsDraft}
						disabled={copyingDraft}
					>
						{#if copyingDraft}
							<ProtectedIcon
								icon="loading"
								class="size-4 animate-spin text-muted-foreground motion-reduce:animate-none"
							/>
							{m.publication_copying()}
						{:else}
							<ThemeIcon role="copy" class="size-4 text-muted-foreground" />
							{m.publication_copy_as_draft()}
						{/if}
					</Button>
				{/if}
			</div>
		{/if}
		<div class="px-5">
			<PublicationReviewControl
				workspaceId={selectedWorkspaceId}
				{publicationId}
				{reviewState}
				prepare={prepareClientReview}
				onChanged={applyClientReview}
			/>
		</div>
		<div class="p-5">
			<ComposerRepostControl
				workspaceID={selectedWorkspaceId}
				sourcePlatforms={[
					...new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))
				]}
				bind:value={repostOverride}
				disabled={!selectedWorkspaceId || isSaving || isSubmitting}
				onChange={scheduleAutoSave}
			/>
		</div>
	</Sheet.Content>
</Sheet.Root>

<MediaPicker
	bind:open={mediaPickerOpen}
	workspaceId={selectedWorkspaceId}
	currentSelection={mediaPickerInitialMode === 'meme'
		? []
		: posts[mediaPickerPostIndex]
			? getEditorMediaIdsForPost(posts[mediaPickerPostIndex])
			: []}
	currentMediaMimeTypes={Object.fromEntries(mediaMimeTypes)}
	maxSelection={composerMediaLimit}
	multiple={composerMediaLimit > 1}
	purpose={isThread ? 'thread_segment' : 'post_media'}
	enableMeme
	compactNavigation
	autoConfirmUploads
	initialMode={mediaPickerInitialMode}
	memeInitialIdea={mediaPickerMemeIdea}
	memeInitialCandidate={mediaPickerMemeCandidate}
	memeInitialPreview={mediaPickerMemePreview}
	initialFiles={mediaPickerInitialFiles}
	onInitialFilesConsumed={() => (mediaPickerInitialFiles = [])}
	onConfirm={async (ids) => {
		const postContext = posts[mediaPickerPostIndex]
			? getEditorContentForPost(posts[mediaPickerPostIndex])
			: '';
		const previousIds = posts[mediaPickerPostIndex]
			? getEditorMediaIdsForPost(posts[mediaPickerPostIndex])
			: [];
		if (mediaPickerInitialMode === 'meme' && mediaPickerMemeCandidate) {
			let attached = false;
			if (mediaPickerMemeRequestGeneration === aiMemeRequestGeneration) {
				for (const mediaID of ids) {
					attached =
						(await attachAIMemeToTargets(
							mediaID,
							mediaPickerMemeTargetAccountIDs,
							selectedWorkspaceId
						)) || attached;
				}
			}
			if (!attached) return false;
			mediaPickerInitialMode = 'upload';
			mediaPickerMemeIdea = '';
			mediaPickerMemeCandidate = undefined;
			mediaPickerMemePreview = '';
			mediaPickerMemeTargetAccountIDs = [];
			aiMemeCandidates = [];
			return true;
		}
		const addedIds = ids.filter((id) => !previousIds.includes(id));
		const post = posts[mediaPickerPostIndex];
		if (!post) return false;
		const target = pasteMediaTargetForPost(post);
		if (!target) return false;
		const authoredContext = imagePreparationContext;
		const preparedAdded = await prepareNewImageIds(addedIds, target.workspaceId);
		if (
			!preparedAdded ||
			authoredContext !== imagePreparationContext ||
			!arraysEqual(mediaIdsForPasteTarget(target), previousIds)
		)
			return false;
		const preparedIds = ids.map((id) => {
			const index = addedIds.indexOf(id);
			return index < 0 ? id : preparedAdded[index];
		});
		setPasteTargetMediaIds(target, preparedIds);
		void generateMissingMediaAltText(
			preparedIds.filter((id) => !previousIds.includes(id)),
			postContext
		);
	}}
	onCreate={openImageEditorFromComposer}
	onCreateTemplate={openTemplateEditorFromComposer}
	onCreateVideo={openVideoEditorFromComposer}
/>

<DestinationSettingsDialog
	bind:open={settingsDialogOpen}
	textCardSavedPreview={settingsAccount ? savedCardPreviews[settingsAccount.id] : undefined}
	textCardText={settingsAccount
		? authoredPreviewForAccount(settingsAccount)
				.segments.map((segment) => segment.text)
				.join('\n\n')
		: ''}
	textCardAttachmentCount={settingsAccount
		? authoredPreviewForAccount(settingsAccount).media.length
		: 0}
	account={settingsAccount}
	settings={settingsDialogFields}
	emptySettingsHint={settingsDialogEmptyHint}
	values={settingsDialogValues}
	mediaItems={settingsDialogMedia}
	mediaValues={settingsDialogMediaValues}
	optionGroups={settingsAccount ? (destinationOptionsByAccount[settingsAccount.id] ?? {}) : {}}
	optionNextCursors={settingsAccount
		? (destinationOptionCursorsByAccount[settingsAccount.id] ?? {})
		: {}}
	optionsLoading={settingsAccount
		? destinationOptionsLoadingAccountIds.has(settingsAccount.id)
		: false}
	optionsError={settingsAccount ? (destinationOptionsErrors[settingsAccount.id] ?? '') : ''}
	scopeLabel={isThread ? m.compose_thread_post({ number: activePostIndex + 1 }) : ''}
	formatValue={settingsAccount
		? requestedOutputProfiles[settingsAccount.id] ||
			resolvedCapabilities[settingsAccount.id]?.output_profile ||
			''
		: ''}
	formatOptions={settingsAccount && accountUsesManualFormat(settingsAccount)
		? destinationFormatOptions(settingsAccount)
		: []}
	formatRequired={settingsAccount
		? (resolvedCapabilities[settingsAccount.id]?.format_selection_required ?? false)
		: false}
	onFormatChange={(value) => {
		if (settingsAccount) selectDestinationFormat(settingsAccount, value);
	}}
	onChange={(key, value) => {
		if (settingsAccount) updateAccountSetting(settingsAccount, key, value);
	}}
	onMediaChange={(mediaID, key, value) => {
		if (settingsAccount) updateMediaAccountSetting(settingsAccount, mediaID, key, value);
	}}
	onOptionSearch={(setting, search) => {
		if (settingsAccount && setting.options_source) {
			void loadDestinationOptions(settingsAccount, true, setting.options_source, search);
		}
	}}
	onOptionLoadMore={(setting) => {
		if (settingsAccount && setting.options_source) {
			void loadDestinationOptions(settingsAccount, true, setting.options_source, '', true);
		}
	}}
	onRetry={() => {
		if (settingsAccount) void loadDestinationOptions(settingsAccount, true);
	}}
	onFileChange={uploadDestinationSettingFile}
	onEditCover={editDestinationCover}
/>

<Dialog.Root
	open={workspaceSwitchState !== null}
	onOpenChange={(open) => {
		if (!open && workspaceSwitchState && !workspaceSwitchState.intent) stayInComposerWorkspace();
	}}
>
	<Dialog.Content class="sm:max-w-lg" data-testid="composer-workspace-switch-dialog">
		<Dialog.Header>
			<Dialog.Title>{m.compose_workspace_switch_title()}</Dialog.Title>
			<Dialog.Description>
				{m.compose_workspace_switch_body({
					workspace: workspaceSwitchState?.toWorkspaceName ?? ''
				})}
			</Dialog.Description>
		</Dialog.Header>
		{#if workspaceSwitchState?.error}
			<p class="text-sm text-destructive" role="alert">{workspaceSwitchState.error}</p>
		{/if}
		<Dialog.Footer class="gap-2 sm:justify-between">
			<Button
				type="button"
				variant="ghost"
				onclick={stayInComposerWorkspace}
				disabled={Boolean(workspaceSwitchState?.intent)}
			>
				{m.compose_workspace_switch_stay()}
			</Button>
			<div class="flex flex-col-reverse gap-2 sm:flex-row">
				<Button
					type="button"
					variant="destructive"
					onclick={discardBeforeWorkspaceSwitch}
					disabled={Boolean(workspaceSwitchState?.intent)}
				>
					{m.compose_workspace_switch_discard()}
				</Button>
				<Button
					type="button"
					onclick={saveBeforeWorkspaceSwitch}
					disabled={Boolean(workspaceSwitchState?.intent)}
					aria-busy={workspaceSwitchState?.intent === 'save'}
				>
					{#if workspaceSwitchState?.intent === 'save'}
						<ProtectedIcon icon="loading" class="size-4 animate-spin motion-reduce:animate-none" />
					{/if}
					{isEditMode ? m.compose_save_changes() : m.compose_save_draft()}
				</Button>
			</div>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<DestructiveConfirmDialog
	bind:open={showDeleteConfirm}
	title={m.sidebar_delete_draft_confirm()}
	description={m.compose_delete_draft_body()}
	onConfirm={deleteDraft}
/>

<DraftConflictDialog
	bind:open={conflictDialogOpen}
	conflict={draftConflict}
	onReload={reloadSavedTextDraft}
	onSaveCopy={saveConflictedTextDraftAsCopy}
	onOverwrite={overwriteSavedTextDraft}
/>

<style>
	.destination-tabs-scrollbar {
		scrollbar-width: thin;
		scrollbar-color: color-mix(in oklch, var(--foreground) 22%, transparent) transparent;
	}

	.destination-tabs-scrollbar::-webkit-scrollbar {
		height: 6px;
	}

	.destination-tabs-scrollbar::-webkit-scrollbar-track {
		background: transparent;
	}

	.destination-tabs-scrollbar::-webkit-scrollbar-button {
		display: none;
		width: 0;
		height: 0;
	}

	.destination-tabs-scrollbar::-webkit-scrollbar-thumb {
		border-radius: 999px;
		background-color: color-mix(in oklch, var(--foreground) 22%, transparent);
	}

	@media (hover: hover) and (pointer: fine) {
		.destination-tabs-scrollbar::-webkit-scrollbar-thumb:hover {
			background-color: color-mix(in oklch, var(--foreground) 34%, transparent);
		}
	}
</style>
