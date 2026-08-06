<script lang="ts">
	import { onDestroy, onMount, tick } from 'svelte';
	import { page } from '$app/stores';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { MediaQuery, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { client, type SocialAccount, type Workspace, getToken } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { isSupportedMediaFile, uploadMediaFile } from '$lib/media-upload-client';
	import {
		MAX_COMPOSER_DRAFT_MEDIA,
		mediaCapabilityItemsFromIds,
		providerMediaWarningMessages
	} from '$lib/media-capabilities';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import SocialSetControl from './social-set-control.svelte';
	import ComposerRequiredFields from './composer-required-fields.svelte';
	import ComposerPublishActions from './composer-publish-actions.svelte';
	import SaveIndicator from './save-indicator.svelte';
	import ComposerScheduleDialog from './composer-schedule-dialog.svelte';
	import ComposerRepostControl from './composer-repost-control.svelte';
	import ComposerValidationMenu from './composer-validation-menu.svelte';
	import DestinationSettingsDialog from './destination-settings-dialog.svelte';
	import PlatformIcon from './platform-icon.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { CalendarDate, isEqualDay } from '@internationalized/date';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import XIcon from 'lucide-svelte/icons/x';
	import LightbulbIcon from 'lucide-svelte/icons/lightbulb';
	import ShuffleIcon from 'lucide-svelte/icons/shuffle';
	import CheckIcon from 'lucide-svelte/icons/check';
	import ImageIcon from 'lucide-svelte/icons/image';
	import UnlinkIcon from 'lucide-svelte/icons/unlink';
	import GripVerticalIcon from 'lucide-svelte/icons/grip-vertical';
	import Trash2Icon from 'lucide-svelte/icons/trash-2';
	import TypeIcon from 'lucide-svelte/icons/type';
	import MoreHorizontalIcon from 'lucide-svelte/icons/ellipsis';
	import LinkIcon from 'lucide-svelte/icons/link';
	import { ui } from '$lib/stores/ui.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { ReorderableList } from 'svelte-reorderable-list';
	import { m } from '$lib/paraglide/messages';
	import { getLocaleTag } from '$lib/i18n';
	import {
		type PostItem,
		makeEmptyPost,
		encodeThreadDraft,
		isThreadDraft,
		decodeThreadDraft,
		getDraftSnapshot,
		hasAnyContent,
		type VariantPost
	} from './compose/draft-utils';
	import {
		minimumAccountCharacterLimit,
		platformTextLength,
		uniquePlatformLimits
	} from './compose/platform-limits';
	import { editorAccountIdAfterVariantLoad } from './compose/editor-target';
	import { isActionableAccountIssue } from './compose/account-attention';
	import {
		composerIssues,
		isAccountSpecificIssue,
		issueMatchesProvider,
		uniqueIssueMessages
	} from './compose/validation';
	import { loadableDestinationOptionSources } from './compose/destination-options';
	import {
		workspaceClock,
		workspaceScheduleFromISO,
		workspaceScheduleToISO
	} from './compose/schedule-timezone';
	import {
		buildPublicationPayload,
		type ComposerModeKey,
		type ComposerPublicationPayload,
		type PublicationMediaInput,
		type ResolvedComposerTarget
	} from './compose/modes';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import AppToast from './app-toast.svelte';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import DraftConflictDialog from './draft-conflict-dialog.svelte';
	import PromptApplyDialog from './prompt-apply-dialog.svelte';
	import MediaPicker from './media-picker.svelte';
	import {
		consumeImageEditorReturnToken,
		createImageEditorReturnToken
	} from '$lib/image-editor/api';
	import {
		clearComposerRecovery,
		loadComposerRecovery,
		storeComposerRecovery
	} from '$lib/image-editor/recovery';
	import type { ComposerRecoverySnapshot } from '$lib/image-editor/types';
	import { parseDraftConflict, type DraftConflictProblem } from '$lib/draft-conflict';
	import { SerializedSaveQueue } from '$lib/serialized-save-queue';
	import { buildComposerPreview } from '$lib/compose-preview';
	import { openPreviewWindow, type PreviewWindowSession } from '$lib/preview-window';

	// --------------------------------------------------------------------------
	// Types
	// --------------------------------------------------------------------------
	interface InitialPost {
		id: string;
		publication_id?: string;
		workspace_id: string;
		content: string;
		thread_draft?: string | null;
		repost_override?: components['schemas']['Override'];
		status: string;
		revision: number;
		scheduled_at: string;
		random_delay_minutes?: number;
		media?: Array<{ media_id: string; mime_type?: string; alt_text?: string }> | null;
		destinations?: Array<{ social_account_id: string; platform: string }> | null;
	}

	type Publication = components['schemas']['PublicationResponse'];
	type SocialSet = components['schemas']['SocialSetResponse'];
	type Capability = components['schemas']['Capability'];
	type SettingDefinition = components['schemas']['SettingDefinition'];
	type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
	type DestinationOption = components['schemas']['DestinationOption'];
	type ValidationIssue = components['schemas']['ValidationIssue'];

	type PersistedVariant = {
		social_account_id: string;
		content: string;
		media_ids: string;
		is_unsynced: boolean;
	};

	interface ImageEditorComposerSnapshotPayload {
		posts: PostItem[];
		variants: Array<[string, Record<string, VariantPost>]>;
		active_post_index: number;
		selected_account_ids: string[];
		selected_social_set_id: string;
		requested_output_profiles: Record<string, string>;
		format_locked_by_account: Record<string, boolean>;
		schedule_overrides_by_account: Record<string, string>;
		active_variant_account_id: string | null;
		draft_id: string | null;
		publication_id: string;
		link_url: string;
		show_link_input: boolean;
		settings_by_account: Record<string, Record<string, unknown>>;
		segment_settings_by_post: Record<string, Record<string, Record<string, unknown>>>;
		media_settings_by_account: Record<string, Record<string, Record<string, unknown>>>;
		media_alt_texts: Array<[string, string]>;
		media_mime_types: Array<[string, string]>;
		media_sizes: Array<[string, number]>;
		selected_date?: string;
		selected_time: string | null;
		random_delay_override: string;
		repost_override: components['schemas']['Override'];
	}

	interface Props {
		initialPost?: InitialPost;
		initialPublication?: Publication | null;
		initialScheduleDate?: string | null;
		initialScheduleTime?: string | null;
		initialWorkspaceId?: string | null;
		onSuccess?: () => void;
		onDeleted?: () => void;
		onDraftCreated?: (id: string) => void;
		onThreadStateChange?: (isThread: boolean) => void;
	}

	// --------------------------------------------------------------------------
	// Props & core state
	// --------------------------------------------------------------------------
	let {
		initialPost,
		initialPublication = null,
		initialScheduleDate = null,
		initialScheduleTime = null,
		initialWorkspaceId = null,
		onSuccess,
		onDeleted,
		onDraftCreated,
		onThreadStateChange
	}: Props = $props();
	let isEditMode = $derived(Boolean(initialPost || initialPublication));
	let publicationOnlyEdit = $derived(Boolean(initialPublication && !initialPost));

	let posts = $state<PostItem[]>([makeEmptyPost()]);
	let activePostIndex = $state(0);
	let draftId = $state<string | null>(null);
	let publicationId = $state('');
	let revision = $state(1);
	let lastInitializedPostId = $state<string | null>(null);
	let lastInitializedPublicationId = $state<string | null>(null);
	let isSaving = $state(false);
	let isSubmitting = $state(false);
	let isDeleting = $state(false);
	let showDeleteConfirm = $state(false);
	let error = $state('');
	let success = $state('');
	let draftConflict = $state<DraftConflictProblem | null>(null);
	let conflictDialogOpen = $state(false);
	let linkUrl = $state('');
	let showLinkInput = $state(false);

	let workspaces = $state<Workspace[]>([]);
	let selectedWorkspaceId = $state<string>('');
	let accounts = $state<SocialAccount[]>([]);
	let selectedAccountIds = $state<string[]>([]);
	let selectedSocialSetId = $state('');
	let capabilities = $state<Capability[]>([]);
	let requestedOutputProfiles = $state<Record<string, string>>({});
	let formatLockedByAccount = $state<Record<string, boolean>>({});
	let scheduleOverridesByAccount = $state<Record<string, string>>({});
	let loadingWorkspaces = $state(true);
	let loadingAccounts = $state(false);
	let workspaceLoadError = $state('');
	let workspaceSettingsError = $state('');
	let workspaceChangeNotice = $state('');
	let accountLoadError = $state('');
	let accountsWorkspaceId = $state('');
	let accountRetryIds: string[] | undefined = undefined;
	let workspaceRequestSequence = 0;
	let accountRequestSequence = 0;
	let nextSlotRequestSequence = 0;
	let saveGeneration = 0;
	const saveQueue = new SerializedSaveQueue<string | null>(() => publicationId || null);
	let allowNavigationOnce = false;

	let selectedDate = $state<CalendarDate | undefined>(undefined);
	let selectedTime = $state<string | null>(null);
	let suggestingSlot = $state(false);
	let showScheduleDialog = $state(false);
	let scheduleInputError = $state('');
	let randomDelayOverride = $state<string>('default');
	let repostOverride = $state<components['schemas']['Override']>({ mode: 'inherit' });

	let showPromptCard = $state(false);
	let currentPrompt = $state<{ text: string; example: string; category: string } | null>(null);
	let loadingPrompt = $state(false);
	let promptApplyDialogOpen = $state(false);
	let pendingPromptToApply = $state<{ text: string; example: string } | null>(null);

	let variants = $state<Map<string, Record<string, VariantPost>>>(new Map());
	let activeVariantAccountId = $state<string | null>(null);
	let destinationActionOpen = $state(false);
	let destinationAction = $state<'copy' | 'media'>('copy');
	let destinationActionTargetIds = $state<string[]>([]);

	let isDraggingFile = $state(false);
	let isUploading = $state(false);

	let mediaAltTexts = $state<Map<string, string>>(new Map());
	let mediaMimeTypes = $state<Map<string, string>>(new Map());
	let mediaSizes = $state<Map<string, number>>(new Map());
	let editingAltMediaId = $state<string | null>(null);
	let settingsByAccount = $state<Record<string, Record<string, unknown>>>({});
	let segmentSettingsByPost = $state<Record<string, Record<string, Record<string, unknown>>>>({});
	let mediaSettingsByAccount = $state<Record<string, Record<string, Record<string, unknown>>>>({});
	let mediaPickerOpen = $state(false);
	let mediaPickerPostIndex = $state(0);
	let resolvedCapabilities = $state<Record<string, ResolvedAccountCapability>>({});
	let capabilityResolveLoading = $state(false);
	let capabilityResolveError = $state('');
	let validationIssues = $state<ValidationIssue[]>([]);
	let settingsDialogOpen = $state(false);
	let settingsAccountId = $state('');
	let destinationOptionsByAccount = $state<Record<string, Record<string, DestinationOption[]>>>({});
	let destinationOptionsErrors = $state<Record<string, string>>({});
	let destinationOptionsLoadingAccountId = $state('');
	let capabilityResolveTimer: ReturnType<typeof setTimeout> | null = null;
	let destinationOptionsRequestSequence = 0;
	let capabilityResolveRequestSequence = 0;

	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let savedIndicatorTimer: ReturnType<typeof setTimeout> | null = null;
	let savedIndicatorVisible = $state(false);
	let lastSavedSnapshot = $state('');
	let appliedInitialContextKey = $state('');
	const previewSessions = new SvelteMap<string, PreviewWindowSession>();
	const textareaRefs = new SvelteMap<number, HTMLTextAreaElement>();
	const randomDelayOptions = [0, 5, 10, 15, 30, 45, 60];
	const desktopComposerControls = new MediaQuery('min-width: 768px');
	const accountControlLoading = $derived(loadingWorkspaces || loadingAccounts);
	const selectedWorkspaceSettingsReady = $derived(
		Boolean(selectedWorkspaceId) &&
			workspaceCtx.currentWorkspace?.id === selectedWorkspaceId &&
			workspaceCtx.settingsReady
	);

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
		for (let hour = start; hour <= end; hour++) {
			for (let min = 0; min < 60; min += interval) {
				if (hour === end && min > 0) break;
				slots.push(`${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`);
			}
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
	const hasContent = $derived(hasAnyContent(posts));
	const totalChars = $derived(posts.reduce((sum, p) => sum + p.content.length, 0));
	const isThread = $derived(posts.length > 1);
	const textComposerMode = $derived<ComposerModeKey>(isThread ? 'thread' : 'post');
	const compatibleAccounts = $derived(accounts);
	const autoSavesDraft = $derived(
		!isEditMode || initialPost?.status === 'draft' || initialPublication?.status === 'draft'
	);
	const selectedAccounts = $derived(
		selectedAccountIds
			.map((id) => accounts.find((account) => account.id === id))
			.filter((account): account is SocialAccount => Boolean(account))
	);
	// Keep drafts permissive so one attachment can transition into a provider's
	// multi-image profile. Destination-specific limits are resolved and block
	// validation/publishing without discarding the user's media selection.
	const composerMediaLimit = MAX_COMPOSER_DRAFT_MEDIA;
	const settingsAccount = $derived(
		accounts.find((account) => account.id === settingsAccountId) ?? null
	);
	const settingsDialogFields = $derived(settingsAccount ? visibleSettings(settingsAccount) : []);
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
	const localBlockers = $derived(globalFormBlockers());
	const globalIssues = $derived(composerIssues(localBlockers, validationIssues));
	const visibleGlobalIssues = $derived(hasContent ? globalIssues : []);
	const accountIssues = $derived.by(() =>
		Object.fromEntries(
			selectedAccounts
				.map((account) => [account.id, accountIssueMessages(account)] as const)
				.filter(([, issues]) => issues.length > 0)
		)
	);
	const accountBlockingMessages = $derived(
		selectedAccounts.flatMap((account) => accountBlockers(account))
	);
	const sharedProviderKeys = $derived(
		new Set(selectedAccounts.map((account) => getPlatformKey(account.platform)))
	);
	const sharedTextIsYouTubeDescription = $derived(
		sharedProviderKeys.size === 1 && sharedProviderKeys.has('youtube')
	);
	const sharedTextHasYouTubeDescription = $derived(
		sharedProviderKeys.size > 1 && sharedProviderKeys.has('youtube')
	);
	const canSubmitPublication = $derived(
		localBlockers.length === 0 && accountBlockingMessages.length === 0
	);
	const capabilityInputSnapshot = $derived(
		JSON.stringify({
			workspace: selectedWorkspaceId,
			accounts: selectedAccountIds,
			mode: textComposerMode,
			requestedOutputProfiles,
			linkUrl,
			posts: posts.map((post) => ({
				key: post.key,
				content: post.content,
				mediaIds: post.mediaIds
			})),
			settingsByAccount,
			segmentSettingsByPost,
			mediaSettingsByAccount
		})
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
	const editorTextHasMixedMeaning = $derived(
		!activeVariantAccount && sharedTextHasYouTubeDescription
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

	const editorMaxChars = $derived.by(() => {
		return minimumAccountCharacterLimit(editorLimitAccounts, resolvedCapabilities);
	});

	function editorCharacterUsage(value: string): { count: number; limit: number } {
		let usage = {
			count: platformTextLength('', value),
			limit: editorMaxChars
		};
		let highestRatio = usage.count / usage.limit;
		for (const platformLimit of editorPlatformLimits) {
			const count = platformTextLength(platformLimit.key, value);
			const ratio = count / platformLimit.limit;
			if (ratio > highestRatio || (ratio === highestRatio && platformLimit.limit < usage.limit)) {
				usage = { count, limit: platformLimit.limit };
				highestRatio = ratio;
			}
		}
		return usage;
	}
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

	const editorResizeSignature = $derived.by(() =>
		posts
			.map((post, index) => {
				const mediaIds = getEditorMediaIdsForPost(post);
				return `${post.key}:${index}:${getEditorContentForPost(post).length}:${mediaIds.join(',')}`;
			})
			.join('|')
	);

	// --------------------------------------------------------------------------
	// Helpers
	// --------------------------------------------------------------------------
	function getCharCounterColor(count: number, max: number): string {
		const pct = count / max;
		if (pct >= 1) return 'text-red-500';
		if (pct >= 0.8) return 'text-amber-500';
		return 'text-muted-foreground';
	}

	function normalizeRandomDelayValue(value: number | null | undefined): string {
		if (value === undefined || value === null || !Number.isFinite(value)) return 'default';
		return String(Math.max(0, Math.round(value)));
	}

	function parseScheduleDateParam(value: string | null): CalendarDate | undefined {
		const match = value?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
		if (!match) return undefined;
		const year = Number(match[1]);
		const month = Number(match[2]);
		const day = Number(match[3]);
		const parsed = new Date(year, month - 1, day);
		if (
			parsed.getFullYear() !== year ||
			parsed.getMonth() + 1 !== month ||
			parsed.getDate() !== day
		) {
			return undefined;
		}
		return new CalendarDate(year, month, day);
	}

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
		workspaceParam: string | null
	) {
		if (!dateParam && !timeParam && !workspaceParam) {
			appliedInitialContextKey = '';
			return;
		}

		const contextKey = `${dateParam ?? ''}|${timeParam ?? ''}|${workspaceParam ?? ''}`;
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
				selectedWorkspaceId = nextWorkspaceId;
				variants = new Map();
				activeVariantAccountId = null;
				await loadAccounts(nextWorkspaceId);
			} else if (accountsWorkspaceId !== nextWorkspaceId) {
				await loadAccounts(nextWorkspaceId);
			}
		}

		applyInitialScheduleDate(dateParam, timeParam);
	}

	function arraysEqual(left: string[], right: string[]): boolean {
		if (left.length !== right.length) return false;
		return left.every((value, index) => value === right[index]);
	}

	function sanitizeSelectedAccounts(validAccounts: SocialAccount[]) {
		const validIds = new Set(validAccounts.map((account) => account.id));
		const nextSelectedIds = selectedAccountIds.filter((id) => validIds.has(id));
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

		if (activeVariantAccountId && !validIds.has(activeVariantAccountId)) {
			activeVariantAccountId = null;
		}
	}

	function getCharCounterStrokeColor(count: number, max: number): string {
		const pct = count / max;
		if (pct >= 1) return '#ef4444';
		if (pct >= 0.8) return '#f59e0b';
		return 'currentColor';
	}

	function autoResize(el: HTMLTextAreaElement) {
		el.style.height = 'auto';
		el.style.height = el.scrollHeight + 'px';
	}

	function textareaAttachment(index: number) {
		return (el: HTMLTextAreaElement) => {
			textareaRefs.set(index, el);
			autoResize(el);
			return () => textareaRefs.delete(index);
		};
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
			linkUrl,
			settingsByAccount,
			segmentSettingsByPost,
			mediaSettingsByAccount,
			scheduledDate: selectedDate?.toString() ?? null,
			selectedTime,
			randomDelayOverride,
			repostOverride,
			selectedWorkspaceId
		});
	}

	function segmentID(publicationID: string, index: number): string {
		return `legacy-segment:${publicationID}:${index}`;
	}

	function settingsForAccount(account: SocialAccount): Record<string, unknown> {
		return normalizeSettings(account, settingsByAccount[account.id] ?? {}, 'destination');
	}

	function segmentSettingsForAccount(account: SocialAccount): Record<string, unknown> {
		const post = activePost;
		if (!post) return {};
		return normalizeSettings(
			account,
			segmentSettingsByPost[post.key]?.[account.id] ?? {},
			'segment'
		);
	}

	function normalizeSettings(
		account: SocialAccount,
		current: Record<string, unknown>,
		scope: 'destination' | 'segment'
	): Record<string, unknown> {
		const next = { ...current };
		for (const field of visibleSettings(account)) {
			if (field.scope !== scope || next[field.key] !== undefined) continue;
			if (field.default !== undefined) next[field.key] = field.default;
			else if (field.type === 'boolean') next[field.key] = false;
			else next[field.key] = '';
		}
		return next;
	}

	function dialogSettingsForAccount(account: SocialAccount): Record<string, unknown> {
		const values = {
			...settingsForAccount(account),
			...segmentSettingsForAccount(account)
		};
		if (
			getPlatformKey(account.platform) === 'youtube' &&
			(typeof values.description !== 'string' || !values.description.trim())
		) {
			values.description = posts[0]
				? (getVariantContent(account.id, posts[0].key) ?? posts[0].content)
				: '';
		}
		return values;
	}

	function visibleSettings(account: SocialAccount): SettingDefinition[] {
		return (resolvedCapabilities[account.id]?.settings ?? []).filter((field) => {
			if (
				['url', 'link_url', 'link_title', 'link_description'].includes(field.key) &&
				!linkUrl.trim() &&
				!field.required
			) {
				return false;
			}
			return true;
		});
	}

	function mediaForSettingsDialog(): Array<{ id: string; label: string; mimeType: string }> {
		const mediaIDs = activePost ? getEditorMediaIdsForPost(activePost) : [];
		return mediaIDs.map((id, index) => ({
			id,
			label: `${m.compose_uploaded_media()} ${index + 1}`,
			mimeType: mediaMimeTypes.get(id) ?? 'application/octet-stream'
		}));
	}

	function mediaSettingsForDialog(account: SocialAccount): Record<string, Record<string, unknown>> {
		return Object.fromEntries(
			settingsDialogMedia.map((item) => [
				item.id,
				{ ...(mediaSettingsByAccount[item.id]?.[account.id] ?? {}) }
			])
		);
	}

	function previewForAccount(account: SocialAccount) {
		return buildComposerPreview({
			account,
			mode: textComposerMode,
			outputProfile:
				requestedOutputProfiles[account.id] ?? resolvedCapabilities[account.id]?.output_profile,
			segments: posts.map((post) => {
				const mediaIds = getVariantMediaIds(account.id, post.key) ?? post.mediaIds;
				return {
					id: post.key,
					text: getVariantContent(account.id, post.key) ?? post.content,
					media: mediaIds.map((id) => ({
						id,
						mimeType: mediaMimeTypes.get(id),
						altText: mediaAltTexts.get(id)
					})),
					settings: segmentSettingsByPost[post.key]?.[account.id] ?? {}
				};
			}),
			destinationSettings: settingsForAccount(account),
			linkUrl
		});
	}

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

	function updateAccountSetting(account: SocialAccount, key: string, value: unknown) {
		const definition = visibleSettings(account).find((field) => field.key === key);
		if (definition?.scope === 'segment') {
			const post = activePost;
			if (!post) return;
			segmentSettingsByPost = {
				...segmentSettingsByPost,
				[post.key]: {
					...(segmentSettingsByPost[post.key] ?? {}),
					[account.id]: {
						...(segmentSettingsByPost[post.key]?.[account.id] ?? {}),
						[key]: value
					}
				}
			};
		} else {
			settingsByAccount = {
				...settingsByAccount,
				[account.id]: {
					...settingsForAccount(account),
					[key]: value
				}
			};
		}
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function updateMediaAccountSetting(
		account: SocialAccount,
		mediaID: string,
		key: string,
		value: unknown
	) {
		mediaSettingsByAccount = {
			...mediaSettingsByAccount,
			[mediaID]: {
				...(mediaSettingsByAccount[mediaID] ?? {}),
				[account.id]: {
					...(mediaSettingsByAccount[mediaID]?.[account.id] ?? {}),
					[key]: value
				}
			}
		};
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
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
			const definition = visibleSettings(account).find(
				(setting) => setting.key === 'poll_options' && setting.scope === 'segment'
			);
			if (!definition) continue;
			const raw = segmentSettingsByPost[post.key]?.[account.id]?.poll_options;
			if (typeof raw !== 'string' || raw === '') continue;
			const options = raw.split('\n');
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
			posts.filter((post) => post.content.trim() || post.mediaIds.length > 0).length < 2
		) {
			blockers.push(m.compose_thread_minimum());
		}
		if (capabilityResolveError) blockers.push(capabilityResolveError);
		return uniqueIssueMessages(blockers);
	}

	function accountBlockers(account: SocialAccount, includeShared = true): string[] {
		const provider = getPlatformKey(account.platform);
		return uniqueIssueMessages([
			...(resolvedCapabilities[account.id]?.issues ?? [])
				.filter(
					(issue) => issue.severity === 'error' && (includeShared || isAccountSpecificIssue(issue))
				)
				.map((issue) => issue.message),
			...validationIssues
				.filter(
					(issue) =>
						issue.severity === 'error' &&
						(includeShared || isAccountSpecificIssue(issue)) &&
						issueMatchesProvider(issue, provider)
				)
				.map((issue) => issue.message),
			configuredPollErrorForAccount(account)
		]);
	}

	function accountIssueMessages(account: SocialAccount): string[] {
		const provider = getPlatformKey(account.platform);
		const sourcePosts = isThread ? posts : activePost ? [activePost] : [];
		const mediaWarnings = sourcePosts.flatMap((post) => {
			const mediaIds = getVariantMediaIds(account.id, post.key) ?? post.mediaIds;
			return providerMediaWarningMessages(
				provider,
				mediaCapabilityItemsFromIds(mediaIds, mediaMimeTypes, mediaSizes)
			);
		});
		return uniqueIssueMessages([
			...accountBlockers(account, false),
			...(resolvedCapabilities[account.id]?.issues ?? [])
				.filter((issue) => isAccountSpecificIssue(issue) && isActionableAccountIssue(issue))
				.map((issue) => issue.message),
			...validationIssues
				.filter((issue) => isAccountSpecificIssue(issue) && issueMatchesProvider(issue, provider))
				.map((issue) => issue.message),
			...mediaWarnings
		]);
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
				id: segmentID(targetPublicationID, index),
				content: post.content,
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
					rendition.segments.length === 1 &&
					posts.length > 1 &&
					resolvedCapabilities[rendition.social_account_id]?.segment_strategy === 'join';
				const sourcePosts = joinsSegments ? posts : posts[index] ? [posts[index]] : [];
				if (sourcePosts.length === 0) return segment;
				const sourceVariants = sourcePosts.map((post) => source[post.key]).filter(Boolean);
				if (sourceVariants.length === 0) return segment;
				const contentInherited = sourceVariants.every((variant) => variant.contentInherited);
				const mediaInherited = sourceVariants.every((variant) => variant.mediaInherited);
				const body = sourcePosts
					.map((post) => getVariantContent(rendition.social_account_id, post.key) ?? post.content)
					.map((value) => value.trim())
					.filter(Boolean)
					.join(joinsSegments ? '\n\n' : '');
				const mediaIds = sourcePosts.flatMap(
					(post) => getVariantMediaIds(rendition.social_account_id, post.key) ?? post.mediaIds
				);
				const media = publicationMedia(mediaIds).map((item) => {
					const accountSettings = item.settingsByAccount?.[rendition.social_account_id] ?? {};
					const altText =
						typeof accountSettings.alt_text === 'string'
							? accountSettings.alt_text.trim()
							: item.altText;
					const settings = { ...accountSettings };
					delete settings.alt_text;
					return {
						media_id: item.id,
						role: item.role || 'attachment',
						...(altText ? { alt_text: altText } : {}),
						...(Object.keys(settings).length > 0 ? { settings } : {})
					};
				});
				return {
					...segment,
					body,
					...(contentInherited ? {} : { body_override: body }),
					media_inherited: mediaInherited,
					media: mediaInherited ? segment.media : media
				};
			});
			const first = rendition.segments[0];
			if (first) {
				rendition.body = first.body;
				rendition.media = first.media.map(({ media_id, role }) => ({ media_id, role }));
			}
		}
		return payload;
	}

	async function loadCanonicalPublication(targetPublicationID: string) {
		if (!targetPublicationID) return;
		const { data, error: publicationError } = await client.GET('/publications/{id}', {
			params: { path: { id: targetPublicationID } }
		});
		if (publicationError || !data) return;
		hydrateCanonicalSettings(data);
	}

	function hydrateCanonicalSettings(publication: Publication) {
		publicationId = publication.id;
		revision = publication.revision;
		repostOverride = publication.repost_override ?? { mode: 'inherit' };
		selectedSocialSetId = publication.social_set_id ?? '';
		requestedOutputProfiles = Object.fromEntries(
			(publication.renditions ?? [])
				.filter(
					(rendition) =>
						rendition.format_locked ||
						(publicationOnlyEdit &&
							['instagram', 'facebook', 'tiktok'].includes(getPlatformKey(rendition.platform)))
				)
				.map((rendition) => [rendition.social_account_id, rendition.output_profile])
		);
		formatLockedByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => [
				rendition.social_account_id,
				Boolean(
					rendition.format_locked ||
					(publicationOnlyEdit &&
						['instagram', 'facebook', 'tiktok'].includes(getPlatformKey(rendition.platform)))
				)
			])
		);
		scheduleOverridesByAccount = Object.fromEntries(
			(publication.renditions ?? [])
				.filter((rendition) => Boolean(rendition.schedule_override))
				.map((rendition) => [rendition.social_account_id, rendition.schedule_override!])
		);
		linkUrl = publication.source_url ?? '';
		showLinkInput = Boolean(linkUrl);
		settingsByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => [
				rendition.social_account_id,
				{ ...(rendition.settings ?? {}) }
			])
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
				const contentInherited = renditionSegment?.body_override === undefined;
				const mediaInherited = renditionSegment?.media_inherited ?? true;
				if (!contentInherited || !mediaInherited) hasOverride = true;
				record[post.key] = {
					content: contentInherited
						? post.content
						: (renditionSegment?.body_override ?? renditionSegment?.body ?? ''),
					mediaIds: mediaInherited
						? [...post.mediaIds]
						: (renditionSegment?.media ?? []).map((item) => item.id),
					contentInherited,
					mediaInherited
				};
			}
			if (hasOverride) hydratedVariants.set(rendition.social_account_id, record);
			else hydratedVariants.delete(rendition.social_account_id);
		}
		variants = normalizeVariantsMap(hydratedVariants, posts);
		const nextSegmentSettings: Record<string, Record<string, Record<string, unknown>>> = {};
		const nextMediaSettings: Record<string, Record<string, Record<string, unknown>>> = {};
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
					[rendition.social_account_id]: { ...(segment.settings ?? {}) }
				};
				for (const media of segment.media ?? []) {
					nextMediaSettings[media.id] = {
						...(nextMediaSettings[media.id] ?? {}),
						[rendition.social_account_id]: {
							...(media.settings ?? {}),
							...(media.alt_text ? { alt_text: media.alt_text } : {}),
							...(media.thumbnail_timestamp_ms
								? { thumbnail_timestamp_ms: media.thumbnail_timestamp_ms }
								: {})
						}
					};
				}
			}
		}
		segmentSettingsByPost = nextSegmentSettings;
		mediaSettingsByAccount = nextMediaSettings;
	}

	function scheduleCapabilityResolve() {
		if (capabilityResolveTimer) clearTimeout(capabilityResolveTimer);
		capabilityResolveTimer = setTimeout(() => {
			capabilityResolveTimer = null;
			void resolveCapabilities();
		}, 300);
	}

	async function resolveCapabilities() {
		if (!selectedWorkspaceId || selectedAccountIds.length === 0) {
			resolvedCapabilities = {};
			capabilityResolveError = '';
			return;
		}
		const requestSequence = ++capabilityResolveRequestSequence;
		capabilityResolveLoading = true;
		capabilityResolveError = '';
		const [, region = 'US'] = getLocaleTag().split('-');
		try {
			const { data, error: resolveError } = await client.POST('/capabilities/resolve', {
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
						selectedAccounts.map((account) => [account.id, settingsForAccount(account)])
					),
					segments: posts.map((post) => ({
						id: post.key,
						content: post.content,
						url: post === posts[0] ? linkUrl : '',
						media: post.mediaIds.map((mediaID) => ({ media_id: mediaID }))
					}))
				}
			});
			if (resolveError) {
				throw new Error(resolveError.detail || m.compose_load_capabilities_failed());
			}
			if (requestSequence !== capabilityResolveRequestSequence) return;
			resolvedCapabilities = Object.fromEntries(
				(data?.accounts ?? []).map((capability) => [capability.account_id, capability])
			);
			for (const capability of data?.accounts ?? []) {
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
			validationIssues = (data?.accounts ?? []).flatMap((capability) => capability.issues ?? []);
			void loadRequiredDestinationOptions();
		} catch (resolveError) {
			if (requestSequence !== capabilityResolveRequestSequence) return;
			capabilityResolveError =
				resolveError instanceof Error ? resolveError.message : m.compose_load_capabilities_failed();
		} finally {
			if (requestSequence === capabilityResolveRequestSequence) {
				capabilityResolveLoading = false;
			}
		}
	}

	async function loadRequiredDestinationOptions() {
		for (const account of selectedAccounts) {
			const requiredSources = visibleSettings(account)
				.filter((setting) => setting.required && Boolean(setting.options_source))
				.map((setting) => setting.options_source!)
				.filter((source) => destinationOptionsByAccount[account.id]?.[source] === undefined);
			for (const source of new Set(requiredSources)) {
				await loadDestinationOptions(account, false, source);
			}
		}
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
		search = ''
	) {
		let sources = loadableDestinationOptionSources(visibleSettings(account), onlySource);
		if (!force && !search) {
			sources = sources.filter(
				(source) => destinationOptionsByAccount[account.id]?.[source] === undefined
			);
		}
		if (sources.length === 0) return;
		const requestSequence = ++destinationOptionsRequestSequence;
		destinationOptionsLoadingAccountId = account.id;
		destinationOptionsErrors = { ...destinationOptionsErrors, [account.id]: '' };
		const [, region = 'US'] = getLocaleTag().split('-');
		try {
			const results = await Promise.all(
				sources.map(async (source) => {
					const { data, error: optionsError } = await client.GET(
						'/accounts/{account_id}/publishing-options/{source}',
						{
							params: {
								path: { account_id: account.id, source },
								query: {
									region,
									locale: getLocaleTag(),
									limit: 100,
									search
								}
							}
						}
					);
					if (optionsError) {
						throw new Error(optionsError.detail || m.compose_load_provider_options_failed());
					}
					return [source, data?.options ?? []] as const;
				})
			);
			if (requestSequence !== destinationOptionsRequestSequence) return;
			destinationOptionsByAccount = {
				...destinationOptionsByAccount,
				[account.id]: {
					...(destinationOptionsByAccount[account.id] ?? {}),
					...Object.fromEntries(results)
				}
			};
		} catch (optionsError) {
			if (requestSequence !== destinationOptionsRequestSequence) return;
			destinationOptionsErrors = {
				...destinationOptionsErrors,
				[account.id]:
					optionsError instanceof Error
						? optionsError.message
						: m.compose_load_provider_options_failed()
			};
		} finally {
			if (requestSequence === destinationOptionsRequestSequence) {
				destinationOptionsLoadingAccountId = '';
			}
		}
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

	function getPersistedVariantPayload(
		sourceVariants: Map<string, Record<string, VariantPost>>,
		sourcePosts: PostItem[]
	): PersistedVariant[] {
		const firstPost = sourcePosts[0];
		if (!firstPost) return [];
		return Array.from(sourceVariants.entries()).map(([accountId, values]) => ({
			social_account_id: accountId,
			content: values[firstPost.key]?.contentInherited
				? firstPost.content
				: (values[firstPost.key]?.content ?? firstPost.content),
			media_ids: JSON.stringify(
				values[firstPost.key]?.mediaInherited
					? firstPost.mediaIds
					: (values[firstPost.key]?.mediaIds ?? firstPost.mediaIds)
			),
			is_unsynced: true
		}));
	}

	function makeVariantRecord(sourcePosts: PostItem[]): Record<string, VariantPost> {
		return Object.fromEntries(
			sourcePosts.map((post) => [
				post.key,
				{
					content: post.content,
					mediaIds: [...post.mediaIds],
					contentInherited: true,
					mediaInherited: true
				}
			])
		);
	}

	function normalizeVariantRecord(
		record: Record<string, VariantPost> | undefined,
		sourcePosts: PostItem[]
	): Record<string, VariantPost> {
		return Object.fromEntries(
			sourcePosts.map((post) => {
				const value = record?.[post.key];
				return [
					post.key,
					{
						content: value?.content ?? post.content,
						mediaIds: value?.mediaIds ? [...value.mediaIds] : [...post.mediaIds],
						contentInherited: value?.contentInherited ?? false,
						mediaInherited: value?.mediaInherited ?? false
					}
				];
			})
		);
	}

	function variantRecordEquals(
		left: Record<string, VariantPost> | undefined,
		right: Record<string, VariantPost>,
		sourcePosts: PostItem[]
	): boolean {
		if (Object.keys(left ?? {}).length !== Object.keys(right).length) return false;
		return sourcePosts.every((post) => {
			const leftValue = left?.[post.key];
			const rightValue = right[post.key];
			return (
				(leftValue?.content ?? post.content) === rightValue.content &&
				arraysEqual(leftValue?.mediaIds ?? post.mediaIds, rightValue.mediaIds) &&
				(leftValue?.contentInherited ?? false) === (rightValue.contentInherited ?? false) &&
				(leftValue?.mediaInherited ?? false) === (rightValue.mediaInherited ?? false)
			);
		});
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
		if (activeVariantAccountId && activeVariantIsUnsynced) {
			setVariantMediaIds(activeVariantAccountId, postIndex, next);
		} else {
			posts = posts.map((item, index) =>
				index === postIndex ? { ...item, mediaIds: next } : item
			);
		}
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function openMediaPicker(postIndex: number) {
		mediaPickerPostIndex = postIndex;
		mediaPickerOpen = true;
	}

	async function openImageEditorFromComposer() {
		if (!selectedWorkspaceId) return;
		mediaPickerOpen = false;
		if (hasContent) await saveDraft();
		const returnURL = new URL(
			publicationId
				? resolve(`/publications/${encodeURIComponent(publicationId)}` as '/')
				: draftId
					? resolve(`/posts/${encodeURIComponent(draftId)}` as '/')
					: $page.url,
			$page.url
		);
		returnURL.searchParams.delete('image_editor_return');
		const token = await createImageEditorReturnToken({
			workspace_id: selectedWorkspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose: isThread ? 'thread_segment' : 'post_media',
			max_selection: composerMediaLimit,
			constraints: {
				max_count: composerMediaLimit,
				allowed_mimes: ['image/png', 'image/jpeg', 'image/webp'],
				thread_segment: mediaPickerPostIndex
			}
		});
		const snapshot: ComposerRecoverySnapshot = {
			version: 1,
			workspace_id: selectedWorkspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose: isThread ? 'thread_segment' : 'post_media',
			created_at: new Date().toISOString(),
			expires_at: token.expires_at,
			payload: {
				posts: $state.snapshot(posts),
				variants: Array.from(variants.entries()),
				active_post_index: mediaPickerPostIndex,
				selected_account_ids: [...selectedAccountIds],
				selected_social_set_id: selectedSocialSetId,
				requested_output_profiles: $state.snapshot(requestedOutputProfiles),
				format_locked_by_account: $state.snapshot(formatLockedByAccount),
				schedule_overrides_by_account: $state.snapshot(scheduleOverridesByAccount),
				active_variant_account_id: activeVariantAccountId,
				draft_id: draftId,
				publication_id: publicationId,
				link_url: linkUrl,
				show_link_input: showLinkInput,
				settings_by_account: $state.snapshot(settingsByAccount),
				segment_settings_by_post: $state.snapshot(segmentSettingsByPost),
				media_settings_by_account: $state.snapshot(mediaSettingsByAccount),
				media_alt_texts: Array.from(mediaAltTexts.entries()),
				media_mime_types: Array.from(mediaMimeTypes.entries()),
				media_sizes: Array.from(mediaSizes.entries()),
				selected_date: selectedDate?.toString(),
				selected_time: selectedTime,
				random_delay_override: randomDelayOverride,
				repost_override: $state.snapshot(repostOverride)
			} satisfies ImageEditorComposerSnapshotPayload
		};
		storeComposerRecovery(token.token, snapshot);
		await goto(
			resolve(
				`/image-editor/new?workspace=${encodeURIComponent(selectedWorkspaceId)}&return_token=${encodeURIComponent(token.token)}` as '/'
			)
		);
	}

	async function restoreImageEditorReturn() {
		if (!$page?.url) return;
		const token = $page.url.searchParams.get('image_editor_return');
		if (!token) return;
		const clean = new URL($page.url);
		clean.searchParams.delete('image_editor_return');
		replaceState(resolve(`${clean.pathname}${clean.search}` as '/'), {});
		try {
			const snapshot = loadComposerRecovery(token);
			const result = await consumeImageEditorReturnToken(token);
			if (snapshot?.workspace_id === result.workspace_id) {
				const payload = snapshot.payload as ImageEditorComposerSnapshotPayload;
				posts = structuredClone(payload.posts);
				variants = new SvelteMap(payload.variants);
				activePostIndex = Math.max(
					0,
					Math.min(payload.active_post_index, Math.max(0, posts.length - 1))
				);
				mediaPickerPostIndex = activePostIndex;
				selectedAccountIds = [...payload.selected_account_ids];
				selectedSocialSetId = payload.selected_social_set_id ?? '';
				requestedOutputProfiles = structuredClone(payload.requested_output_profiles ?? {});
				formatLockedByAccount = structuredClone(payload.format_locked_by_account ?? {});
				scheduleOverridesByAccount = structuredClone(payload.schedule_overrides_by_account ?? {});
				activeVariantAccountId = payload.active_variant_account_id;
				draftId = payload.draft_id;
				publicationId = payload.publication_id;
				linkUrl = payload.link_url;
				showLinkInput = payload.show_link_input;
				settingsByAccount = structuredClone(payload.settings_by_account);
				segmentSettingsByPost = structuredClone(payload.segment_settings_by_post);
				mediaSettingsByAccount = structuredClone(payload.media_settings_by_account);
				mediaAltTexts = new SvelteMap(payload.media_alt_texts);
				mediaMimeTypes = new SvelteMap(payload.media_mime_types);
				mediaSizes = new SvelteMap(payload.media_sizes);
				if (payload.selected_date) {
					const [year, month, day] = payload.selected_date.split('-').map(Number);
					selectedDate = new CalendarDate(year, month, day);
				}
				selectedTime = payload.selected_time;
				randomDelayOverride = payload.random_delay_override;
				repostOverride = structuredClone(payload.repost_override ?? { mode: 'inherit' });
				await loadAccounts(selectedWorkspaceId, selectedAccountIds);
				await resolveCapabilities();
			}
			const targetIndex = Math.max(
				0,
				Math.min(
					Number(result.constraints.thread_segment ?? activePostIndex),
					Math.max(0, posts.length - 1)
				)
			);
			setEditorMediaIds(targetIndex, [
				...getEditorMediaIdsForPost(posts[targetIndex]),
				...result.media_ids
			]);
			await hydrateMediaMetadata(result.workspace_id, result.media_ids);
			scheduleAutoSave();
			clearComposerRecovery(token);
			notifyImageEditorReturn(result.media_ids.length);
		} catch (cause) {
			error =
				cause instanceof Error
					? `${cause.message} Your OpenPost Image Editor exports are still available in Media.`
					: 'OpenPost Image Editor exports are still available in Media.';
		}
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
	async function initializeFromPost(post: InitialPost | undefined) {
		clearAutoSaveTimer();
		if (!post) {
			draftId = null;
			publicationId = '';
			selectedSocialSetId = '';
			requestedOutputProfiles = {};
			formatLockedByAccount = {};
			scheduleOverridesByAccount = {};
			lastInitializedPostId = null;
			posts = [makeEmptyPost()];
			activePostIndex = 0;
			lastSavedSnapshot = '';
			variants = new Map();
			activeVariantAccountId = null;
			selectedAccountIds = [];
			mediaAltTexts = new Map();
			mediaMimeTypes = new Map();
			mediaSizes = new Map();
			linkUrl = '';
			showLinkInput = false;
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
				await loadAccounts(selectedWorkspaceId);
				await resolveCapabilities();
			}
			return;
		}

		await ensureComposerWorkspace(post.workspace_id);
		draftId = post.id;
		publicationId = post.publication_id ?? '';
		revision = post.revision;
		lastInitializedPostId = post.id;
		selectedWorkspaceId = post.workspace_id;
		selectedAccountIds = post.destinations?.map((d) => d.social_account_id) ?? [];
		randomDelayOverride = normalizeRandomDelayValue(post.random_delay_minutes);
		repostOverride = post.repost_override ?? { mode: 'inherit' };

		// Load alt texts from media
		const newAlts = new SvelteMap<string, string>();
		const newMimeTypes = new SvelteMap<string, string>();
		post.media?.forEach((m) => {
			if (m.alt_text) newAlts.set(m.media_id, m.alt_text);
			if (m.mime_type) newMimeTypes.set(m.media_id, m.mime_type);
		});
		mediaAltTexts = newAlts;
		mediaMimeTypes = newMimeTypes;
		mediaSizes = new Map();
		if (post.media?.length) {
			await hydrateMediaMetadata(
				post.workspace_id,
				post.media.map((m) => m.media_id).filter(Boolean)
			);
		}

		// Read the thread state. Prefer the explicit `thread_draft`
		// field. Fall back to the pre-migration encoded value inside
		// `content` so older saved drafts still open safely.
		const threadSource: string | null = post.thread_draft ?? null;
		const migratedSource: string | null = isThreadDraft(post.content) ? post.content : null;
		const source = threadSource ?? migratedSource;
		if (source) {
			const threadData = decodeThreadDraft(source);
			if (threadData && threadData.posts.length > 0) {
				posts = threadData.posts.map((item) => ({
					key: item.key,
					content: item.content,
					mediaIds: item.mediaIds
				}));
				variants = normalizeVariantsMap(new Map(Object.entries(threadData.variants)), posts);
			} else {
				posts = [makeEmptyPost()];
				variants = new Map();
			}
		} else {
			posts = [
				{
					key: makeEmptyPost().key,
					content: post.content,
					mediaIds: post.media?.map((m) => m.media_id) ?? []
				}
			];
			variants = new Map();
		}
		activePostIndex = 0;
		activeVariantAccountId = null;

		if (post.scheduled_at && post.scheduled_at !== '0001-01-01T00:00:00Z') {
			const schedule = workspaceScheduleFromISO(post.scheduled_at, scheduleTimezoneLabel);
			selectedDate = schedule?.date;
			selectedTime = schedule?.time ?? null;
		} else {
			selectedDate = undefined;
			selectedTime = null;
		}

		await loadAccounts(selectedWorkspaceId, selectedAccountIds);
		if (!source) {
			await loadVariants(post.id);
		}
		if (publicationId) {
			await loadCanonicalPublication(publicationId);
		}
		await resolveCapabilities();
		lastSavedSnapshot = getSaveSnapshot();
	}

	async function initializeFromPublication(publication: Publication) {
		clearAutoSaveTimer();
		await ensureComposerWorkspace(publication.workspace_id);
		draftId = null;
		publicationId = publication.id;
		revision = publication.revision;
		lastInitializedPostId = null;
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
			...(publication.media ?? [])
		];
		mediaMimeTypes = new Map(publicationMedia.map((media) => [media.id, media.mime_type] as const));
		mediaSizes = new Map();
		const mediaIDs = publicationMedia.map((media) => media.id);
		if (mediaIDs.length > 0) await hydrateMediaMetadata(publication.workspace_id, mediaIDs);
		if (publication.scheduled_at && publication.scheduled_at !== '0001-01-01T00:00:00Z') {
			const schedule = workspaceScheduleFromISO(publication.scheduled_at, scheduleTimezoneLabel);
			selectedDate = schedule?.date;
			selectedTime = schedule?.time ?? null;
		} else {
			selectedDate = undefined;
			selectedTime = null;
		}
		await loadAccounts(selectedWorkspaceId, selectedAccountIds);
		hydrateCanonicalSettings(publication);
		await resolveCapabilities();
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
			const { data: capabilityData, error: capabilityError } = await client.GET(
				'/capabilities',
				{}
			);
			if (capabilityError) {
				throw new Error(capabilityError.detail || m.compose_load_capabilities_failed());
			}
			capabilities = capabilityData?.capabilities ?? [];
			if (initialPublication && !initialPost) await initializeFromPublication(initialPublication);
			else await initializeFromPost(initialPost);
		} catch (e) {
			console.error('Failed to load workspaces:', e);
			if (requestSequence === workspaceRequestSequence) {
				workspaceLoadError = m.compose_load_workspaces_failed();
			}
		} finally {
			if (requestSequence === workspaceRequestSequence) {
				loadingWorkspaces = false;
			}
		}
	}

	onMount(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') void flushPendingTextDraft();
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		void (async () => {
			await initializeComposer();
			await restoreImageEditorReturn();
		})();
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(() => {
		clearAutoSaveTimer();
		clearSavedIndicator();
		if (capabilityResolveTimer) clearTimeout(capabilityResolveTimer);
		for (const session of previewSessions.values()) session.close();
		previewSessions.clear();
	});

	beforeNavigate((navigation) => {
		if (allowNavigationOnce) {
			allowNavigationOnce = false;
			return;
		}
		if (
			!navigation.to?.url ||
			!autoSavesDraft ||
			!hasContent ||
			getSaveSnapshot() === lastSavedSnapshot ||
			draftConflict
		) {
			return;
		}
		const target = `${navigation.to.url.pathname}${navigation.to.url.search}${navigation.to.url.hash}`;
		navigation.cancel();
		void flushPendingTextDraft().then((saved) => {
			if (!saved) return;
			allowNavigationOnce = true;
			return goto(resolve(target as '/'));
		});
	});

	$effect(() => {
		const post = initialPost;
		if (!loadingWorkspaces && post && lastInitializedPostId !== post.id) {
			initializeFromPost(post);
		}
	});

	$effect(() => {
		const publication = initialPublication;
		if (
			!loadingWorkspaces &&
			!initialPost &&
			publication &&
			lastInitializedPublicationId !== publication.id
		) {
			void initializeFromPublication(publication);
		}
	});

	$effect(() => {
		const dateParam = initialScheduleDate;
		const timeParam = initialScheduleTime;
		const workspaceParam = initialWorkspaceId;
		if (!loadingWorkspaces && !isEditMode) {
			void applyInitialComposerContext(dateParam, timeParam, workspaceParam);
		}
	});

	$effect(() => {
		const workspaceId = workspaceCtx.currentWorkspace?.id ?? '';
		if (
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
		String(editorResizeSignature);
		tick().then(() => {
			textareaRefs.forEach((el) => {
				if (el) autoResize(el);
			});
		});
	});

	$effect(() => {
		const prompt = ui.pendingPrompt;
		if (prompt && !initialPost && !loadingWorkspaces) {
			ui.clearPrompt();
			requestApplyPrompt(prompt);
		}
	});

	$effect(() => {
		void capabilityInputSnapshot;
		if (!loadingWorkspaces && !loadingAccounts) {
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
	async function hydrateMediaMetadata(workspaceId: string, mediaIds: string[]) {
		const missingIds = Array.from(new Set(mediaIds.filter(Boolean))).filter(
			(id) => !mediaMimeTypes.has(id) || !mediaSizes.has(id)
		);
		if (!workspaceId || missingIds.length === 0) return;

		try {
			const token = getToken();
			const resp = await fetch(
				`${getApiBase()}/media/metadata?workspace_id=${encodeURIComponent(
					workspaceId
				)}&media_ids=${encodeURIComponent(missingIds.join(','))}`,
				{
					credentials: 'include',
					headers: token ? { Authorization: `Bearer ${token}` } : {}
				}
			);
			if (!resp.ok) return;

			const mediaData = await resp.json();
			const nextMimeTypes = new SvelteMap(mediaMimeTypes);
			const nextAltTexts = new SvelteMap(mediaAltTexts);
			const nextSizes = new SvelteMap(mediaSizes);
			for (const media of mediaData.media ?? []) {
				if (media.mime_type) {
					nextMimeTypes.set(media.id, media.mime_type);
				}
				if (typeof media.size === 'number') {
					nextSizes.set(media.id, media.size);
				}
				if (media.alt_text) {
					nextAltTexts.set(media.id, media.alt_text);
				}
			}
			mediaMimeTypes = nextMimeTypes;
			mediaAltTexts = nextAltTexts;
			mediaSizes = nextSizes;
		} catch (e) {
			console.error('Failed to load media metadata:', e);
		}
	}

	async function loadAccounts(
		workspaceId: string,
		preferredAccountIds: string[] | undefined = undefined
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
			const { data, error: err } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (err) throw new Error(err.detail || m.compose_load_accounts_failed());
			if (requestSequence !== accountRequestSequence || selectedWorkspaceId !== workspaceId) {
				return;
			}

			const nextAccounts = data ?? [];
			const nextCompatibleAccounts = nextAccounts;
			accounts = nextAccounts;
			if (selectionToPreserve && selectionToPreserve.length > 0) {
				const validIds = nextCompatibleAccounts.map((account) => account.id);
				selectedAccountIds = selectionToPreserve.filter((id) => validIds.includes(id));
			} else {
				selectedAccountIds = nextCompatibleAccounts.map((account) => account.id);
			}
			sanitizeSelectedAccounts(nextCompatibleAccounts);
		} catch (e) {
			console.error('Failed to load accounts:', e);
			if (requestSequence !== accountRequestSequence || selectedWorkspaceId !== workspaceId) {
				return;
			}
			accountLoadError = m.compose_load_accounts_failed();
		} finally {
			if (requestSequence === accountRequestSequence && selectedWorkspaceId === workspaceId) {
				loadingAccounts = false;
			}
		}
	}

	function handleWorkspaceChange(value: string) {
		if (!value || value === selectedWorkspaceId) return;
		const resetWorkspaceState = Boolean(
			draftId ||
			hasContent ||
			selectedDate ||
			selectedTime ||
			posts.some((post) => post.mediaIds.length > 0)
		);
		clearAutoSaveTimer();
		saveGeneration += 1;
		nextSlotRequestSequence += 1;
		suggestingSlot = false;
		draftId = null;
		publicationId = '';
		selectedSocialSetId = '';
		requestedOutputProfiles = {};
		formatLockedByAccount = {};
		scheduleOverridesByAccount = {};
		lastSavedSnapshot = '';
		isSaving = false;
		showDeleteConfirm = false;
		selectedDate = undefined;
		selectedTime = null;
		showScheduleDialog = false;
		scheduleInputError = '';
		randomDelayOverride = 'default';
		posts = posts.map((post) => ({ ...post, mediaIds: [] }));
		mediaAltTexts = new Map();
		mediaMimeTypes = new Map();
		mediaSizes = new Map();
		linkUrl = '';
		showLinkInput = false;
		settingsByAccount = {};
		segmentSettingsByPost = {};
		mediaSettingsByAccount = {};
		resolvedCapabilities = {};
		validationIssues = [];
		settingsDialogOpen = false;
		settingsAccountId = '';
		destinationOptionsByAccount = {};
		destinationOptionsErrors = {};
		selectedWorkspaceId = value;
		accounts = [];
		selectedAccountIds = [];
		variants = new Map();
		activeVariantAccountId = null;
		accountLoadError = '';
		workspaceChangeNotice = resetWorkspaceState ? m.compose_workspace_context_reset() : '';
		void loadAccounts(value);
	}

	function toggleAccount(id: string) {
		const account = accounts.find((candidate) => candidate.id === id);
		if (!account) return;
		selectedSocialSetId = '';
		if (selectedAccountIds.includes(id)) {
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
		selectedAccountIds = (set.accounts ?? [])
			.map((membership) => membership.social_account_id)
			.filter((id) => accounts.some((account) => account.id === id));
		requestedOutputProfiles = {};
		formatLockedByAccount = {};
		activeVariantAccountId = null;
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function accountLabel(account: SocialAccount): string {
		return account.account_username || account.slug || getPlatformName(account.platform);
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

	function destinationFormatLabel(account: SocialAccount): string {
		if (
			resolvedCapabilities[account.id]?.format_selection_required &&
			!requestedOutputProfiles[account.id]
		) {
			return m.compose_choose_format();
		}
		const current =
			requestedOutputProfiles[account.id] || resolvedCapabilities[account.id]?.output_profile || '';
		return (
			destinationFormatOptions(account).find((option) => option.value === current)?.label || current
		);
	}

	function selectDestinationFormat(account: SocialAccount, outputProfile: string) {
		requestedOutputProfiles = { ...requestedOutputProfiles, [account.id]: outputProfile };
		formatLockedByAccount = { ...formatLockedByAccount, [account.id]: true };
		validationIssues = [];
		scheduleAutoSave();
		scheduleCapabilityResolve();
	}

	function destinationScheduleValue(accountId: string): string {
		const value = scheduleOverridesByAccount[accountId];
		if (!value) return '';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '';
		const offset = date.getTimezoneOffset() * 60_000;
		return new Date(date.getTime() - offset).toISOString().slice(0, 16);
	}

	function updateDestinationSchedule(accountId: string, value: string) {
		const next = { ...scheduleOverridesByAccount };
		if (value) next[accountId] = new Date(value).toISOString();
		else delete next[accountId];
		scheduleOverridesByAccount = next;
		validationIssues = [];
		scheduleAutoSave();
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
		} = {}
	): Promise<string | null> {
		return saveQueue.run(() => saveDraftNow(options));
	}

	async function saveDraftNow(options: {
		saveAsCopy?: boolean;
		scheduledAt?: string | null;
	}): Promise<string | null> {
		if (!selectedWorkspaceId || !hasContent) return null;
		const generation = saveGeneration;
		const workspaceId = selectedWorkspaceId;
		const startingDraftId = options.saveAsCopy ? null : draftId;
		const snapshot = getSaveSnapshot();
		clearSavedIndicator();
		isSaving = true;
		error = '';

		try {
			const sourcePosts = posts.map((post) => ({ ...post, mediaIds: [...post.mediaIds] }));
			const threadDraft = isThread
				? encodeThreadDraft(sourcePosts, getVariantPayloadForSave())
				: '';
			const draftContent = sourcePosts[0].content;
			const draftMediaIds = isThread
				? sourcePosts.flatMap((post) => post.mediaIds)
				: sourcePosts[0].mediaIds;
			const variantPayload = getPersistedVariantPayload(new Map(variants), sourcePosts);
			const proposedSchedule =
				options.scheduledAt === undefined ? (getScheduledAt() ?? null) : options.scheduledAt;
			const canonicalID = publicationId || `text-draft:${sourcePosts[0].key}`;
			const canonical = publicationPayload(canonicalID);
			const publication = {
				title: canonical.title,
				intent: canonical.intent,
				creation_preset: canonical.creation_preset,
				social_set_id: canonical.social_set_id,
				content_profile: canonical.content_profile,
				source_text: canonical.source_text,
				source_url: canonical.source_url ?? '',
				...(proposedSchedule
					? { scheduled_at: proposedSchedule, clear_schedule: false }
					: { clear_schedule: true }),
				metadata: canonical.metadata,
				segments: canonical.segments,
				renditions: canonical.renditions,
				repost_override: $state.snapshot(repostOverride)
			};
			const body = {
				content: draftContent,
				scheduled_at: proposedSchedule ?? '',
				social_account_ids: [...selectedAccountIds],
				media_ids: draftMediaIds,
				random_delay_minutes: proposedSchedule ? effectiveRandomDelayMinutes : 0,
				thread_draft: threadDraft,
				variants: variantPayload,
				publication
			};

			let savedDraftId = startingDraftId;
			let savedPublicationId = options.saveAsCopy ? '' : publicationId;
			let savedRevision = revision;
			if (publicationOnlyEdit) {
				if (savedPublicationId) {
					const { data, error: saveError } = await client.PUT('/publications/{id}', {
						params: { path: { id: savedPublicationId } },
						body: {
							expected_revision: revision,
							title: canonical.title,
							creation_preset: canonical.creation_preset,
							social_set_id: canonical.social_set_id ?? '',
							content_profile: canonical.content_profile,
							source_text: canonical.source_text,
							source_url: canonical.source_url ?? '',
							...(proposedSchedule ? { scheduled_at: proposedSchedule } : { clear_schedule: true }),
							metadata: canonical.metadata,
							segments: canonical.segments,
							renditions: canonical.renditions,
							repost_override: $state.snapshot(repostOverride)
						}
					});
					if (saveError) {
						const conflict = parseDraftConflict(saveError);
						if (conflict) {
							draftConflict = conflict;
							conflictDialogOpen = true;
						}
						throw new Error(saveError.detail || m.compose_save_publication_failed());
					}
					savedRevision = data.revision;
				} else {
					const { data, error: createError } = await client.POST('/publications', {
						body: {
							...canonical,
							...(proposedSchedule ? { scheduled_at: proposedSchedule } : {}),
							repost_override: $state.snapshot(repostOverride)
						}
					});
					if (createError) {
						throw new Error(createError.detail || m.compose_create_publication_failed());
					}
					savedPublicationId = data.id;
					savedRevision = data.revision;
				}
			} else if (startingDraftId) {
				const { data, error: saveError } = await client.PUT('/posts/{id}/draft', {
					params: { path: { id: startingDraftId } },
					body: {
						...body,
						expected_revision: revision
					}
				});
				if (saveError) {
					const conflict = parseDraftConflict(saveError);
					if (conflict) {
						draftConflict = conflict;
						conflictDialogOpen = true;
					}
					throw new Error(saveError.detail || m.compose_update_draft_failed());
				}
				savedDraftId = data.post_id;
				savedPublicationId = data.publication_id;
				savedRevision = data.revision;
			} else {
				const { data, error: createError } = await client.POST('/posts/draft', {
					body: { ...body, workspace_id: workspaceId }
				});
				if (createError) {
					throw new Error(createError.detail || m.compose_save_draft_failed());
				}
				savedDraftId = data.post_id;
				savedPublicationId = data.publication_id;
				savedRevision = data.revision;
			}

			if (
				generation !== saveGeneration ||
				selectedWorkspaceId !== workspaceId ||
				(startingDraftId && draftId !== startingDraftId)
			) {
				return null;
			}
			const createdDraftId = startingDraftId || publicationOnlyEdit ? null : savedDraftId;
			draftId = savedDraftId;
			publicationId = savedPublicationId;
			revision = savedRevision;
			draftConflict = null;
			lastSavedSnapshot = snapshot;
			showSavedIndicator();
			const activeDraftID = savedPublicationId || savedDraftId;
			if (activeDraftID) ui.setActiveComposerDraft(activeDraftID);
			ui.triggerRefresh();
			if (createdDraftId && savedPublicationId) onDraftCreated?.(savedPublicationId);
			return savedPublicationId || null;
		} catch (cause) {
			console.error('Failed to save text post draft:', cause);
			if (generation === saveGeneration && selectedWorkspaceId === workspaceId) {
				error = cause instanceof Error ? cause.message : m.compose_save_draft_failed();
			}
			return null;
		} finally {
			if (generation === saveGeneration && selectedWorkspaceId === workspaceId) {
				isSaving = false;
			}
		}
	}

	async function reloadSavedTextDraft() {
		if (!draftConflict) return;
		const { data, error: loadError } = await client.GET('/posts/{id}', {
			params: { path: { id: draftConflict.conflict.aggregate_id } }
		});
		if (loadError || !data) {
			throw new Error(loadError?.detail || m.compose_update_draft_failed());
		}
		await initializeFromPost(data);
		error = '';
		draftConflict = null;
	}

	async function saveConflictedTextDraftAsCopy() {
		const saved = await saveDraft({ saveAsCopy: true });
		if (!saved) throw new Error(error || m.compose_save_draft_failed());
		lastSavedSnapshot = getSaveSnapshot();
		success = m.compose_draft_saved();
		error = '';
	}

	async function overwriteSavedTextDraft() {
		if (!draftConflict) return;
		revision = draftConflict.conflict.current_revision;
		const saved = await saveDraft();
		if (!saved) throw new Error(error || m.compose_update_draft_failed());
		lastSavedSnapshot = getSaveSnapshot();
		success = m.compose_changes_saved();
		error = '';
	}

	async function flushPendingTextDraft(): Promise<boolean> {
		clearAutoSaveTimer();
		await saveQueue.flush().catch(() => publicationId || null);
		if (autoSavesDraft && hasContent && getSaveSnapshot() !== lastSavedSnapshot && !draftConflict) {
			await saveDraft();
		}
		return !draftConflict && getSaveSnapshot() === lastSavedSnapshot;
	}

	async function deleteDraft() {
		if ((!draftId && !publicationOnlyEdit) || isDeleting) return;
		clearAutoSaveTimer();
		isDeleting = true;
		error = '';
		try {
			const deleteErr = draftId
				? (
						await client.DELETE('/posts/{id}', {
							params: { path: { id: draftId } }
						})
					).error
				: (
						await client.DELETE('/publications/{id}', {
							params: {
								path: { id: publicationId },
								query: { confirm: true, expected_revision: revision }
							}
						})
					).error;
			if (deleteErr) throw new Error((deleteErr as any).detail || m.compose_delete_post_failed());

			ui.triggerRefresh();
			posts = [makeEmptyPost()];
			activePostIndex = 0;
			draftId = null;
			lastSavedSnapshot = '';
			variants = new Map();
			activeVariantAccountId = null;
			selectedDate = undefined;
			selectedTime = null;
			randomDelayOverride = 'default';
			showDeleteConfirm = false;
			onDeleted?.();
		} catch (e) {
			error = (e as Error).message || m.compose_delete_post_failed();
			soundPreferences.play('error');
		} finally {
			isDeleting = false;
		}
	}

	async function saveEditedPost() {
		if ((!draftId || !initialPost) && !publicationOnlyEdit) return;
		error = '';
		success = '';

		if (!selectedWorkspaceId) {
			error = m.compose_please_select_workspace();
			return;
		}
		if (!hasContent) {
			error = m.compose_please_enter_content();
			return;
		}
		if (selectedAccountIds.length === 0) {
			error = m.compose_select_account();
			return;
		}
		if ((selectedDate && !selectedTime) || (!selectedDate && selectedTime)) {
			error = m.compose_select_date_time();
			return;
		}
		const pollError = configuredPollError();
		if (pollError) {
			error = pollError;
			return;
		}
		if (selectedDate && selectedTime && !selectedWorkspaceSettingsReady) {
			error = m.compose_load_workspace_settings_failed();
			workspaceSettingsError = error;
			return;
		}
		const scheduledAt = getScheduledAt();
		if (selectedDate && selectedTime && !scheduledAt) {
			error = m.compose_invalid_timezone_time();
			return;
		}
		isSaving = true;
		try {
			const targetPublicationID = await saveDraft({ scheduledAt: scheduledAt ?? null });
			if (!targetPublicationID) {
				throw new Error(error || m.compose_save_publication_failed());
			}
			if (scheduledAt) {
				const { error: scheduleError } = await client.POST('/publications/{id}/schedule', {
					params: { path: { id: targetPublicationID } },
					body: { expected_revision: revision }
				});
				if (scheduleError) {
					const conflict = parseDraftConflict(scheduleError);
					if (conflict) {
						draftConflict = conflict;
						conflictDialogOpen = true;
					}
					throw new Error(scheduleError.detail || m.compose_schedule_failed());
				}
			}

			lastSavedSnapshot = getSaveSnapshot();
			success = m.compose_changes_saved();
			soundPreferences.play('success');
			ui.triggerRefresh();

			if (onSuccess) {
				setTimeout(() => onSuccess(), 500);
			}
		} catch (e) {
			error = (e as Error).message || m.compose_save_changes_failed();
			soundPreferences.play('error');
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

		if (!selectedWorkspaceId) {
			error = m.compose_please_select_workspace();
			return;
		}
		if (!hasContent) {
			error = m.compose_please_enter_content();
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
			await resolveCapabilities();
			if (capabilityResolveError) throw new Error(capabilityResolveError);
			const targetPublicationID = await saveDraft({
				scheduledAt: publishNow ? null : (scheduledAt ?? null)
			});
			if (!targetPublicationID) {
				throw new Error(error || m.compose_save_publication_failed());
			}
			const { data: validation, error: validationError } = await client.POST(
				'/publications/{id}/validate',
				{ params: { path: { id: targetPublicationID } } }
			);
			if (validationError) {
				throw new Error(validationError.detail || m.compose_validation_failed());
			}
			validationIssues = validation?.issues ?? [];
			const blocker = validationIssues.find((issue) => issue.severity === 'error');
			if (blocker) throw new Error(blocker.message);

			const { error: actionError } = publishNow
				? await client.POST('/publications/{id}/publish-now', {
						params: { path: { id: targetPublicationID } },
						body: { expected_revision: revision }
					})
				: await client.POST('/publications/{id}/schedule', {
						params: { path: { id: targetPublicationID } },
						body: { expected_revision: revision }
					});
			if (actionError) {
				const conflict = parseDraftConflict(actionError);
				if (conflict) {
					draftConflict = conflict;
					conflictDialogOpen = true;
				}
				throw new Error(
					actionError.detail ||
						(publishNow ? m.compose_publish_failed() : m.compose_schedule_failed())
				);
			}

			success = publishNow ? m.compose_publishing_now() : m.compose_scheduled_success();
			soundPreferences.play('success');
			ui.triggerRefresh();

			if (isEditMode && onSuccess) {
				setTimeout(() => onSuccess(), 800);
			} else {
				posts = [makeEmptyPost()];
				activePostIndex = 0;
				draftId = null;
				publicationId = '';
				lastSavedSnapshot = '';
				variants = new Map();
				activeVariantAccountId = null;
				linkUrl = '';
				showLinkInput = false;
				settingsByAccount = {};
				segmentSettingsByPost = {};
				mediaSettingsByAccount = {};
				resolvedCapabilities = {};
				validationIssues = [];
				selectedDate = undefined;
				selectedTime = null;
				randomDelayOverride = 'default';
				onSuccess?.();
				setTimeout(() => (success = ''), 3000);
			}
		} catch (e) {
			error = (e as Error).message || m.compose_publish_failed();
			soundPreferences.play('error');
		} finally {
			isSubmitting = false;
		}
	}

	// --------------------------------------------------------------------------
	// Thread management
	// --------------------------------------------------------------------------
	function addPost() {
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
		posts = posts.filter((_, i) => i !== index);
		variants = normalizeVariantsMap(variants, posts);
		if (activePostIndex >= posts.length) {
			activePostIndex = posts.length - 1;
		}
		onThreadStateChange?.(posts.length > 1);
		scheduleAutoSave();
	}

	function handleReorder(newItems: PostItem[]) {
		posts = newItems;
		variants = normalizeVariantsMap(variants, newItems);
		activePostIndex = Math.min(activePostIndex, newItems.length - 1);
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// Media
	// --------------------------------------------------------------------------
	async function handleFileUpload(
		files: FileList | File[],
		targetPostIndex: number = activePostIndex
	) {
		if (!selectedWorkspaceId || isSubmitting) return;

		isUploading = true;
		let uploadedCount = 0;
		try {
			for (const file of Array.from(files)) {
				if (!isSupportedMediaFile(file)) continue;
				const targetPost = posts[targetPostIndex];
				if (!targetPost) break;
				if (getEditorMediaIdsForPost(targetPost).length >= composerMediaLimit) break;

				const data = await uploadMediaFile({
					workspaceId: selectedWorkspaceId,
					file,
					retentionClass: 'temporary'
				});
				if (data.mime_type) {
					const nextMimeTypes = new SvelteMap(mediaMimeTypes);
					nextMimeTypes.set(data.id, data.mime_type);
					mediaMimeTypes = nextMimeTypes;
				}
				if (typeof data.size === 'number') {
					const nextSizes = new SvelteMap(mediaSizes);
					nextSizes.set(data.id, data.size);
					mediaSizes = nextSizes;
				}
				addMediaToPost(targetPostIndex, data.id);
				uploadedCount++;
				scheduleAutoSave();
			}
			if (uploadedCount > 0) soundPreferences.play('success');
		} catch (e) {
			console.error('Failed to upload media:', e);
			error = (e as Error).message || m.compose_upload_failed();
			soundPreferences.play('error');
		} finally {
			isUploading = false;
		}
	}

	function handlePaste(e: ClipboardEvent, postIndex: number = activePostIndex) {
		const items = e.clipboardData?.items;
		if (!items) return;

		const files: File[] = [];
		for (const item of Array.from(items)) {
			if (item.kind === 'file') {
				const file = item.getAsFile();
				if (file) files.push(file);
			}
		}
		if (files.length > 0) {
			e.preventDefault();
			handleFileUpload(files, postIndex);
		}
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
			handleFileUpload(files, postIndex);
		}
	}

	function removeMedia(postIndex: number, mediaIndex: number) {
		const post = posts[postIndex];
		if (!post) return;
		const mediaIds = getEditorMediaIdsForPost(post);
		const mediaId = mediaIds[mediaIndex];
		if (activeVariantAccountId && activeVariantIsUnsynced) {
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
		if (mediaId) {
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
		scheduleAutoSave();
	}

	function addMediaToPost(postIndex: number, mediaId: string) {
		const post = posts[postIndex];
		if (!post) return;
		if (activeVariantAccountId && activeVariantIsUnsynced) {
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

	function setVariantMediaIds(accountId: string, index: number, mediaIds: string[]) {
		const postKey = posts[index]?.key;
		if (!postKey) return;
		const newVariants = new SvelteMap(variants);
		const current = {
			...normalizeVariantRecord(newVariants.get(accountId), posts),
			[postKey]: {
				...(normalizeVariantRecord(newVariants.get(accountId), posts)[postKey] ?? {
					content: posts[index].content,
					mediaIds: [...posts[index].mediaIds]
				}),
				mediaIds,
				mediaInherited: false
			}
		};
		newVariants.set(accountId, current);
		variants = newVariants;
	}

	function setMediaAltText(mediaId: string, alt: string) {
		const newAlts = new SvelteMap(mediaAltTexts);
		if (alt.trim()) {
			newAlts.set(mediaId, alt.trim());
		} else {
			newAlts.delete(mediaId);
		}
		mediaAltTexts = newAlts;

		// Persist to backend
		client
			.PATCH('/media/{id}', {
				params: { path: { id: mediaId } },
				body: { alt_text: alt.trim() }
			})
			.catch((e: any) => {
				console.error('Failed to save alt text:', e);
			});
	}

	// --------------------------------------------------------------------------
	// Prompts
	// --------------------------------------------------------------------------
	async function fetchRandomPrompt() {
		if (!selectedWorkspaceId) return;
		loadingPrompt = true;
		try {
			const { data, error: err } = await client.GET('/prompts/random', {
				params: { query: { workspace_id: selectedWorkspaceId } }
			});
			if (err) throw err;
			if (data) {
				currentPrompt = {
					text: data.text,
					example: data.example ?? '',
					category: data.category
				};
				showPromptCard = true;
			}
		} catch (e) {
			console.error('Failed to fetch prompt:', e);
		} finally {
			loadingPrompt = false;
		}
	}

	function dismissPrompt() {
		showPromptCard = false;
		currentPrompt = null;
	}

	function resolvePromptContent(prompt: { text: string; example?: string }): string {
		return prompt.example?.trim() ? prompt.example : prompt.text;
	}

	function applyPromptContent(prompt: { text: string; example?: string }) {
		posts = [{ ...makeEmptyPost(), content: resolvePromptContent(prompt) }];
		activePostIndex = 0;
		variants = new Map();
		activeVariantAccountId = null;
		scheduleAutoSave();
	}

	function requestApplyPrompt(prompt: { text: string; example?: string }) {
		if (hasContent) {
			pendingPromptToApply = { text: prompt.text, example: prompt.example ?? '' };
			promptApplyDialogOpen = true;
			return;
		}
		applyPromptContent(prompt);
	}

	function confirmApplyPrompt() {
		const prompt = pendingPromptToApply;
		if (!prompt) return;
		applyPromptContent(prompt);
		pendingPromptToApply = null;
		promptApplyDialogOpen = false;
	}

	function cancelApplyPrompt() {
		pendingPromptToApply = null;
		promptApplyDialogOpen = false;
	}

	// --------------------------------------------------------------------------
	// Variants
	// --------------------------------------------------------------------------
	function handleVariantChange(accountId: string, index: number, value: string) {
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
				contentInherited: false
			}
		};
		newVariants.set(accountId, current);
		variants = newVariants;
		scheduleAutoSave();
	}

	async function loadVariants(postId: string) {
		try {
			const { data, error: err } = await client.GET('/posts/{id}/variants', {
				params: { path: { id: postId } }
			});
			if (err) throw err;
			const nextVariants = new SvelteMap<string, Record<string, VariantPost>>();
			const variantMediaIds = new SvelteSet<string>();
			for (const variant of data?.variants ?? []) {
				if (variant.is_unsynced) {
					let mediaIds = [...(posts[0]?.mediaIds ?? [])];
					if (typeof variant.media_ids === 'string' && variant.media_ids !== '') {
						try {
							const parsed = JSON.parse(variant.media_ids);
							if (Array.isArray(parsed)) {
								mediaIds = parsed.map(String);
							}
						} catch (e) {
							console.error('Failed to parse variant media IDs:', e);
						}
					}
					for (const id of mediaIds) {
						variantMediaIds.add(id);
					}
					nextVariants.set(variant.social_account_id, {
						[posts[0]?.key ?? makeEmptyPost().key]: {
							content: variant.content,
							mediaIds,
							contentInherited: false,
							mediaInherited: false
						}
					});
				}
			}
			variants = nextVariants;
			activeVariantAccountId = editorAccountIdAfterVariantLoad(
				activeVariantAccountId,
				selectedAccountIds,
				nextVariants.keys()
			);

			// Fetch metadata for variant-only media IDs not already hydrated.
			const missingIds = [...variantMediaIds].filter(
				(id) => !mediaMimeTypes.has(id) || !mediaSizes.has(id)
			);
			if (missingIds.length > 0) {
				await hydrateMediaMetadata(initialPost?.workspace_id ?? '', missingIds);
			}
		} catch (e) {
			console.error('Failed to load variants:', e);
			variants = new Map();
		}
	}

	function activateVariantTab(accountId: string | null) {
		activeVariantAccountId = accountId;
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

	function resyncAccount(accountId: string) {
		if (!variants.has(accountId)) return;
		const nextVariants = new SvelteMap(variants);
		nextVariants.delete(accountId);
		variants = nextVariants;
		activeVariantAccountId = null;
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
		destinationAction = action;
		destinationActionTargetIds = selectedAccountIds.filter(
			(accountId) => accountId !== activeVariantAccountId
		);
		destinationActionOpen = true;
	}

	function toggleDestinationActionTarget(accountId: string) {
		destinationActionTargetIds = destinationActionTargetIds.includes(accountId)
			? destinationActionTargetIds.filter((id) => id !== accountId)
			: [...destinationActionTargetIds, accountId];
	}

	function inheritedVariantRecord(): Record<string, VariantPost> {
		return Object.fromEntries(
			posts.map((post) => [
				post.key,
				{
					content: post.content,
					mediaIds: [...post.mediaIds],
					contentInherited: true,
					mediaInherited: true
				}
			])
		);
	}

	function applyDestinationAction() {
		const sourceAccountId = activeVariantAccountId;
		if (!sourceAccountId || destinationActionTargetIds.length === 0) return;
		const source = normalizeVariantRecord(
			variants.get(sourceAccountId) ?? inheritedVariantRecord(),
			posts
		);
		const nextVariants = new SvelteMap(variants);
		const nextSchedules = { ...scheduleOverridesByAccount };

		for (const targetId of destinationActionTargetIds) {
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
				const iso = data.slot_time as string;
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
	function setPostContent(index: number, value: string) {
		posts = posts.map((p, pi) => (pi === index ? { ...p, content: value } : p));
		scheduleAutoSave();
	}

	function setEditorContent(index: number, value: string) {
		if (activeVariantAccountId && activeVariantIsUnsynced) {
			handleVariantChange(activeVariantAccountId, index, value);
			return;
		}
		setPostContent(index, value);
	}

	function setActivePost(index: number) {
		activePostIndex = index;
	}
</script>

<!-- ====================================================================== -->
<!-- Top Bar -->
<!-- ====================================================================== -->
<div class="flex flex-1 flex-col overflow-hidden">
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
						{selectedAccountIds}
						customAccountIds={[...variants.keys()]}
						{accountIssues}
						bind:selectedSetId={selectedSocialSetId}
						disabled={isSaving || isSubmitting}
						autoApplyDefault={!initialPost && !publicationId}
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
						<LoaderIcon class="size-4 animate-spin" />
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
					<ComposerValidationMenu issues={visibleGlobalIssues} />
				{/if}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								type="button"
								variant="outline"
								size="icon"
								class="size-11 shrink-0"
								aria-label={m.sidebar_more()}
							>
								<MoreHorizontalIcon class="size-4" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56" align="end">
						<DropdownMenu.Item
							class="min-h-11"
							onclick={() => (showPromptCard ? dismissPrompt() : fetchRandomPrompt())}
						>
							<LightbulbIcon class="mr-2 size-4" />
							{showPromptCard ? m.compose_dismiss_inspiration() : m.compose_need_inspiration()}
						</DropdownMenu.Item>
					</DropdownMenu.Content>
				</DropdownMenu.Root>
				{#if isEditMode && !autoSavesDraft}
					<Button
						type="button"
						variant="ghost"
						size="icon"
						class="size-11 text-muted-foreground hover:text-destructive md:size-8"
						aria-label={m.common_delete()}
						title={m.common_delete()}
						onclick={() => (showDeleteConfirm = true)}
						disabled={isDeleting || isSaving || isSubmitting}
					>
						<Trash2Icon class="size-4" />
					</Button>
					<Button
						size="sm"
						class="ml-auto h-11 shrink-0 px-3"
						onclick={saveEditedPost}
						disabled={isSaving || isSubmitting || !canSubmitPublication}
					>
						{#if isSaving}<LoaderIcon class="size-3.5 animate-spin" />{/if}
						<span>{isSaving ? m.compose_saving_changes() : m.compose_save_changes()}</span>
					</Button>
				{:else}
					<ComposerPublishActions
						class="w-full"
						scheduleLabel={formatScheduledDisplay()}
						quickScheduleLabel={selectedDate && selectedTime
							? m.compose_schedule_selected_time({ schedule: formatScheduledDisplay() })
							: m.compose_schedule_next_slot()}
						publishLabel={m.compose_publish_now()}
						deleteLabel={m.common_delete()}
						busy={isSubmitting || isSaving}
						deleting={isDeleting}
						quickScheduleBusy={suggestingSlot}
						scheduleSelected={Boolean(selectedDate && selectedTime)}
						canOpenSchedule={selectedWorkspaceSettingsReady}
						canQuickSchedule={canSubmitPublication && selectedWorkspaceSettingsReady}
						canPublish={canSubmitPublication}
						onSchedule={openScheduleDialog}
						onQuickSchedule={quickSchedule}
						onPublish={() => publish(true)}
						onDelete={draftId || publicationOnlyEdit ? () => (showDeleteConfirm = true) : undefined}
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
						{selectedAccountIds}
						customAccountIds={[...variants.keys()]}
						{accountIssues}
						bind:selectedSetId={selectedSocialSetId}
						disabled={isSaving || isSubmitting}
						autoApplyDefault={!initialPost && !publicationId}
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
						<LoaderIcon class="size-3.5 animate-spin" />
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
				{#if accounts.length > 0}
					<ComposerValidationMenu issues={visibleGlobalIssues} class="size-8" />
				{/if}
			</div>

			<div class="flex flex-wrap items-center gap-1.5 md:gap-2">
				<!-- Prompt -->
				<Tooltip.Root>
					<Tooltip.Trigger>
						{#snippet child({ props })}
							<Button
								{...props}
								variant="ghost"
								size="icon"
								class={showPromptCard ? 'text-amber-500' : ''}
								onclick={() => (showPromptCard ? dismissPrompt() : fetchRandomPrompt())}
								title={showPromptCard
									? m.compose_dismiss_inspiration()
									: m.compose_need_inspiration()}
								aria-label={showPromptCard
									? m.compose_dismiss_inspiration()
									: m.compose_need_inspiration()}
							>
								<LightbulbIcon class="h-4 w-4" />
							</Button>
						{/snippet}
					</Tooltip.Trigger>
					<Tooltip.Content>
						<p class="text-sm">
							{showPromptCard ? m.compose_dismiss_inspiration() : m.compose_need_inspiration()}
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
						onclick={() => (showDeleteConfirm = true)}
						disabled={isDeleting || isSaving || isSubmitting}
					>
						<Trash2Icon class="size-4" />
					</Button>
					<Button
						size="sm"
						class="gap-1.5"
						onclick={saveEditedPost}
						disabled={isSaving || isSubmitting || !canSubmitPublication}
					>
						{#if isSaving}<LoaderIcon class="h-3.5 w-3.5 animate-spin" />{/if}
						<span>{isSaving ? m.compose_saving_changes() : m.compose_save_changes()}</span>
					</Button>
				{:else}
					<ComposerPublishActions
						scheduleLabel={formatScheduledDisplay()}
						quickScheduleLabel={selectedDate && selectedTime
							? m.compose_schedule_selected_time({ schedule: formatScheduledDisplay() })
							: m.compose_schedule_next_slot()}
						publishLabel={m.compose_publish_now()}
						deleteLabel={m.common_delete()}
						busy={isSubmitting || isSaving}
						deleting={isDeleting}
						quickScheduleBusy={suggestingSlot}
						scheduleSelected={Boolean(selectedDate && selectedTime)}
						canOpenSchedule={selectedWorkspaceSettingsReady}
						canQuickSchedule={canSubmitPublication && selectedWorkspaceSettingsReady}
						canPublish={canSubmitPublication}
						onSchedule={openScheduleDialog}
						onQuickSchedule={quickSchedule}
						onPublish={() => publish(true)}
						onDelete={draftId || publicationOnlyEdit ? () => (showDeleteConfirm = true) : undefined}
					/>
				{/if}
			</div>
		</div>
	{/if}

	<ComposerScheduleDialog
		bind:open={showScheduleDialog}
		bind:selectedDate
		bind:selectedTime
		{timeSlots}
		timezone={scheduleTimezoneLabel}
		weekStartsOn={workspaceCtx.weekStartsOn}
		selectedDisplay={formatScheduledDisplay()}
		externalError={scheduleInputError}
		suggesting={suggestingSlot}
		submitting={isSubmitting}
		canSchedule={canSubmitPublication}
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
			onAction={() => void loadAccounts(selectedWorkspaceId, accountRetryIds)}
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
			onDismiss={() => (workspaceChangeNotice = '')}
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

	<!-- ====================================================================== -->
	<!-- Main Content Area -->
	<!-- ====================================================================== -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Compose Column -->
		<div class="flex flex-1 flex-col overflow-y-auto">
			<div class="mx-auto w-full max-w-2xl px-3 py-4 md:px-6 md:py-6">
				{#if selectedAccounts.length > 0}
					<section class="mb-5" aria-label={m.compose_destination_tabs()}>
						<div
							class="flex gap-1 overflow-x-auto border-b pb-px"
							role="tablist"
							aria-label={m.compose_destination_tabs()}
						>
							<button
								type="button"
								role="tab"
								aria-selected={!activeVariantAccountId}
								class="min-h-11 shrink-0 border-b-2 px-3 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
								class:border-foreground={!activeVariantAccountId}
								class:border-transparent={Boolean(activeVariantAccountId)}
								class:text-muted-foreground={Boolean(activeVariantAccountId)}
								onclick={() => activateVariantTab(null)}
							>
								{m.compose_all_channels()}
							</button>
							{#each selectedAccounts as account (account.id)}
								{@const issueCount = accountIssueMessages(account).length}
								<button
									type="button"
									role="tab"
									aria-selected={activeVariantAccountId === account.id}
									class="flex min-h-11 shrink-0 items-center gap-1.5 border-b-2 px-3 text-sm transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:min-h-9"
									class:border-foreground={activeVariantAccountId === account.id}
									class:border-transparent={activeVariantAccountId !== account.id}
									class:text-muted-foreground={activeVariantAccountId !== account.id}
									onclick={() => activateVariantTab(account.id)}
								>
									<span class="max-w-32 truncate">{accountLabel(account)}</span>
									{#if destinationFormatLabel(account)}
										<span class="text-xs text-muted-foreground"
											>· {destinationFormatLabel(account)}</span
										>
									{/if}
									{#if issueCount > 0}
										<span
											class="rounded-full bg-destructive/10 px-1.5 py-0.5 text-xs text-destructive"
											>{issueCount}</span
										>
									{/if}
								</button>
							{/each}
						</div>

						{#if activeVariantAccount}
							<div class="flex flex-wrap items-center gap-2 border-b py-3">
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-11 md:h-9"
									onclick={() => openAccountPreview(activeVariantAccount!)}
								>
									{m.compose_preview()}
								</Button>
								<Button
									type="button"
									variant="ghost"
									size="sm"
									class="h-11 md:h-9"
									onclick={() => openDestinationSettings(activeVariantAccount!)}
								>
									{m.compose_platform_settings()}
								</Button>
								<DropdownMenu.Root>
									<DropdownMenu.Trigger>
										{#snippet child({ props })}
											<Button
												{...props}
												type="button"
												variant="ghost"
												size="icon"
												class="size-11 md:size-9"
												aria-label={m.sidebar_more()}
											>
												<MoreHorizontalIcon class="size-4" />
											</Button>
										{/snippet}
									</DropdownMenu.Trigger>
									<DropdownMenu.Content class="w-56" align="start">
										{#if variantHasContentOverride(activeVariantAccount.id)}
											<DropdownMenu.Item
												onclick={() => resetVariantField(activeVariantAccount!.id, 'content')}
											>
												{m.compose_reset_field()}
											</DropdownMenu.Item>
										{/if}
										{#if variantHasMediaOverride(activeVariantAccount.id)}
											<DropdownMenu.Item
												onclick={() => resetVariantField(activeVariantAccount!.id, 'media')}
											>
												{m.compose_reset_media()}
											</DropdownMenu.Item>
										{/if}
										{#if activeVariantIsUnsynced}
											<DropdownMenu.Item onclick={() => resyncAccount(activeVariantAccount!.id)}>
												{m.compose_reset_destination()}
											</DropdownMenu.Item>
										{/if}
										{#if selectedAccounts.length > 1}
											<DropdownMenu.Separator />
											<DropdownMenu.Item onclick={() => openDestinationAction('media')}>
												{m.compose_apply_media()}
											</DropdownMenu.Item>
											<DropdownMenu.Item onclick={() => openDestinationAction('copy')}>
												{m.compose_copy_rendition()}
											</DropdownMenu.Item>
										{/if}
									</DropdownMenu.Content>
								</DropdownMenu.Root>
								<details class="ml-auto text-sm">
									<summary class="flex min-h-11 cursor-pointer items-center md:min-h-9">
										{m.compose_advanced_delivery()}
									</summary>
									<div class="mt-2 w-[min(20rem,calc(100vw-2rem))] space-y-1.5 pb-1">
										<label
											class="text-xs font-medium"
											for="destination-schedule-{activeVariantAccount.id}"
										>
											{m.compose_destination_schedule()}
										</label>
										<Input
											id="destination-schedule-{activeVariantAccount.id}"
											type="datetime-local"
											value={destinationScheduleValue(activeVariantAccount.id)}
											oninput={(event) =>
												updateDestinationSchedule(
													activeVariantAccount!.id,
													event.currentTarget.value
												)}
										/>
										<p class="text-xs text-muted-foreground">
											{scheduleOverridesByAccount[activeVariantAccount.id]
												? m.compose_custom_state()
												: m.compose_schedule_inherited()}
										</p>
									</div>
								</details>
							</div>
							{#if resolvedCapabilities[activeVariantAccount.id]?.segment_strategy === 'join' && posts.length > 1}
								<p class="pt-2 text-xs text-muted-foreground">
									{m.compose_segments_joined({ count: posts.length })}
								</p>
							{/if}
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
						optionsLoadingAccountId={destinationOptionsLoadingAccountId}
						onChange={updateAccountSetting}
						onFormatChange={selectDestinationFormat}
						onAddMedia={() => openMediaPicker(activePostIndex)}
					/>
					<details class="mb-5 rounded-lg border border-border/60 px-3 py-2 text-sm">
						<summary class="flex min-h-9 cursor-pointer items-center text-muted-foreground">
							{m.compose_advanced_delivery()}
						</summary>
						<div class="border-t pt-3">
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
					</details>
				{/if}

				<!-- Prompt Card -->
				{#if showPromptCard}
					<div class="relative mb-5 rounded border bg-muted/30 p-4 pr-20">
						<div class="absolute top-2 right-2 flex items-center gap-1">
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground"
								onclick={fetchRandomPrompt}
								disabled={loadingPrompt}
								title={m.compose_shuffle()}
								aria-label={m.compose_shuffle()}
							>
								<ShuffleIcon class="size-4" />
							</Button>
							<Button
								variant="ghost"
								size="icon"
								class="text-muted-foreground"
								onclick={dismissPrompt}
								title={m.compose_close()}
								aria-label={m.compose_close()}
							>
								<XIcon class="size-4" />
							</Button>
						</div>
						{#if loadingPrompt}
							<div class="space-y-2 py-2">
								<Skeleton class="h-3 w-full" />
								<Skeleton class="h-3 w-3/4" />
							</div>
						{:else if currentPrompt}
							<p class="text-sm leading-relaxed text-foreground/80">{currentPrompt.text}</p>
							{#if currentPrompt.example}
								<p
									class="mt-3 border-t pt-3 text-sm leading-relaxed whitespace-pre-wrap text-foreground/90"
								>
									{currentPrompt.example}
								</p>
							{/if}
							<div class="mt-3 flex justify-end">
								<Button
									size="sm"
									class="gap-1.5"
									onclick={() => requestApplyPrompt(currentPrompt!)}
									title={m.compose_apply_prompt_title()}
								>
									<CheckIcon class="size-3.5" />
									{m.compose_apply_prompt()}
								</Button>
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">{m.compose_no_prompts()}</p>
						{/if}
					</div>
				{/if}

				<!-- Posts -->
				<div class="space-y-0">
					<ReorderableList
						items={posts}
						getKey={(post) => post.key}
						onUpdate={handleReorder}
						cssSelectorHandle=".drag-handle"
						direction="vertical"
					>
						{#snippet item(post, i)}
							<div
								class="group/post relative {isDraggingFile && activePostIndex === i
									? 'bg-primary/5'
									: ''}"
								role="region"
								aria-label={m.compose_drop_zone({ number: i + 1 })}
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
												class="drag-handle -ml-6 flex size-10 cursor-grab items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:opacity-100 active:cursor-grabbing md:-ml-4 md:size-6 md:opacity-0 md:group-hover/post:opacity-60"
												title={m.compose_drag_to_reorder()}
												aria-label={m.compose_drag_to_reorder()}
											>
												<GripVerticalIcon class="h-4 w-4" />
											</button>
										</div>
									{/if}

									<div class="min-w-0 flex-1">
										<div class="relative">
											{#if i === 0 && (editorTextIsYouTubeDescription || editorTextHasMixedMeaning)}
												<div class="mb-1 px-1">
													<p class="text-xs font-medium text-foreground">
														{editorTextIsYouTubeDescription
															? m.compose_description()
															: m.compose_post_text()}
													</p>
													{#if editorTextHasMixedMeaning}
														<p class="text-xs text-muted-foreground">
															{m.compose_shared_text_meaning()}
														</p>
													{/if}
												</div>
											{/if}
											<Textarea
												id="post-textarea-{i}"
												aria-label={editorTextIsYouTubeDescription
													? m.compose_description()
													: m.compose_post_text()}
												unstyled
												{@attach textareaAttachment(i)}
												value={getEditorContentForPost(post)}
												oninput={(e) => {
													const target = e.target as HTMLTextAreaElement;
													setEditorContent(i, target.value);
													autoResize(target);
												}}
												onpaste={(e) => handlePaste(e, i)}
												onfocus={() => setActivePost(i)}
												placeholder={activeVariantAccountId
													? activeVariantIsUnsynced
														? editorTextIsYouTubeDescription
															? m.compose_describe_video()
															: m.compose_write_custom_version({
																	platform: getPlatformName(activeVariantAccount?.platform ?? '')
																})
														: m.compose_unsync_to_edit_placeholder()
													: i === 0
														? editorTextIsYouTubeDescription
															? m.compose_describe_video()
															: m.compose_whats_on_your_mind()
														: m.compose_add_to_thread()}
												class="w-full resize-none overflow-y-hidden border-0 bg-transparent py-2 pr-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none md:py-3 md:pr-4 md:text-lg"
												style="min-height: {i === 0 ? '120px' : '56px'};"
												disabled={isSubmitting ||
													(!!activeVariantAccountId && !activeVariantIsUnsynced)}
											/>

											{#if activeVariantAccountId && activePostIndex === i && !activeVariantIsUnsynced}
												<div class="absolute inset-x-0 bottom-0 px-1 pb-2">
													<div
														class="rounded-xl border border-dashed border-border/80 bg-background/95 px-3 py-2 text-xs text-muted-foreground shadow-sm"
													>
														<div class="flex flex-wrap items-center justify-between gap-2">
															<span>{m.compose_editor_locked_synced()}</span>
															<Button
																variant="outline"
																size="sm"
																class="h-7 gap-1 text-xs"
																onclick={() =>
																	activeVariantAccountId && unsyncAccount(activeVariantAccountId)}
															>
																<UnlinkIcon class="h-3.5 w-3.5" />
																{m.compose_unsync_to_edit()}
															</Button>
														</div>
													</div>
												</div>
											{/if}

											{#if isUploading && activePostIndex === i}
												<div
													class="absolute inset-0 flex items-center justify-center bg-background/80"
												>
													<LoaderIcon class="h-5 w-5 animate-spin text-primary" />
												</div>
											{/if}
										</div>

										{#if i === 0 && showLinkInput}
											<div
												class="mb-3 flex items-center gap-2 rounded-md border bg-muted/15 p-2"
												data-testid="composer-link-field"
											>
												<LinkIcon class="ml-1 size-4 shrink-0 text-muted-foreground" />
												<Input
													type="url"
													class="h-11 min-w-0 border-0 bg-transparent shadow-none focus-visible:ring-0 md:h-9"
													value={linkUrl}
													placeholder={m.compose_shared_link()}
													aria-label={m.compose_link_url()}
													oninput={(event) => {
														linkUrl = event.currentTarget.value;
														scheduleAutoSave();
													}}
												/>
												<Button
													type="button"
													variant="ghost"
													size="icon"
													class="size-11 shrink-0 text-muted-foreground md:size-9"
													aria-label={m.compose_remove_link()}
													onclick={() => {
														linkUrl = '';
														showLinkInput = false;
														scheduleAutoSave();
													}}
												>
													<XIcon class="size-4" />
												</Button>
											</div>
										{/if}

										<!-- Media grid -->
										{#if getEditorMediaIdsForPost(post).length > 0}
											<div
												class="mb-3 {getEditorMediaIdsForPost(post).length === 1
													? ''
													: 'grid grid-cols-2 gap-1.5'}"
											>
												{#each getEditorMediaIdsForPost(post) as mediaId, mi (mediaId)}
													{@const isFirstOfThree =
														getEditorMediaIdsForPost(post).length === 3 && mi === 0}
													<div
														class="group/media relative overflow-hidden rounded-lg {isFirstOfThree
															? 'col-span-2'
															: ''}"
													>
														{#if isVideoMedia(mediaId)}
															<video
																src={getAuthenticatedMediaByID(mediaId)}
																class="{getEditorMediaIdsForPost(post).length === 1
																	? 'aspect-video'
																	: 'aspect-square'} w-full object-cover"
																controls
																muted
																playsinline
															></video>
														{:else}
															<img
																src={getAuthenticatedMediaByID(mediaId)}
																alt={mediaAltTexts.get(mediaId) || ''}
																class="{getEditorMediaIdsForPost(post).length === 1
																	? 'aspect-video'
																	: 'aspect-square'} w-full object-cover"
															/>
														{/if}
														<div
															class="absolute top-2 right-2 flex items-center gap-1 opacity-100 md:opacity-0 md:transition-opacity md:group-focus-within/media:opacity-100 md:group-hover/media:opacity-100"
															data-testid="composer-media-actions"
														>
															<button
																type="button"
																class={[
																	'flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-black/90 md:size-7',
																	mediaAltTexts.get(mediaId)
																		? 'ring-2 ring-primary/80 ring-offset-1 ring-offset-transparent'
																		: ''
																]}
																aria-label={mediaAltTexts.get(mediaId)
																	? m.media_alt_text()
																	: m.media_add_alt_text()}
																title={mediaAltTexts.get(mediaId)
																	? m.media_alt_text()
																	: m.media_add_alt_text()}
																onclick={(e) => {
																	e.stopPropagation();
																	editingAltMediaId =
																		editingAltMediaId === mediaId ? null : mediaId;
																}}
															>
																<TypeIcon class="size-4 md:size-3.5" />
															</button>
															<button
																type="button"
																class="flex size-11 items-center justify-center rounded-md bg-black/75 text-white shadow-sm backdrop-blur-sm transition-colors hover:bg-red-600 md:size-7"
																aria-label={m.compose_remove_media()}
																title={m.compose_remove_media()}
																onclick={(e) => {
																	e.stopPropagation();
																	removeMedia(i, mi);
																}}
															>
																<XIcon class="size-4 md:size-3.5" />
															</button>
														</div>
														{#if editingAltMediaId === mediaId}
															<div
																class="absolute inset-x-0 bottom-0 bg-black/70 p-2 backdrop-blur-sm"
															>
																<Textarea
																	value={mediaAltTexts.get(mediaId) || ''}
																	unstyled
																	oninput={(e) =>
																		setMediaAltText(
																			mediaId,
																			(e.target as HTMLTextAreaElement).value
																		)}
																	placeholder={m.compose_alt_text_placeholder()}
																	rows={2}
																	class="w-full resize-none rounded bg-white/10 px-2 py-2 text-base text-white placeholder:text-white/60 focus:ring-2 focus:ring-white/70 focus:outline-none md:py-1 md:text-xs"
																	aria-label={m.media_alt_text()}
																/>
																<div class="mt-1 flex justify-end gap-1">
																	<button
																		type="button"
																		class="text-xs text-white/70 hover:text-white"
																		onclick={() => (editingAltMediaId = null)}
																		>{m.common_done()}</button
																	>
																</div>
															</div>
														{/if}
													</div>
												{/each}
											</div>
										{/if}

										<!-- Bottom bar -->
										<div
											class="flex items-center gap-2 pb-2 transition-opacity {activePostIndex === i
												? 'opacity-100'
												: 'pointer-events-none opacity-0'}"
										>
											{#if isThread}<span
													class="text-xs font-medium text-muted-foreground/60 tabular-nums"
													>#{i + 1}</span
												>{/if}

											<button
												type="button"
												class="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 md:size-7"
												disabled={!!activeVariantAccountId && !activeVariantIsUnsynced}
												onclick={() => openMediaPicker(i)}
												aria-label={m.media_picker_add_media()}
											>
												<ImageIcon class="h-3.5 w-3.5" />
											</button>

											{#if i === 0}
												<Tooltip.Root>
													<Tooltip.Trigger>
														{#snippet child({ props })}
															<button
																{...props}
																type="button"
																class="flex size-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground md:size-7"
																aria-label={m.compose_link_url()}
																aria-pressed={showLinkInput}
																onclick={() => {
																	showLinkInput = !showLinkInput;
																	if (!showLinkInput) linkUrl = '';
																	scheduleAutoSave();
																}}
															>
																<LinkIcon class="size-3.5" />
															</button>
														{/snippet}
													</Tooltip.Trigger>
													<Tooltip.Content
														><p class="text-sm">{m.compose_link_url()}</p></Tooltip.Content
													>
												</Tooltip.Root>
											{/if}

											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														{@const editorUsage = editorCharacterUsage(
															getEditorContentForPost(post)
														)}
														<div {...props} class="flex cursor-default items-center gap-1.5">
															<svg
																class="h-4 w-4 {getCharCounterColor(
																	editorUsage.count,
																	editorUsage.limit
																)}"
																viewBox="0 0 20 20"
															>
																<circle
																	cx="10"
																	cy="10"
																	r="8"
																	fill="none"
																	stroke="currentColor"
																	stroke-width="2.5"
																	opacity="0.15"
																/>
																<circle
																	cx="10"
																	cy="10"
																	r="8"
																	fill="none"
																	stroke={getCharCounterStrokeColor(
																		editorUsage.count,
																		editorUsage.limit
																	)}
																	stroke-width="2.5"
																	stroke-linecap="round"
																	stroke-dasharray={50.27}
																	stroke-dashoffset={50.27 *
																		Math.max(0, 1 - editorUsage.count / editorUsage.limit)}
																	transform="rotate(-90 10 10)"
																/>
															</svg>
															<span class="text-xs text-muted-foreground/60 tabular-nums"
																>{editorUsage.count}/{editorUsage.limit}</span
															>
														</div>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content>
													<div class="space-y-1">
														<p class="text-xs font-medium text-muted-foreground">
															{m.compose_character_limits()}
														</p>
														{#each editorPlatformLimits as pl (pl.key)}
															{@const platformCount = platformTextLength(
																pl.key,
																getEditorContentForPost(post)
															)}
															<div class="flex items-center justify-between gap-2 text-xs">
																<div class="flex items-center gap-1.5">
																	<PlatformIcon platform={pl.key} class="h-3 w-3" /><span
																		>{pl.platform}</span
																	>
																</div>
																<span
																	class="tabular-nums {platformCount > pl.limit
																		? 'text-red-500'
																		: 'text-muted-foreground'}">{platformCount}/{pl.limit}</span
																>
															</div>
														{/each}
													</div>
												</Tooltip.Content>
											</Tooltip.Root>

											<button
												type="button"
												class="-mx-2 flex min-h-11 items-center gap-1.5 px-2 text-xs text-muted-foreground/60 transition-colors hover:text-foreground md:mx-0 md:min-h-7 md:px-0"
												onclick={addPost}
											>
												<PlusIcon class="h-3 w-3" />{m.compose_add_post()}
											</button>
										</div>

										{#if isThread}
											<button
												type="button"
												class="absolute top-1 right-0 flex size-10 items-center justify-center rounded-md text-muted-foreground opacity-70 transition-opacity hover:bg-muted hover:text-destructive md:top-3 md:size-7 md:opacity-0 md:group-hover/post:opacity-100"
												onclick={() => removePost(i)}
												title={m.compose_remove_post()}
												aria-label={m.compose_remove_post()}
											>
												<Trash2Icon class="h-3.5 w-3.5" />
											</button>
										{/if}
									</div>
								</div>
							</div>
						{/snippet}
					</ReorderableList>
				</div>
			</div>
		</div>
	</div>
</div>

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
				<label class="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm">
					<Checkbox
						checked={destinationActionTargetIds.includes(account.id)}
						onCheckedChange={() => toggleDestinationActionTarget(account.id)}
					/>
					<span class="min-w-0 truncate">{accountLabel(account)}</span>
					<span class="ml-auto text-xs text-muted-foreground">
						{getPlatformName(account.platform)}
					</span>
				</label>
			{/each}
		</div>
		<Dialog.Footer>
			<Button type="button" variant="outline" onclick={() => (destinationActionOpen = false)}>
				{m.common_cancel()}
			</Button>
			<Button
				type="button"
				disabled={destinationActionTargetIds.length === 0}
				onclick={applyDestinationAction}
			>
				{m.compose_apply_changes()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<MediaPicker
	bind:open={mediaPickerOpen}
	workspaceId={selectedWorkspaceId}
	currentSelection={posts[mediaPickerPostIndex]
		? getEditorMediaIdsForPost(posts[mediaPickerPostIndex])
		: []}
	maxSelection={composerMediaLimit}
	multiple={composerMediaLimit > 1}
	purpose={isThread ? 'thread_segment' : 'post_media'}
	onConfirm={async (ids) => {
		setEditorMediaIds(mediaPickerPostIndex, ids);
		await hydrateMediaMetadata(selectedWorkspaceId, ids);
	}}
	onCreate={openImageEditorFromComposer}
/>

<DestinationSettingsDialog
	bind:open={settingsDialogOpen}
	account={settingsAccount}
	settings={settingsDialogFields}
	values={settingsDialogValues}
	mediaItems={settingsDialogMedia}
	mediaValues={settingsDialogMediaValues}
	optionGroups={settingsAccount ? (destinationOptionsByAccount[settingsAccount.id] ?? {}) : {}}
	optionsLoading={settingsAccount?.id === destinationOptionsLoadingAccountId}
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
	onRetry={() => {
		if (settingsAccount) void loadDestinationOptions(settingsAccount, true);
	}}
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

<PromptApplyDialog
	bind:open={promptApplyDialogOpen}
	example={pendingPromptToApply ? resolvePromptContent(pendingPromptToApply) : ''}
	onConfirm={confirmApplyPrompt}
	onCancel={cancelApplyPrompt}
/>
