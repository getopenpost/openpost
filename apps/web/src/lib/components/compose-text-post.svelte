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
	import { z } from 'zod';
	import { captureTelemetryEvent } from '@openpost/telemetry';
	import { page } from '$app/stores';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client, type SocialAccount, type Workspace } from '$lib/api/client';
	import { loadCapabilityCatalog, loadWorkspaceAccounts } from '$lib/api/performance-cache';
	import { publicationDetailQueryOptions } from '@openpost/query-catalog';
	import { queryAPI } from '$lib/query/api';
	import { queryClient } from '$lib/query/client';
	import {
		captureQueryMutationSession,
		queryMutationSessionIsCurrent,
		type QueryMutationSession
	} from '$lib/query/authorization-boundary';
	import type { components } from '$lib/api/types';
	import AIMemeRecommendation from '$lib/components/post-builder/ai-meme-recommendation.svelte';
	import {
		MAX_COMPOSER_DRAFT_MEDIA,
		mediaCapabilityItemsFromIds,
		providerMediaWarningMessages
	} from '$lib/media-capabilities';
	import { workspaceCtx, type WorkspaceSwitchRequest } from '$lib/stores/workspace.svelte';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import SocialSetControl from './social-set-control.svelte';
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
	import ComposerValidationMenu from './composer-validation-menu.svelte';
	import DestinationSettingsDialog from './destination-settings-dialog.svelte';
	import InlineNotice from './inline-notice.svelte';
	import Disclosure from './disclosure.svelte';
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
	import { formatSocialAccountLabel, formatSocialAccountName } from '$lib/utils';
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
	import { uniquePlatformLimits } from './compose/platform-limits';
	import { readinessStateMessage } from './account-presentation';
	import { editorAccountIdAfterVariantLoad } from './compose/editor-target';
	import { isActionableAccountIssue } from './compose/account-attention';
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
		invalidateDependentDestinationSettings
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
	import { clearEditorHandoff, type ComposerRecoverySnapshot } from '$lib/editor-handoff';
	import {
		parseComposerHandoffPayload,
		type ComposerHandoffPayload
	} from '$lib/composer/handoff-payload';
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
	import { uploadMediaFile } from '$lib/media-upload-client';
	import { firstComposerURL } from './compose/composer-links';
	import {
		presentProviderReadiness,
		type ProviderReadinessOperation,
		type ProviderReadinessPresentation
	} from '$lib/provider-readiness';
	import { hasUnsettledPasteMediaUploads } from '$lib/composer/media-queue';
	import { ComposerTextShortening } from './compose/text-shortening.svelte';
	import { ComposerMedia } from './compose/media.svelte';
	import { ComposerEditorHandoff } from './compose/editor-handoff.svelte';
	import { ComposerCapabilityResolver } from './compose/capability-resolver.svelte';
	import ComposerAIWorkspace from './compose/composer-ai-workspace.svelte';
	import ComposerSettingsSheet from './compose/composer-settings-sheet.svelte';
	import WorkspaceSwitchDialog from './compose/workspace-switch-dialog.svelte';
	import { ComposerDestinationAction } from './compose/destination-action.svelte';
	import DestinationActionDialog from './compose/destination-action-dialog.svelte';
	import {
		ComposerAIBuilder,
		localizedAIMediaTreatment,
		localizedAIObjective
	} from './compose/ai-builder.svelte';
	import {
		AI_BUILD_METADATA_KEY,
		aiBuildMetadataSchema,
		attachmentRequirementSchema
	} from './compose/ai-build-metadata';
	import type {
		Capability,
		ComposerHost,
		ComposerRenditionSegment,
		DeliveryOutcome,
		ProviderSettings,
		ProviderSettingValue,
		Publication,
		SettingDefinition,
		SocialSet,
		ValidationIssue
	} from './compose/composer-host';

	// --------------------------------------------------------------------------
	// Types
	// --------------------------------------------------------------------------

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
	const composer: ComposerHost = {
		get isSubmitting() {
			return isSubmitting;
		},
		get validationIssues() {
			return validationIssues;
		},
		set validationIssues(value) {
			validationIssues = value;
		},
		get saveGeneration() {
			return saveGeneration;
		},
		get settingsByAccount() {
			return settingsByAccount;
		},
		set settingsByAccount(value) {
			settingsByAccount = value;
		},
		get segmentSettingsByPost() {
			return segmentSettingsByPost;
		},
		get mediaSettingsByAccount() {
			return mediaSettingsByAccount;
		},
		set mediaSettingsByAccount(value) {
			mediaSettingsByAccount = value;
		},
		get pageURL() {
			return $page.url;
		},
		get activePost() {
			return activePost;
		},
		get settingsAccount() {
			return settingsAccount;
		},
		get settingsAccountId() {
			return settingsAccountId;
		},
		set settingsAccountId(value) {
			settingsAccountId = value;
		},
		get settingsDialogOpen() {
			return settingsDialogOpen;
		},
		set settingsDialogOpen(value) {
			settingsDialogOpen = value;
		},
		get textComposerMode() {
			return textComposerMode;
		},
		get captionMentionsByAccount() {
			return captionMentionsByAccount;
		},
		set captionMentionsByAccount(value) {
			captionMentionsByAccount = value;
		},
		get scheduleOverridesByAccount() {
			return scheduleOverridesByAccount;
		},
		set scheduleOverridesByAccount(value) {
			scheduleOverridesByAccount = value;
		},
		get attachmentRequirements() {
			return ai.aiAttachmentRequirements;
		},
		get mediaAltTexts() {
			return composerMedia.mediaAltTexts;
		},
		get composerDestroyed() {
			return composerDestroyed;
		},
		get selectedWorkspaceId() {
			return selectedWorkspaceId;
		},
		get publicationId() {
			return publicationId;
		},
		get error() {
			return error;
		},
		set error(value) {
			error = value;
		},
		get accounts() {
			return accounts;
		},
		get selectedAccountIds() {
			return selectedAccountIds;
		},
		set selectedAccountIds(value) {
			selectedAccountIds = value;
		},
		get selectedAccounts() {
			return selectedAccounts;
		},
		get selectedSocialSetId() {
			return selectedSocialSetId;
		},
		set selectedSocialSetId(value) {
			selectedSocialSetId = value;
		},
		get requestedOutputProfiles() {
			return requestedOutputProfiles;
		},
		set requestedOutputProfiles(value) {
			requestedOutputProfiles = value;
		},
		get formatLockedByAccount() {
			return formatLockedByAccount;
		},
		set formatLockedByAccount(value) {
			formatLockedByAccount = value;
		},
		get posts() {
			return posts;
		},
		set posts(value) {
			posts = value;
		},
		get activePostIndex() {
			return activePostIndex;
		},
		set activePostIndex(value) {
			activePostIndex = value;
		},
		get isThread() {
			return isThread;
		},
		get variants() {
			return variants;
		},
		set variants(value) {
			variants = value;
		},
		get activeVariantAccountId() {
			return activeVariantAccountId;
		},
		set activeVariantAccountId(value) {
			activeVariantAccountId = value;
		},
		get linkUrl() {
			return linkUrl;
		},
		set linkUrl(value) {
			linkUrl = value;
		},
		get composerMediaLimit() {
			return composerMediaLimit;
		},
		get hasPendingPasteMediaUploads() {
			return hasPendingPasteMediaUploads;
		},
		get imagePreparationContext() {
			return composerMedia.imagePreparationContext;
		},
		get mediaPickerOpen() {
			return mediaPickerOpen;
		},
		set mediaPickerOpen(value) {
			mediaPickerOpen = value;
		},
		get mediaPickerPostIndex() {
			return mediaPickerPostIndex;
		},
		set mediaPickerPostIndex(value) {
			mediaPickerPostIndex = value;
		},
		get mediaPickerInitialFiles() {
			return mediaPickerInitialFiles;
		},
		set mediaPickerInitialFiles(value) {
			mediaPickerInitialFiles = value;
		},
		get mediaPickerInitialMode() {
			return mediaPickerInitialMode;
		},
		set mediaPickerInitialMode(value) {
			mediaPickerInitialMode = value;
		},
		get resolvedCapabilities() {
			return capabilityResolver.resolvedCapabilities;
		},
		clearPickerMeme: () => ai.clearPickerMeme(),
		getVariantContent,
		getVariantPost,
		getVariantMediaIds,
		getEditorContentForPost,
		getEditorMediaIdsForPost,
		setEditorMediaIds,
		mergeMediaIds,
		settingsForAccount,
		visibleSettings,
		updateAccountSetting,
		joinedDescriptionKey,
		pasteMediaUploadBlocker: () => composerMedia.pasteMediaUploadBlocker(),
		saveMutationViewIsCurrent,
		sessionFor,
		canonicalPublicationForHandoff,
		composerHandoffPayload,
		restoreComposerHandoff,
		handleVariantChange,
		setPostContent,
		composerIssuePostIndex,
		accountContextLabel,
		prepareNewImageIds: (ids, workspaceId) => composerMedia.prepareNewImageIds(ids, workspaceId),
		hydrateMediaMetadata: (workspaceId, mediaIds, force) =>
			composerMedia.hydrateMediaMetadata(workspaceId, mediaIds, force),
		generateMissingMediaAltText: (mediaIds, postContext) =>
			composerMedia.generateMissingMediaAltText(mediaIds, postContext),
		saveDraft,
		scheduleAutoSave,
		resolveCapabilities: () => capabilityResolver.resolveCapabilities(),
		scheduleCapabilityResolve: () => capabilityResolver.scheduleCapabilityResolve(),
		destinationSettingsForAccount,
		pollProjection,
		accountNeedsOwnSegmentCopy,
		refreshSavedTextCardPreviews,
		mediaAltTextForAccount: (mediaId, accountId) =>
			composerMedia.mediaAltTextForAccount(mediaId, accountId),
		startFirstComposition
	};
	let isEditMode = $derived(Boolean(initialPublication));

	let posts = $state<PostItem[]>([makeEmptyPost()]);
	let activePostIndex = $state(0);
	let publicationId = $state('');
	let revision = $state(1);
	let reviewState = $state('');
	let lastInitializedPublicationId = $state<string | null>(null);
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
	const sidePreviewStorageKey = 'openpost-composer-side-preview';
	let sidePreviewVisible = $state(true);
	let wideLayout = $state(false);

	$effect(() => {
		// The side preview is remembered per device; wide containers show it by default.
		try {
			sidePreviewVisible = localStorage.getItem(sidePreviewStorageKey) !== 'off';
		} catch {
			sidePreviewVisible = true;
		}
	});

	$effect(() => {
		const query = window.matchMedia('(min-width: 1280px)');
		const update = () => (wideLayout = query.matches);
		update();
		query.addEventListener('change', update);
		return () => query.removeEventListener('change', update);
	});

	function toggleSidePreview() {
		sidePreviewVisible = !sidePreviewVisible;
		try {
			localStorage.setItem(sidePreviewStorageKey, sidePreviewVisible ? 'on' : 'off');
		} catch {
			// Storage is optional; the choice still applies to this session.
		}
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

	const ai = new ComposerAIBuilder(composer);
	let appliedRepurposeHandoffID = '';
	let toolDraftApplied = false;

	let variants = $state<Map<string, Record<string, VariantPost>>>(new Map());
	let activeVariantAccountId = $state<string | null>(null);

	const composerMedia = new ComposerMedia(composer);
	const editorHandoff = new ComposerEditorHandoff(composer, composerMedia);
	const destinationActions = new ComposerDestinationAction(composer);

	let settingsByAccount = $state<Record<string, ComposerSettings>>({});
	let captionMentionsByAccount = $state<
		Record<string, { field: string; body: string; mentions: MentionMetadata } | null>
	>({});
	const textCardResults = new SvelteMap<string, TextCardResult>();
	let textCardNoticeDismissed = $state(false);
	let savedCardPreviews = $state<Record<string, TextCardResult>>({});
	// Renditions whose stored text-card images back savedCardPreviews. Kept so
	// the preview keys can be recomputed once capability defaults resolve.
	let savedCardRenditions: Publication['renditions'] | undefined;
	let segmentSettingsByPost = $state<Record<string, Record<string, ComposerSettings>>>({});
	let mediaSettingsByAccount = $state<Record<string, Record<string, ComposerSettings>>>({});
	let mediaPickerOpen = $state(false);
	let mediaPickerPostIndex = $state(0);
	let mediaPickerInitialFiles = $state.raw<File[]>([]);
	let mediaPickerInitialMode = $state<'upload' | 'meme'>('upload');
	let validationIssues = $state<ValidationIssue[]>([]);
	let settingsDialogOpen = $state(false);
	let settingsAccountId = $state('');

	const capabilityResolver = new ComposerCapabilityResolver(composer);

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
	const hasPendingPasteMediaUploads = $derived(
		hasUnsettledPasteMediaUploads(composerMedia.pasteMediaUploads)
	);
	const canBuildPost = $derived(
		!isThread &&
			!activeVariantAccountId &&
			!isSubmitting &&
			!isSaving &&
			!ai.buildingPost &&
			!hasPendingPasteMediaUploads
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
		const values = new SvelteMap(composerMedia.mediaAltTexts);
		if (activeVariantAccountId) {
			for (const [mediaId, settings] of Object.entries(mediaSettingsByAccount)) {
				const alt = parseComposerSettingOptionalString(settings[activeVariantAccountId]?.alt_text);
				if (alt !== undefined) values.set(mediaId, alt);
			}
		}
		return values;
	});
	const settingsDialogEmptyHint = $derived(
		capabilityResolver.capabilityReadinessCurrent &&
			settingsAccount &&
			getPlatformKey(settingsAccount.platform) === 'youtube' &&
			settingsDialogFields.length === 0 &&
			settingsDialogMedia.length === 0 &&
			capabilityResolver.resolvedCapabilities[settingsAccount.id]?.issues?.some(
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
			capabilityResolver.capabilityReadinessKnown &&
			selectedAccounts.every((account) => accountReadiness(account, 'publish_immediate').canProceed)
	);
	const canSchedulePublication = $derived(
		canSubmitPublication &&
			capabilityResolver.capabilityReadinessKnown &&
			selectedAccounts.every((account) => accountReadiness(account, 'publish_scheduled').canProceed)
	);
	const scheduleDisabledReason = $derived(
		selectedAccounts.length === 0
			? m.compose_schedule_needs_destination()
			: canSchedulePublication
				? m.common_loading()
				: m.compose_publishing_issues()
	);
	const publishDisabledReason = $derived(
		selectedAccounts.length === 0
			? m.compose_publish_needs_destination()
			: m.compose_publishing_issues()
	);
	const canSaveEditedPost = $derived(
		hasContent &&
			selectedAccountIds.length > 0 &&
			(!(selectedDate && selectedTime) || canSchedulePublication)
	);
	const activeVariantAccount = $derived(
		activeVariantAccountId ? (accounts.find((a) => a.id === activeVariantAccountId) ?? null) : null
	);
	// Account tabs already render their own preview, so the side panel serves the shared view.
	const sidePreviewAccount = $derived(activeVariantAccount ? null : (selectedAccounts[0] ?? null));
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
		return uniquePlatformLimits(editorLimitAccounts, capabilityResolver.resolvedCapabilities);
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
				composerMedia.pasteMediaUploadQueue.reset();
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
			ai.beginRepurposeReview(handoff, content);
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

		composerMedia.pasteMediaUploadQueue.discardWhere((upload) => {
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
			mediaAltTexts: Array.from(composerMedia.mediaAltTexts.entries()),
			linkUrl,
			settingsByAccount,
			captionMentionsByAccount,
			segmentSettingsByPost,
			mediaSettingsByAccount,
			aiAppliedStrategies: ai.aiAppliedStrategies,
			aiAttachmentRequirements: ai.aiAttachmentRequirements,
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
		const resolved = capabilityResolver.resolvedCapabilities[account.id];
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
			mimeType: composerMedia.mediaMimeTypes.get(id) ?? 'application/octet-stream'
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
		capabilityResolver.scheduleCapabilityResolve();
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
			capabilityResolver.resolvedCapabilities[account.id]?.segment_strategy === 'join'
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
			capabilityResolver.resolvedCapabilities[account.id]?.segment_strategy === 'join' &&
			posts.length > 1;
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
					mimeType: composerMedia.mediaMimeTypes.get(id),
					altText: composerMedia.mediaAltTextForAccount(id, account.id),
					...composerMedia.mediaPreviewMetadata.get(id),
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
				requestedOutputProfiles[account.id] ??
				capabilityResolver.resolvedCapabilities[account.id]?.output_profile,
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
			requestedOutputProfiles[account.id] ||
				capabilityResolver.resolvedCapabilities[account.id]?.output_profile ||
				''
		);
	}

	// Catalogue text-card defaults for one account, resolved once from the
	// account's resolved capability (falling back to the capability catalogue
	// while it is still resolving) and merged into settings before the request
	// key is computed, so omitted styling follows the catalogue.
	function textCardDefaultsForAccount(account: SocialAccount): ComposerSettings {
		return textCardDefaultsFrom(
			capabilityResolver.resolvedCapabilities[account.id] ?? visibleSettings(account)
		);
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
		const caption = captionMentionsByAccount[account.id];
		if (caption?.field === key && caption.body !== String(value ?? '')) {
			const body = String(value ?? '');
			captionMentionsByAccount = {
				...captionMentionsByAccount,
				[account.id]: {
					...caption,
					body,
					mentions: remapMentionMetadata(caption.body, body, caption.mentions) ?? {
						version: 1,
						spans: []
					}
				}
			};
		}
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
				capabilityResolver.destinationOptionsByAccount = {
					...capabilityResolver.destinationOptionsByAccount,
					[account.id]: Object.fromEntries(
						Object.entries(capabilityResolver.destinationOptionsByAccount[account.id] ?? {}).filter(
							([source]) => !invalidSources.has(source)
						)
					)
				};
				capabilityResolver.destinationOptionCursorsByAccount = {
					...capabilityResolver.destinationOptionCursorsByAccount,
					[account.id]: Object.fromEntries(
						Object.entries(
							capabilityResolver.destinationOptionCursorsByAccount[account.id] ?? {}
						).filter(([source]) => !invalidSources.has(source))
					)
				};
				for (const source of invalidated.optionSources) {
					void capabilityResolver.loadDestinationOptions(account, true, source);
				}
			}
		}
		validationIssues = [];
		scheduleAutoSave();
		capabilityResolver.scheduleCapabilityResolve();
	}

	function updateMediaAccountSetting(
		account: SocialAccount,
		mediaID: string,
		key: string,
		value: ProviderSettingValue
	) {
		for (let index = 0; index < posts.length; index++) {
			const ids = getVariantMediaIds(account.id, posts[index].key) ?? posts[index].mediaIds;
			if (ids.includes(mediaID)) composerMedia.setVariantMediaIds(account.id, index, [...ids]);
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
		capabilityResolver.scheduleCapabilityResolve();
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
		const pasteUploadIssue = composerMedia.pasteMediaUploadIssue();
		if (pasteUploadIssue) blockers.push(pasteUploadIssue);
		if (capabilityResolver.capabilityResolveError)
			blockers.push(capabilityResolver.capabilityResolveError);
		if (composerMedia.fittingImageId) blockers.push(m.compose_image_preparing());
		return uniqueIssueMessages(blockers);
	}

	function accountBlockers(
		account: SocialAccount,
		includeShared = true,
		includeServerValidation = true
	): string[] {
		const provider = getPlatformKey(account.platform);
		return uniqueIssueMessages([
			...(capabilityResolver.resolvedCapabilities[account.id]?.issues ?? [])
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
		const resolved = capabilityResolver.resolvedCapabilities[account.id];
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
		if (!capabilityResolver.capabilityReadinessKnown) return [];
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
		if (!capabilityResolver.capabilityReadinessKnown) return m.compose_load_readiness_failed();
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
						mediaCapabilityItemsFromIds(
							mediaIds,
							composerMedia.mediaMimeTypes,
							composerMedia.mediaSizes
						)
					);
				});
		return uniqueIssueMessages([
			...accountBlockers(account, false),
			...accountReadinessMessages(account),
			...(capabilityResolver.resolvedCapabilities[account.id]?.issues ?? [])
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
		if (issue.mediaId) composerMedia.previewMediaOpen = true;

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
			capabilityResolver.openDestinationSettings(account);
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
				`${composerMedia.previewMediaOpen && activeVariantAccountId ? '[data-testid="composer-media-editor"] ' : ''}[data-composer-media-id="${CSS.escape(issue.mediaId)}"]`
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
			mimeType: composerMedia.mediaMimeTypes.get(id) ?? 'application/octet-stream',
			altText: composerMedia.mediaAltTexts.get(id),
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
				Object.entries(capabilityResolver.resolvedCapabilities).map(([accountID, capability]) => [
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
					capabilityResolver.resolvedCapabilities[rendition.social_account_id]?.segment_strategy ===
						'join';
				if (
					index > 0 &&
					posts.length > 1 &&
					capabilityResolver.resolvedCapabilities[rendition.social_account_id]?.segment_strategy ===
						'join'
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
			const description =
				explicit !== undefined && (explicit || captionMentionsByAccount[account.id])
					? explicit
					: body;
			rendition.description = description;
			if (rendition.segments[0]) rendition.segments[0].description = description;
		}

		for (const rendition of payload.renditions) {
			const first = rendition.segments?.[0];
			if (first)
				first.settings = {
					...first.settings,
					caption_mentions: captionMentionsByAccount[rendition.social_account_id] ?? null
				};
			if (!first) continue;
			const settings = { ...first.settings };
			delete settings.attachment_requirement;
			const requirement = ai.aiAttachmentRequirements[rendition.social_account_id];
			if (requirement) settings.attachment_requirement = requirement;
			first.settings = settings;
		}
		if (ai.aiAppliedStrategies.length > 0) {
			payload.metadata[AI_BUILD_METADATA_KEY] = {
				version: 1,
				strategies: ai.aiAppliedStrategies
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
		ai.aiAppliedStrategies = builderMetadata.success ? builderMetadata.data.strategies : [];
		ai.aiAttachmentRequirements = Object.fromEntries(
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
		captionMentionsByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => {
				const parsed = z
					.object({
						field: z.enum(['description', 'video_description']),
						body: z.string(),
						mentions: z.unknown()
					})
					.safeParse(rendition.segments?.[0]?.settings?.caption_mentions);
				const caption = parsed.success ? parsed.data : undefined;
				const metadata = caption ? readMentionMetadata(caption.body, caption.mentions) : undefined;
				return [
					rendition.social_account_id,
					caption && metadata
						? { field: caption.field, body: caption.body, mentions: metadata }
						: null
				];
			})
		);
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
						(media.alt_text ?? '') !== (composerMedia.mediaAltTexts.get(media.id) ?? '')
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
			ai.aiAttachmentRequirements,
			posts.some((post) => post.poll),
			mediaSettingsByAccount
		);
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
		return composerMedia.mediaMimeTypes.get(mediaId)?.startsWith('video/') ?? false;
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
			composerMedia.setVariantMediaIds(activeVariantAccountId, postIndex, next);
		} else {
			posts = posts.map((item, index) =>
				index === postIndex ? { ...item, mediaIds: next } : item
			);
		}
		scheduleAutoSave();
		capabilityResolver.scheduleCapabilityResolve();
	}

	function openMediaPicker(postIndex: number) {
		const post = posts[postIndex];
		const target = post ? composerMedia.pasteMediaTargetForPost(post) : null;
		if (target && composerMedia.pasteMediaUploadsForTarget(target).length > 0) return;
		mediaPickerInitialFiles = [];
		mediaPickerInitialMode = 'upload';
		ai.clearPickerMeme();
		mediaPickerPostIndex = postIndex;
		mediaPickerOpen = true;
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
			media_alt_texts: Array.from(composerMedia.mediaAltTexts.entries()),
			media_mime_types: Array.from(composerMedia.mediaMimeTypes.entries()),
			media_sizes: Array.from(composerMedia.mediaSizes.entries()),
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
		composerMedia.mediaAltTexts = new SvelteMap(payload.media_alt_texts ?? []);
		composerMedia.mediaMimeTypes = new SvelteMap(payload.media_mime_types ?? []);
		composerMedia.mediaPreviewMetadata.clear();
		composerMedia.mediaSizes = new SvelteMap(payload.media_sizes ?? []);
		selectedDate = undefined;
		if (payload.selected_date) {
			const [year, month, day] = payload.selected_date.split('-').map(Number);
			selectedDate = new CalendarDate(year, month, day);
		}
		selectedTime = payload.selected_time ?? null;
		randomDelayOverride = payload.random_delay_override ?? 'default';
		repostOverride = structuredClone(payload.repost_override ?? { mode: 'inherit' });
		await loadAccounts(selectedWorkspaceId, selectedAccountIds);
		await capabilityResolver.resolveCapabilities();
		lastSavedSnapshot = getSaveSnapshot();
		return payload;
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
		composerMedia.pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		ai.generationUndo = null;
		ai.latestGenerationUndo = null;
		ai.aiAppliedResult = null;
		ai.aiAppliedStrategies = [];
		ai.aiAttachmentRequirements = {};
		ai.postBuilderError = '';
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
		composerMedia.mediaAltTexts = new Map();
		composerMedia.mediaMimeTypes = new Map();
		composerMedia.mediaPreviewMetadata.clear();
		composerMedia.mediaSizes = new Map();
		linkUrl = '';
		settingsByAccount = {};
		captionMentionsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		capabilityResolver.resolvedCapabilities = {};
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
			if (resolveAfter) await capabilityResolver.resolveCapabilities();
		}
	}

	async function initializeFromPublication(publication: Publication, resolveAfter = true) {
		// Content and its revision must come from the same read, including cached drafts.
		getComposerSession(publication.workspace_id).hydrate({
			publication,
			draft: publicationDraft(publication)
		});
		composerMedia.pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		ai.generationUndo = null;
		ai.latestGenerationUndo = null;
		ai.aiAppliedResult = null;
		ai.postBuilderError = '';
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
		composerMedia.mediaAltTexts = new Map();
		const publicationMedia = [
			...canonicalSegments.flatMap((segment) => segment.media ?? []),
			...(publication.media ?? []),
			...(publication.renditions ?? []).flatMap((rendition) => [
				...(rendition.media ?? []),
				...(rendition.segments ?? []).flatMap((segment) => segment.media ?? [])
			])
		];
		composerMedia.mediaMimeTypes = new Map(
			publicationMedia.map((media) => [media.id, media.mime_type] as const)
		);
		composerMedia.mediaSizes = new Map();
		composerMedia.mediaPreviewMetadata.clear();
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
				? composerMedia.hydrateMediaMetadata(publication.workspace_id, mediaIDs)
				: Promise.resolve(),
			loadAccounts(selectedWorkspaceId, selectedAccountIds)
		]);
		composerMedia.mediaAltTexts = new SvelteMap(
			[
				...(publication.media ?? []),
				...canonicalSegments.flatMap((segment) => segment.media ?? [])
			].map((media) => [media.id, media.alt_text ?? ''])
		);
		hydrateCanonicalSettings(publication);
		savedCardRenditions = publication.renditions;
		refreshSavedTextCardPreviews();
		if (resolveAfter) await capabilityResolver.resolveCapabilities();
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
			await capabilityResolver.resolveCapabilities();
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
					if (hasPendingPasteMediaUploads)
						return { ok: false, error: composerMedia.pasteMediaUploadBlocker() };
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
					composerMedia.pasteMediaUploadQueue.reset();
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
			error = composerMedia.pasteMediaUploadBlocker();
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
			await editorHandoff.restoreImageEditorReturn();
			await ai.restoreActivePublicationBuild();
		})();
		return () => {
			document.removeEventListener('visibilitychange', handleVisibilityChange);
			window.removeEventListener('pagehide', handlePageHide);
			unregisterComposerResetGuard();
			unregisterWorkspaceSwitchGuard();
		};
	});

	function invalidatePendingComposerRequests() {
		composerMedia.invalidateImagePreparation();
		workspaceRequestSequence++;
		accountRequestSequence++;
		nextSlotRequestSequence++;
		capabilityResolver.invalidate();
	}

	onDestroy(() => {
		composerDestroyed = true;
		void composerSession?.decideWorkspaceSwitch('stay');
		invalidatePendingComposerRequests();
		composerMedia.pasteMediaUploadQueue.reset();
		clearAutoSaveTimer();
		clearSavedIndicator();
		ai.dispose();
		capabilityResolver.dispose();
		composerMedia.dispose();
		for (const session of previewSessions.values()) session.close();
		previewSessions.clear();
		unsubscribeComposerSession?.();
	});

	beforeNavigate((navigation) => {
		if (hasPendingPasteMediaUploads) {
			navigation.cancel();
			error = composerMedia.pasteMediaUploadBlocker();
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
		composerMedia.mediaAltTexts = new SvelteMap(
			draft.media.map((item) => [item.id, item.alt_text])
		);
		composerMedia.mediaMimeTypes = new SvelteMap(
			draft.media.map((item) => [item.id, item.mime_type])
		);
		composerMedia.mediaSizes = new SvelteMap(draft.media.map((item) => [item.id, item.size]));
		void startFirstComposition(draft.media.length ? 'media' : 'text');
		scheduleAutoSave();
	});

	$effect(() => {
		const mediaIds = initialMediaIds;
		const workspaceParam = initialWorkspaceId;
		if (loadingWorkspaces || mediaIds.length === 0 || !selectedWorkspaceId) return;
		if (initialPublication && lastInitializedPublicationId !== initialPublication.id) return;
		if (workspaceParam && workspaceParam !== selectedWorkspaceId) return;
		void editorHandoff.applyInitialMediaHandoff(mediaIds);
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
		const inputSnapshot = capabilityResolver.capabilityInputSnapshot;
		if (
			!loadingWorkspaces &&
			!loadingAccounts &&
			inputSnapshot !== capabilityResolver.lastResolvedCapabilityInputSnapshot
		) {
			capabilityResolver.scheduleCapabilityResolve();
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
			error = composerMedia.pasteMediaUploadBlocker();
			return;
		}
		const resetWorkspaceState = Boolean(
			publicationId ||
			hasContent ||
			selectedDate ||
			selectedTime ||
			posts.some((post) => post.mediaIds.length > 0)
		);
		composerMedia.pasteMediaUploadQueue.reset();
		unsubscribeComposerSession?.();
		unsubscribeComposerSession = null;
		composerSession = null;
		clearAutoSaveTimer();
		ai.resetForWorkspaceChange();
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
		composerMedia.mediaAltTexts = new Map();
		composerMedia.mediaMimeTypes = new Map();
		composerMedia.mediaPreviewMetadata.clear();
		composerMedia.mediaSizes = new Map();
		linkUrl = '';
		settingsByAccount = {};
		captionMentionsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		capabilityResolver.resolvedCapabilities = {};
		validationIssues = [];
		settingsDialogOpen = false;
		settingsAccountId = '';
		capabilityResolver.resetForWorkspaceChange();
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
			composerMedia.pasteMediaUploadQueue.discardWhere(
				(upload) => upload.target.variantAccountId === id
			);
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
		capabilityResolver.scheduleCapabilityResolve();
	}

	function selectAllAccounts() {
		selectedAccountIds = compatibleAccounts.map((account) => account.id);
		selectedSocialSetId = '';
		scheduleAutoSave();
		capabilityResolver.scheduleCapabilityResolve();
	}

	function clearAllAccounts() {
		composerMedia.pasteMediaUploadQueue.discardWhere(
			(upload) => upload.target.variantAccountId !== null
		);
		selectedAccountIds = [];
		selectedSocialSetId = '';
		scheduleAutoSave();
		capabilityResolver.scheduleCapabilityResolve();
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
		composerMedia.pasteMediaUploadQueue.discardWhere(
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
		capabilityResolver.scheduleCapabilityResolve();
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
		const resolved = capabilityResolver.resolvedCapabilities[account.id];
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
		capabilityResolver.scheduleCapabilityResolve();
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
			composerMedia.pasteMediaUploadQueue.reset();
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
		const pasteUploadBlocker = composerMedia.pasteMediaUploadBlocker();
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
					const resolvedCurrent = await capabilityResolver.resolveCapabilitiesCurrent();
					const readinessFailure = resolvedCurrent
						? operationReadinessBlocker('publish_scheduled')
						: capabilityResolver.capabilityResolveError || m.compose_load_readiness_failed();
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
		const pasteUploadBlocker = composerMedia.pasteMediaUploadBlocker();
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
			if (!(await capabilityResolver.resolveCapabilitiesCurrent())) {
				throw new Error(
					capabilityResolver.capabilityResolveError || m.compose_load_readiness_failed()
				);
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
				const resolvedCurrent = await capabilityResolver.resolveCapabilitiesCurrent();
				const readinessFailure = resolvedCurrent
					? operationReadinessBlocker(publishNow ? 'publish_immediate' : 'publish_scheduled')
					: capabilityResolver.capabilityResolveError || m.compose_load_readiness_failed();
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
			composerMedia.pasteMediaUploadQueue.discardWhere(
				(upload) => upload.target.postKey === removedPostKey
			);
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
		composerMedia.previewMediaOpen = false;
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
			composerMedia.snapshotAccountMediaAltTexts(accountId, variant.mediaIds);
		}
		variants = new SvelteMap(variants).set(accountId, record);
		scheduleAutoSave();
	}

	function restoreSharedContent(account: SocialAccount) {
		const key = nativeDescriptionKey(account);
		if (key) {
			captionMentionsByAccount = { ...captionMentionsByAccount, [account.id]: null };
			updateAccountSetting(account, key, '');
		}
		resyncAccount(account.id);
	}

	function resyncAccount(accountId: string) {
		composerMedia.resetAccountMediaAltTexts(accountId);
		if (!variants.has(accountId)) return;
		composerMedia.pasteMediaUploadQueue.discardWhere(
			(upload) => upload.target.variantAccountId === accountId
		);
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
			composerMedia.resetAccountMediaAltTexts(accountId);
			composerMedia.pasteMediaUploadQueue.discardWhere(
				(upload) => upload.target.variantAccountId === accountId
			);
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
		return posts.length > 1 &&
			capabilityResolver.resolvedCapabilities[account.id]?.segment_strategy === 'join'
			? nativeDescriptionKey(account)
			: undefined;
	}
	function nativeHasCaptionOverride(account: SocialAccount): boolean {
		const key = nativeDescriptionKey(account);
		return (
			Boolean(captionMentionsByAccount[account.id]) ||
			Boolean(key && settingsByAccount[account.id]?.[key])
		);
	}
	function nativeHasCustomText(account: SocialAccount): boolean {
		return variantHasContentOverride(account.id) || nativeHasCaptionOverride(account);
	}
	function nativeEditableText(post: PostItem): string {
		if (activeVariantAccount && posts.indexOf(post) === 0) {
			const key = nativeDescriptionKey(activeVariantAccount);
			const value = key
				? parseComposerSettingOptionalString(settingsByAccount[activeVariantAccount.id]?.[key])
				: undefined;
			if (value !== undefined && (value || captionMentionsByAccount[activeVariantAccount.id]))
				return value;
		}
		if (activeVariantAccount && joinedDescriptionKey(activeVariantAccount))
			return authoredJoinedBody(activeVariantAccount);
		return getEditorContentForPost(post);
	}
	function resetNativeField(account: SocialAccount, field: 'content' | 'media') {
		if (field === 'content') {
			const key = nativeDescriptionKey(account);
			const hasCaptionOverride = nativeHasCaptionOverride(account);
			const resetCaptionOnly = Boolean(joinedDescriptionKey(account) && hasCaptionOverride);
			if (key && hasCaptionOverride) {
				captionMentionsByAccount = { ...captionMentionsByAccount, [account.id]: null };
				updateAccountSetting(account, key, '');
			}
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
			capabilityResolver.resolvedCapabilities[activeVariantAccount.id]?.segment_strategy === 'join'
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
			// A native caption replaces the delivered description, not authored source text.
			const field = joinedDescriptionKey(account)!;
			captionMentionsByAccount = {
				...captionMentionsByAccount,
				[id]: { field, body: value, mentions: mentions ?? { version: 1, spans: [] } }
			};
			updateAccountSetting(account, field, value);
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
		capabilityResolver.scheduleCapabilityResolve();
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
		ai.postBuilderError = '';
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
		if (
			descriptionKey &&
			description !== undefined &&
			posts[0] &&
			!captionMentionsByAccount[account.id]
		) {
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
		const caption = native && account ? captionMentionsByAccount[account.id] : undefined;
		if (caption && caption.body === body) return { body, mentions: caption.mentions.spans };
		const variant = account ? variants.get(account.id)?.[post.key] : undefined;
		const metadata = variant && !variant.contentInherited ? variant.mentions : post.mentions;
		if (
			native &&
			account &&
			posts.length > 1 &&
			capabilityResolver.resolvedCapabilities[account.id]?.segment_strategy === 'join'
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
	const textShortening = new ComposerTextShortening(composer);

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
		composerMedia.pasteMediaUploadQueue.reset();
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
		captionMentionsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		capabilityResolver.resolvedCapabilities = {};
		validationIssues = [];
		ai.generationUndo = null;
		ai.latestGenerationUndo = null;
		ai.aiAppliedResult = null;
		ai.aiAppliedStrategies = [];
		ai.aiAttachmentRequirements = {};
		ai.repurposePrivateContextNotes = '';
		ai.repurposeReviewActive = false;
		ai.postBuilderError = '';
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
			if (account) capabilityResolver.openDestinationSettings(account);
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
		(capabilityResolver.resolvedCapabilities[activeVariantAccountId!]?.segment_strategy ===
			'join' ||
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
				captioningIds={composerMedia.captioningMediaIds}
				failedCaptionIds={composerMedia.failedCaptionMediaIds}
				editing={composerMedia.editingAltMediaId === media.id}
				onRetryCaption={composerMedia.retryMediaAltText}
				onRemove={() => {
					for (const index of sourceIndexes) {
						const ids = getEditorMediaIdsForPost(posts[index]);
						composerMedia.removeMedia(index, ids.indexOf(media.id));
					}
				}}
				onAltText={composerMedia.setMediaAltText}
				onToggleAlt={() =>
					(composerMedia.editingAltMediaId =
						composerMedia.editingAltMediaId === media.id ? null : media.id)}
				onDoneAlt={() => (composerMedia.editingAltMediaId = null)}
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
			ondragover={composerMedia.handleDragOver}
			ondragleave={composerMedia.handleDragLeave}
			ondrop={(event) => composerMedia.handleDrop(event, index)}
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
					onpaste={(event) => composerMedia.handlePaste(event, index)}
					onfocus={() => setActivePost(index)}
					placeholder={m.compose_ai_idea_placeholder()}
					disabled={isSubmitting || ai.buildingPost}
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
			disabled={isSubmitting || ai.buildingPost}
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
			disabled={isSubmitting || ai.buildingPost}
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
			disabled={isSubmitting || ai.buildingPost}
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
<!-- Controls shared by the phone and desktop composer toolbars. -->
{#snippet socialSetControl()}
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
{/snippet}

{#snippet saveIndicator()}
	{#if autoSavesDraft}
		<SaveIndicator
			saving={isSaving}
			saved={savedIndicatorVisible}
			savingLabel={m.common_saving()}
			savedLabel={m.compose_saved_state()}
			testId="composer-save-indicator"
		/>
	{/if}
{/snippet}

{#snippet validationMenu()}
	{#if accounts.length > 0}
		<ComposerValidationMenu
			issues={visibleGlobalIssues}
			onSelect={focusComposerIssue}
			onShorten={textShortening.shortenFromIssue}
			shorteningIssueId={textShortening.shorteningKey}
		/>
	{/if}
{/snippet}

{#snippet publishActions(className?: string)}
	<ComposerPublishActions
		class={className}
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
		quickScheduleDisabledReason={scheduleDisabledReason}
		{scheduleDisabledReason}
		{publishDisabledReason}
		onSchedule={openScheduleDialog}
		onQuickSchedule={quickSchedule}
		onPublish={() => publish(true)}
		onDelete={publicationId ? requestDraftDelete : undefined}
	/>
{/snippet}

<svelte:window onkeydowncapture={textShortening.handleShortenUndoShortcut} />

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
				{@render socialSetControl()}
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
				{@render saveIndicator()}
				{@render validationMenu()}
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
					{@render publishActions('w-full')}
				{/if}
			</div>
		</div>
	{:else}
		<div
			class="flex flex-wrap items-center justify-between gap-2 border-b px-4 py-3"
			data-testid="desktop-composer-controls"
		>
			<div class="flex flex-wrap items-center gap-2">
				{@render socialSetControl()}

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
				{@render saveIndicator()}
			</div>

			<div class="flex flex-wrap items-center gap-1.5 md:gap-2">
				{@render validationMenu()}
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

				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class="hidden text-muted-foreground xl:inline-flex"
								onclick={toggleSidePreview}
								aria-label={sidePreviewVisible
									? m.compose_hide_preview()
									: m.compose_show_preview()}
								aria-pressed={sidePreviewVisible}
								data-testid="composer-side-preview-toggle"
							>
								<ThemeIcon role="eye" class="size-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p class="text-sm">
							{sidePreviewVisible ? m.compose_hide_preview() : m.compose_show_preview()}
						</p>
					</Tooltip.Content>
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
					{@render publishActions()}
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
		blockedReason={canSchedulePublication ? '' : scheduleDisabledReason}
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
	{:else if capabilityResolver.capabilityResolveError}
		<AppToast
			message={capabilityResolver.capabilityResolveError}
			tone="error"
			dismissLabel={m.common_dismiss()}
			onDismiss={() => (capabilityResolver.capabilityResolveError = '')}
			actionLabel={m.common_retry()}
			onAction={() => void capabilityResolver.resolveCapabilities()}
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
	<p class="sr-only" role="status" aria-live="polite">{composerMedia.pasteMediaAnnouncement}</p>

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
				{#each Object.entries(ai.aiAttachmentRequirements).filter(([accountID]) => selectedAccountIds.includes(accountID) && (!activeVariantAccountId || activeVariantAccountId === accountID)) as [accountID, requirement] (accountID)}
					{@const account = selectedAccounts.find((item) => item.id === accountID)}
					{@const attached = posts.some((post) =>
						(getVariantMediaIds(accountID, post.key) ?? post.mediaIds).some((id) =>
							composerMedia.mediaMimeTypes.get(id)?.startsWith(`${requirement.kind}/`)
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
									ai.requirementReviewId = accountID;
									ai.requirementReviewText = posts[0]
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
									nativeHasCaptionOverride(activeVariantAccount))
									? joinedDescriptionKey(activeVariantAccount)
										? m.compose_preview_reset()
										: m.compose_reset_field()
									: undefined}
								hasMediaOverride={variantHasMediaOverride(activeVariantAccount.id)}
								isUnsynced={activeVariantIsUnsynced}
								uploadsPending={hasPendingPasteMediaUploads}
								restorableImages={composerMedia.restorableImages}
								restorablePending={!!composerMedia.fittingImageId}
								multiAccount={selectedAccounts.length > 1}
								segmentStrategy={capabilityResolver.resolvedCapabilities[activeVariantAccount.id]
									?.segment_strategy}
								postCount={posts.length}
								onPreview={() => openAccountPreview(activeVariantAccount!)}
								onUseOriginalImage={composerMedia.restoreOriginalImage}
								onSettings={() => capabilityResolver.openDestinationSettings(activeVariantAccount!)}
								onResetField={(field) => resetNativeField(activeVariantAccount!, field)}
								onToggleSync={() => {
									const account = activeVariantAccount!;
									if (nativeHasCustomText(account) || variantHasMediaOverride(account.id))
										restoreSharedContent(account);
									else detachSharedContent(account.id);
								}}
								onResync={() => restoreSharedContent(activeVariantAccount!)}
								onDestinationAction={destinationActions.openDestinationAction}
							/>
						{/if}
					</section>
				{/if}

				{#if !activeVariantAccountId && selectedAccounts.length > 0}
					<ComposerRequiredFields
						accounts={selectedAccounts}
						resolvedByAccount={capabilityResolver.resolvedCapabilities}
						valuesByAccount={requiredValuesByAccount}
						optionGroupsByAccount={capabilityResolver.destinationOptionsByAccount}
						optionErrorsByAccount={capabilityResolver.destinationOptionsErrors}
						optionsLoadingAccountIds={capabilityResolver.destinationOptionsLoadingAccountIds}
						onChange={updateAccountSetting}
						onFormatChange={selectDestinationFormat}
						onAddMedia={() => openMediaPicker(activePostIndex)}
						mediaActionDisabled={hasPendingPasteMediaUploads}
					/>
				{/if}

				{#if ai.visibleAIStrategies.length > 0}
					<Disclosure summary={m.compose_ai_strategy_label()} summaryClass="text-muted-foreground">
						<div
							class="mb-3 flex gap-2 overflow-x-auto border-y py-3"
							aria-label={m.compose_ai_strategy_label()}
						>
							{#each ai.visibleAIStrategies as destination (destination.account_id)}
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
					</Disclosure>
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
									capabilityResolver.openDestinationSettings(
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

				{#if composerMedia.imagePreparationNotice}<p
						class="py-2 text-sm text-muted-foreground"
						role="status"
					>
						{composerMedia.imagePreparationNotice}
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
									media: composerMedia.previewMediaOpen ? undefined : nativePostMedia,
									title: nativePostTitle,
									card: nativeLinkCard,
									poll: nativePoll
								}}
							/>
							{#if composerMedia.imageFitCandidates(activeVariantAccount).length}
								<div class="space-y-2 border-t py-3" data-testid="composer-image-fit">
									<p class="text-sm text-muted-foreground">{m.compose_image_fit_help()}</p>
									<div class="flex flex-wrap gap-2">
										{#each composerMedia.imageFitCandidates(activeVariantAccount) as id (id)}
											<Button
												variant="outline"
												size="sm"
												disabled={!!composerMedia.fittingImageId}
												aria-busy={composerMedia.fittingImageId === id}
												onclick={() => composerMedia.fitAccountImage(activeVariantAccount!, id)}
												>{composerMedia.fittingImageId === id
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
								{@const pendingMediaUploads = composerMedia.visiblePasteMediaUploads(post)}
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
											aria-expanded={composerMedia.previewMediaOpen}
											onclick={() =>
												(composerMedia.previewMediaOpen = !composerMedia.previewMediaOpen)}
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
								{#if composerMedia.previewMediaOpen}
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
														composerMedia.visiblePasteMediaUploads(source).length}
													altTexts={editorMediaAltTexts}
													captioningIds={composerMedia.captioningMediaIds}
													failedCaptionIds={composerMedia.failedCaptionMediaIds}
													bind:editingAltMediaId={composerMedia.editingAltMediaId}
													pendingUploads={composerMedia.visiblePasteMediaUploads(source)}
													queue={composerMedia.pasteMediaUploadQueue}
													{isVideoMedia}
													onRemoveMedia={(mediaIndex) =>
														composerMedia.removeMedia(index, mediaIndex)}
													onAltText={composerMedia.setMediaAltText}
													onRetryCaption={composerMedia.retryMediaAltText}
												/>
											</div>
										{/each}
									</div>
								{:else}
									<PasteUploadList
										uploads={pendingMediaUploads}
										mediaCount={getEditorMediaIdsForPost(post).length + pendingMediaUploads.length}
										baseCount={getEditorMediaIdsForPost(post).length}
										queue={composerMedia.pasteMediaUploadQueue}
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
								{@const pendingMediaUploads = composerMedia.visiblePasteMediaUploads(post)}
								{@const pasteFeedback = composerMedia.visiblePasteMediaFeedback(post)}
								{@const editorMediaCount = editorMediaIds.length + pendingMediaUploads.length}
								<div
									class="group/post relative {composerMedia.isDraggingFile && activePostIndex === i
										? 'bg-primary/5'
										: ''}"
									role="region"
									aria-label={m.compose_drop_zone({ number: i + 1 })}
									onfocusin={() => setActivePost(i)}
									ondragover={composerMedia.handleDragOver}
									ondragleave={composerMedia.handleDragLeave}
									ondrop={(e) => composerMedia.handleDrop(e, i)}
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
														onpaste={(event) => composerMedia.handlePaste(event, i)}
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
															ai.buildingPost ||
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
														onclick={() => (composerMedia.pasteMediaFeedback = null)}
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
												captioningIds={composerMedia.captioningMediaIds}
												failedCaptionIds={composerMedia.failedCaptionMediaIds}
												bind:editingAltMediaId={composerMedia.editingAltMediaId}
												pendingUploads={pendingMediaUploads}
												queue={composerMedia.pasteMediaUploadQueue}
												{isVideoMedia}
												onRemoveMedia={(mi) => composerMedia.removeMedia(i, mi)}
												onAltText={composerMedia.setMediaAltText}
												onRetryCaption={composerMedia.retryMediaAltText}
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
													shortening={textShortening.shorteningKey === 'counter'}
													onShorten={(limit) => textShortening.shortenFromCounter(i, limit)}
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
														building={ai.buildingPost}
														disabled={!canBuildPost}
														ideateLabel={m.nav_ideas()}
														buildLabel={ai.generationUndo
															? m.compose_ai_build_again()
															: m.compose_ai_build()}
														buildingLabel={m.compose_ai_building()}
														onclick={ai.buildPostWithAI}
													/>
												{/if}
											</div>

											{#if i === 0 && !activeVariantAccountId && !isThread && ai.postBuilderError}
												<p class="border-t py-3 text-sm text-destructive" role="alert">
													{ai.postBuilderError}
												</p>
											{:else if i === 0 && !activeVariantAccountId && ai.generationUndo}
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
																onclick={ai.convertGeneratedThreadToPost}
															>
																{m.compose_ai_convert_to_post()}
															</Button>
														{/if}
														{#if ai.latestGenerationUndo && ai.latestGenerationUndo !== ai.generationUndo}
															<Button
																type="button"
																variant="ghost"
																size="sm"
																class="min-h-11 gap-1.5 md:min-h-8"
																onclick={ai.undoLatestGenerationApply}
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
															onclick={ai.restoreIdea}
														>
															<ThemeIcon role="undo" class="size-3.5" />
															{m.compose_ai_restore_idea()}
														</Button>
													</div>
												</div>
												{#if ai.aiMemeCandidates.length > 0 || ai.aiMemeError}
													<div class="border-t py-4">
														<AIMemeRecommendation
															candidates={ai.aiMemeCandidates}
															copy={ai.aiMemeCopy}
															bind:selectedCandidateId={ai.aiMemeSelectedID}
															error={ai.aiMemeError}
															onUse={ai.useAIMeme}
															onEdit={ai.editAIMeme}
															onRetry={ai.previewAIMemeCandidate}
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
		{#if wideLayout && sidePreviewVisible && sidePreviewAccount}
			{@const sidePreviewModel = previewForAccount(sidePreviewAccount)}
			<aside
				class="flex w-[22rem] shrink-0 flex-col border-l bg-muted/20"
				aria-label={m.compose_preview()}
				data-testid="composer-side-preview"
			>
				<div
					class="flex shrink-0 items-center justify-between gap-2 border-b bg-background/60 px-4 py-3"
				>
					<p class="min-w-0 truncate text-sm font-medium">{m.compose_preview()}</p>
					<Button
						variant="ghost"
						size="icon-sm"
						class="shrink-0 text-muted-foreground"
						onclick={toggleSidePreview}
						aria-label={m.compose_hide_preview()}
						data-testid="composer-side-preview-hide"
					>
						<ThemeIcon role="close" class="size-4" />
					</Button>
				</div>
				<div class="min-h-0 flex-1 overflow-y-auto p-4">
					<ComposerPreview model={sidePreviewModel} />
				</div>
			</aside>
		{/if}
	</div>
</div>

<ComposerAIWorkspace {ai} accounts={selectedAccounts} workspaceId={selectedWorkspaceId} />

<DestinationActionDialog
	action={destinationActions}
	accounts={selectedAccounts}
	activeAccountId={activeVariantAccountId}
	uploadsPending={hasPendingPasteMediaUploads}
	{accountLabel}
/>

<ComposerSettingsSheet
	bind:open={composerSettingsOpen}
	workspaceId={selectedWorkspaceId}
	{publicationId}
	{reviewState}
	prepareReview={prepareClientReview}
	onReviewChanged={applyClientReview}
	sourcePlatforms={[
		...new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))
	]}
	bind:repostOverride
	busy={isSaving || isSubmitting}
	onRepostChange={scheduleAutoSave}
	{onOpenVersionHistory}
	{onCopyAsDraft}
	{copyingDraft}
/>

<MediaPicker
	bind:open={mediaPickerOpen}
	workspaceId={selectedWorkspaceId}
	currentSelection={mediaPickerInitialMode === 'meme'
		? []
		: posts[mediaPickerPostIndex]
			? getEditorMediaIdsForPost(posts[mediaPickerPostIndex])
			: []}
	currentMediaMimeTypes={Object.fromEntries(composerMedia.mediaMimeTypes)}
	maxSelection={composerMediaLimit}
	multiple={composerMediaLimit > 1}
	purpose={isThread ? 'thread_segment' : 'post_media'}
	enableMeme
	compactNavigation
	autoConfirmUploads
	initialMode={mediaPickerInitialMode}
	memeInitialIdea={ai.mediaPickerMemeIdea}
	memeInitialCandidate={ai.mediaPickerMemeCandidate}
	memeInitialPreview={ai.mediaPickerMemePreview}
	initialFiles={mediaPickerInitialFiles}
	onInitialFilesConsumed={() => (mediaPickerInitialFiles = [])}
	onConfirm={async (ids) => {
		const postContext = posts[mediaPickerPostIndex]
			? getEditorContentForPost(posts[mediaPickerPostIndex])
			: '';
		const previousIds = posts[mediaPickerPostIndex]
			? getEditorMediaIdsForPost(posts[mediaPickerPostIndex])
			: [];
		if (mediaPickerInitialMode === 'meme' && ai.mediaPickerMemeCandidate) {
			if (!(await ai.confirmPickerMeme(ids))) return false;
			mediaPickerInitialMode = 'upload';
			return true;
		}
		const addedIds = ids.filter((id) => !previousIds.includes(id));
		const post = posts[mediaPickerPostIndex];
		if (!post) return false;
		const target = composerMedia.pasteMediaTargetForPost(post);
		if (!target) return false;
		const authoredContext = composerMedia.imagePreparationContext;
		const preparedAdded = await composerMedia.prepareNewImageIds(addedIds, target.workspaceId);
		if (
			!preparedAdded ||
			authoredContext !== composerMedia.imagePreparationContext ||
			!arraysEqual(composerMedia.mediaIdsForPasteTarget(target), previousIds)
		)
			return false;
		const preparedIds = ids.map((id) => {
			const index = addedIds.indexOf(id);
			return index < 0 ? id : preparedAdded[index];
		});
		composerMedia.setPasteTargetMediaIds(target, preparedIds);
		void composerMedia.generateMissingMediaAltText(
			preparedIds.filter((id) => !previousIds.includes(id)),
			postContext
		);
	}}
	onCreate={editorHandoff.openImageEditorFromComposer}
	onCreateTemplate={editorHandoff.openTemplateEditorFromComposer}
	onCreateVideo={editorHandoff.openVideoEditorFromComposer}
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
	optionGroups={settingsAccount
		? (capabilityResolver.destinationOptionsByAccount[settingsAccount.id] ?? {})
		: {}}
	optionNextCursors={settingsAccount
		? (capabilityResolver.destinationOptionCursorsByAccount[settingsAccount.id] ?? {})
		: {}}
	optionsLoading={settingsAccount
		? capabilityResolver.destinationOptionsLoadingAccountIds.has(settingsAccount.id)
		: false}
	optionsError={settingsAccount
		? (capabilityResolver.destinationOptionsErrors[settingsAccount.id] ?? '')
		: ''}
	scopeLabel={isThread ? m.compose_thread_post({ number: activePostIndex + 1 }) : ''}
	formatValue={settingsAccount
		? requestedOutputProfiles[settingsAccount.id] ||
			capabilityResolver.resolvedCapabilities[settingsAccount.id]?.output_profile ||
			''
		: ''}
	formatOptions={settingsAccount && accountUsesManualFormat(settingsAccount)
		? destinationFormatOptions(settingsAccount)
		: []}
	formatRequired={settingsAccount
		? (capabilityResolver.resolvedCapabilities[settingsAccount.id]?.format_selection_required ??
			false)
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
			void capabilityResolver.loadDestinationOptions(
				settingsAccount,
				true,
				setting.options_source,
				search
			);
		}
	}}
	onOptionLoadMore={(setting) => {
		if (settingsAccount && setting.options_source) {
			void capabilityResolver.loadDestinationOptions(
				settingsAccount,
				true,
				setting.options_source,
				'',
				true
			);
		}
	}}
	onRetry={() => {
		if (settingsAccount) void capabilityResolver.loadDestinationOptions(settingsAccount, true);
	}}
	onFileChange={uploadDestinationSettingFile}
	onEditCover={editorHandoff.editDestinationCover}
/>

<WorkspaceSwitchDialog
	state={workspaceSwitchState}
	editMode={isEditMode}
	onStay={stayInComposerWorkspace}
	onDiscard={discardBeforeWorkspaceSwitch}
	onSave={saveBeforeWorkspaceSwitch}
/>

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
