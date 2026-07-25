<script lang="ts">
	import { onDestroy, onMount, type Snippet } from 'svelte';
	import { SvelteSet } from 'svelte/reactivity';
	import { page } from '$app/stores';
	import { beforeNavigate, goto, replaceState } from '$app/navigation';
	import { resolve } from '$app/paths';
	import { client, type SocialAccount } from '$lib/api/client';
	import type { components } from '$lib/api/types';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { isSupportedMediaFile, uploadMediaFile } from '$lib/media-upload-client';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Textarea } from '$lib/components/ui/textarea';
	import ComposerAccountMenu from './composer-account-menu.svelte';
	import ComposerMediaDropzone from './composer-media-dropzone.svelte';
	import ComposerPublishActions from './composer-publish-actions.svelte';
	import ComposerScheduleDialog from './composer-schedule-dialog.svelte';
	import ComposerValidationMenu from './composer-validation-menu.svelte';
	import DestinationSettingsDialog from './destination-settings-dialog.svelte';
	import DestructiveConfirmDialog from './destructive-confirm-dialog.svelte';
	import DraftConflictDialog from './draft-conflict-dialog.svelte';
	import InlineNotice from './inline-notice.svelte';
	import MediaPicker from './media-picker.svelte';
	import PageLoading from './page-loading.svelte';
	import { getLocaleTag } from '$lib/i18n';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { CalendarDate, isEqualDay } from '@internationalized/date';
	import {
		workspaceClock,
		workspaceScheduleFromISO,
		workspaceScheduleToISO
	} from './compose/schedule-timezone';
	import {
		buildFocusedPublicationPayload,
		composerMode,
		isAccountCompatibleWithMode,
		roleFieldsForMode,
		type ComposerModeKey,
		type FocusedComposerFields,
		type FocusedFieldKey,
		type FocusedMediaInput,
		type FocusedSegmentInput,
		type ResolvedComposerTarget
	} from './compose/modes';
	import {
		defaultFocusedSchedulingSettings,
		isFocusedProviderReadinessReady,
		isFutureSchedule,
		snapshotFocusedSchedulingSettings,
		type FocusedSchedulingSettings
	} from './compose/focused-workspace';
	import {
		accountCapabilityNeedsAttention,
		isActionableAccountIssue
	} from './compose/account-attention';
	import {
		composerIssues,
		isAccountSpecificIssue,
		issueMatchesProvider,
		uniqueIssueMessages
	} from './compose/validation';
	import { loadableDestinationOptionSources } from './compose/destination-options';
	import ImagePlusIcon from 'lucide-svelte/icons/image-plus';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import Trash2Icon from 'lucide-svelte/icons/trash-2';
	import XIcon from 'lucide-svelte/icons/x';
	import { m } from '$lib/paraglide/messages';
	import { consumeStudioReturnToken, createStudioReturnToken } from '$lib/studio/api';
	import {
		clearComposerRecovery,
		loadComposerRecovery,
		storeComposerRecovery
	} from '$lib/studio/recovery';
	import type { ComposerRecoverySnapshot, StudioMediaItem } from '$lib/studio/types';
	import { parseDraftConflict, type DraftConflictProblem } from '$lib/draft-conflict';
	import { SerializedSaveQueue } from '$lib/serialized-save-queue';

	type Capability = components['schemas']['Capability'];
	type Publication = components['schemas']['PublicationResponse'];
	type Rendition = components['schemas']['RenditionResponse'];
	type MediaSummary = components['schemas']['MediaSummary'];
	type ValidationIssue = components['schemas']['ValidationIssue'];
	type ProviderReadinessItem = components['schemas']['ProviderReadinessItem'];
	type SettingDefinition = components['schemas']['SettingDefinition'];
	type ResolvedAccountCapability = components['schemas']['ResolvedAccountCapability'];
	type DestinationOption = components['schemas']['DestinationOption'];

	interface FocusedMedia {
		id: string;
		mime_type: string;
		url: string;
		size?: number;
		filename?: string;
		role?: string;
		altText?: string;
		settings?: Record<string, unknown>;
		settingsByAccount?: Record<string, Record<string, unknown>>;
	}

	interface FocusedStudioSnapshotPayload {
		mode: ComposerModeKey;
		publication_id: string;
		selected_workspace_id: string;
		selected_account_ids: string[];
		fields: FocusedComposerFields;
		media: FocusedMedia[];
		segments: FocusedSegmentInput[];
		active_settings_segment_id: string;
		thumbnail_media: FocusedMedia | null;
		thumbnail_media_id: string;
		settings_by_account: Record<string, Record<string, unknown>>;
		segment_settings_by_account: Record<string, Record<string, unknown>>;
		selected_date?: string;
		selected_time: string | null;
		picker_purpose: 'media' | 'thumbnail';
	}

	interface Props {
		mode: ComposerModeKey;
		initialPublication?: Publication | null;
		initialScheduleDate?: string | null;
		initialWorkspaceId?: string | null;
		onSuccess?: () => void;
		onCancel?: () => void;
		onDraftCreated?: (id: string) => void;
		modeControl?: Snippet;
	}

	let {
		mode,
		initialPublication = null,
		initialScheduleDate = null,
		initialWorkspaceId = null,
		onSuccess,
		onCancel,
		onDraftCreated,
		modeControl
	}: Props = $props();

	let publicationId = $state('');
	let revision = $state(1);
	let hydratedPublicationId = $state('');
	let selectedWorkspaceId = $state('');
	let accounts = $state<SocialAccount[]>([]);
	let selectedAccountIds = $state<string[]>([]);
	let capabilities = $state<Capability[]>([]);
	let providerReadiness = $state<ProviderReadinessItem[]>([]);
	let providerReadinessWorkspaceId = $state('');
	let providerReadinessLoading = $state(false);
	let providerReadinessError = $state('');
	let fields = $state<FocusedComposerFields>({});
	let media = $state<FocusedMedia[]>([]);
	let segments = $state<FocusedSegmentInput[]>(emptySegmentsForMode('post'));
	let segmentSettingsByAccount = $state<Record<string, Record<string, unknown>>>({});
	let activeSettingsSegmentId = $state('segment-1');
	let thumbnailMedia = $state<FocusedMedia | null>(null);
	let thumbnailMediaId = $state('');
	let settingsByAccount = $state<Record<string, Record<string, unknown>>>({});
	let settingsDialogOpen = $state(false);
	let settingsAccountId = $state('');
	let deleteDestinationDialogOpen = $state(false);
	let deleteDestinationAccount = $state<SocialAccount | null>(null);
	let destinationOptionsByAccount = $state<Record<string, Record<string, DestinationOption[]>>>({});
	let destinationOptionsErrors = $state<Record<string, string>>({});
	let destinationOptionsLoadingAccountId = $state('');
	let selectedDate = $state<CalendarDate | undefined>(undefined);
	let selectedTime = $state<string | null>(null);
	let showScheduleDialog = $state(false);
	let validationIssues = $state<ValidationIssue[]>([]);
	let loading = $state(true);
	let accountsLoading = $state(false);
	let accountsError = $state('');
	let uploading = $state(false);
	let draggingMedia = $state(false);
	let mediaPickerOpen = $state(false);
	let mediaPickerPurpose = $state<'media' | 'thumbnail'>('media');
	let saving = $state(false);
	let autoSaving = $state(false);
	let error = $state('');
	let success = $state('');
	let draftConflict = $state<DraftConflictProblem | null>(null);
	let conflictDialogOpen = $state(false);
	let deletePublicationDialogOpen = $state(false);
	let deletingPublication = $state(false);
	let scheduleError = $state('');
	let suggestingSlot = $state(false);
	let schedulingSettings = $state<FocusedSchedulingSettings>(defaultFocusedSchedulingSettings());
	let schedulingSettingsWorkspaceId = $state('');
	let workspaceChangeSequence = 0;
	let accountsRequestSequence = 0;
	let readinessRequestSequence = 0;
	let destinationOptionsRequestSequence = 0;
	let capabilityResolveRequestSequence = 0;
	let nextSlotRequestSequence = 0;
	let saveGeneration = 0;
	const saveQueue = new SerializedSaveQueue(() => publicationId);
	let allowNavigationOnce = false;
	let autoSaveReady = false;
	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSavedSnapshot = '';
	let publicationContextRequestId = '';
	let resolvedCapabilities = $state<Record<string, ResolvedAccountCapability>>({});
	let capabilityResolveLoading = $state(false);
	let capabilityResolveError = $state('');

	const modeMeta = $derived(composerMode(mode));
	const compatibleAccounts = $derived(accounts.filter(isAccountCompatible));
	const selectedAccounts = $derived(
		accounts.filter((account) => selectedAccountIds.includes(account.id))
	);
	const roleFields = $derived(roleFieldsForMode(mode, selectedAccounts));
	const selectedCapabilities = $derived(
		selectedAccounts
			.map((account) => capabilityForAccount(account))
			.filter((capability): capability is Capability => capability !== null)
	);
	const composerMediaLimit = $derived.by(() => {
		const limits = selectedCapabilities
			.map((capability) => capability.media.max_count)
			.filter((limit) => Number.isFinite(limit) && limit > 0);
		return limits.length > 0 ? Math.max(1, Math.min(...limits)) : 20;
	});
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
	const hasYouTubeTarget = $derived(
		selectedAccounts.some((account) => getPlatformKey(account.platform) === 'youtube')
	);
	const localBlockers = $derived(formBlockers());
	const globalIssues = $derived(composerIssues(localBlockers, validationIssues));
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
	const canSaveDraft = $derived(Boolean(selectedWorkspaceId) && !saving && !autoSaving);
	const selectedReadinessProviders = $derived(
		selectedAccounts.map((account) => getPlatformKey(account.platform))
	);
	const loadedReadinessProviders = $derived(providerReadiness.map((item) => item.provider));
	const selectedProviderReadinessReady = $derived(
		isFocusedProviderReadinessReady(
			selectedWorkspaceId,
			providerReadinessWorkspaceId,
			providerReadinessLoading,
			providerReadinessError,
			selectedReadinessProviders,
			loadedReadinessProviders
		)
	);
	const canQueue = $derived(
		canSaveDraft &&
			selectedProviderReadinessReady &&
			!capabilityResolveLoading &&
			localBlockers.length === 0 &&
			accountBlockingMessages.length === 0
	);
	const accountSummaries = $derived(
		Object.fromEntries(
			accounts.map((account) => [
				account.id,
				resolvedCapabilities[account.id]?.label ?? getPlatformName(account.platform)
			])
		)
	);
	const warningAccountIds = $derived(
		Array.from(
			new Set([
				...Object.values(resolvedCapabilities)
					.filter(accountCapabilityNeedsAttention)
					.map((capability) => capability.account_id),
				...Object.keys(accountIssues)
			])
		)
	);
	const isEditMode = $derived(Boolean(initialPublication?.id));
	const selectedWorkspaceSettingsReady = $derived(
		Boolean(selectedWorkspaceId) && schedulingSettingsWorkspaceId === selectedWorkspaceId
	);
	const canSchedule = $derived(canQueue && selectedWorkspaceSettingsReady);
	const scheduleTimezoneLabel = $derived(schedulingSettings.timezone);
	const isToday = $derived(
		selectedDate ? isEqualDay(selectedDate, workspaceClock(scheduleTimezoneLabel).date) : false
	);
	const allTimeSlots = $derived.by(() => {
		const start = schedulingSettings.slotStartHour;
		const end = schedulingSettings.slotEndHour;
		const interval = Math.max(1, schedulingSettings.slotIntervalMinutes);
		const slots: string[] = [];
		for (let hour = start; hour <= end; hour++) {
			for (let minute = 0; minute < 60; minute += interval) {
				if (hour === end && minute > 0) break;
				slots.push(`${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`);
			}
		}
		return slots;
	});
	const timeSlots = $derived.by(() => {
		const date = selectedDate;
		if (!date) return allTimeSlots;
		const validSlots = allTimeSlots.filter((slot) =>
			Boolean(workspaceScheduleToISO(date, slot, scheduleTimezoneLabel))
		);
		if (!isToday) return validSlots;
		const currentMinutes = workspaceClock(scheduleTimezoneLabel).minutes;
		return validSlots.filter((slot) => {
			const [hour, minute] = slot.split(':').map(Number);
			return hour * 60 + minute > currentMinutes;
		});
	});

	onMount(async () => {
		segments = emptySegmentsForMode(mode);
		selectedWorkspaceId =
			initialPublication?.workspace_id ||
			initialWorkspaceId ||
			workspaceCtx.currentWorkspace?.id ||
			'';
		await loadInitialData();
		await restoreStudioReturn();
	});

	onMount(() => {
		const handleVisibilityChange = () => {
			if (document.visibilityState === 'hidden') void flushPendingSave();
		};
		document.addEventListener('visibilitychange', handleVisibilityChange);
		return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
	});

	onDestroy(clearAutoSaveTimer);

	beforeNavigate((navigation) => {
		if (allowNavigationOnce) {
			allowNavigationOnce = false;
			return;
		}
		if (
			!navigation.to?.url ||
			!autoSaveReady ||
			!hasDraftContent() ||
			saveSnapshot() === lastSavedSnapshot ||
			draftConflict
		) {
			return;
		}
		const target = `${navigation.to.url.pathname}${navigation.to.url.search}${navigation.to.url.hash}`;
		navigation.cancel();
		void flushPendingSave().then((saved) => {
			if (!saved) return;
			allowNavigationOnce = true;
			return goto(resolve(target as '/'));
		});
	});

	$effect(() => {
		if (
			!loading &&
			initialPublication &&
			initialPublication.id !== hydratedPublicationId &&
			initialPublication.id !== publicationContextRequestId
		) {
			publicationContextRequestId = initialPublication.id;
			void loadInitialPublicationContext(initialPublication);
		}
	});

	$effect(() => {
		const workspaceId = workspaceCtx.currentWorkspace?.id ?? '';
		if (!isEditMode && workspaceId && workspaceId !== selectedWorkspaceId) {
			void changeWorkspace(workspaceId);
		}
	});

	$effect(() => {
		const snapshot = saveSnapshot();
		if (
			!autoSaveReady ||
			loading ||
			saving ||
			autoSaving ||
			!hasDraftContent() ||
			snapshot === lastSavedSnapshot
		) {
			return;
		}
		scheduleAutoSave(snapshot);
	});

	async function loadInitialData() {
		loading = true;
		autoSaveReady = false;
		error = '';
		try {
			if (initialPublication) {
				publicationContextRequestId = initialPublication.id;
				selectedWorkspaceId = initialPublication.workspace_id;
				await loadSchedulingSettings(selectedWorkspaceId);
				hydrateInitialPublication(initialPublication);
			}
			const { data: capabilityData, error: capError } = await client.GET('/capabilities', {});
			if (capError) throw new Error(capError.detail || m.compose_load_capabilities_failed());
			capabilities = capabilityData?.capabilities ?? [];
			if (selectedWorkspaceId) {
				if (schedulingSettingsWorkspaceId !== selectedWorkspaceId) {
					await loadSchedulingSettings(selectedWorkspaceId);
				}
				await Promise.all([
					loadAccounts(selectedWorkspaceId),
					loadProviderReadiness(selectedWorkspaceId)
				]);
				applyInitialScheduleDate();
				await resolveSelectedCapabilities();
			}
			markAutoSaveBaseline();
		} catch (err) {
			error = err instanceof Error ? err.message : m.compose_load_composer_failed();
		} finally {
			loading = false;
			autoSaveReady = true;
		}
	}

	async function loadInitialPublicationContext(publication: Publication) {
		loading = true;
		autoSaveReady = false;
		selectedWorkspaceId = publication.workspace_id;
		hydratedPublicationId = '';
		resetWorkspaceScopedState();
		fields = {};
		try {
			const settingsReady = await loadSchedulingSettings(publication.workspace_id);
			if (!settingsReady || initialPublication?.id !== publication.id) return;
			hydrateInitialPublication(publication);
			await Promise.all([
				loadAccounts(publication.workspace_id),
				loadProviderReadiness(publication.workspace_id)
			]);
			await resolveSelectedCapabilities();
			markAutoSaveBaseline();
		} catch (err) {
			if (initialPublication?.id === publication.id) {
				error = err instanceof Error ? err.message : m.compose_load_composer_failed();
			}
		} finally {
			loading = false;
			autoSaveReady = true;
		}
	}

	async function loadSchedulingSettings(workspaceId: string): Promise<boolean> {
		await ensureSchedulingWorkspace(workspaceId);
		if (selectedWorkspaceId !== workspaceId) return false;

		schedulingSettings = snapshotFocusedSchedulingSettings(workspaceCtx.settings);
		schedulingSettingsWorkspaceId = workspaceId;
		return true;
	}

	async function ensureSchedulingWorkspace(workspaceId: string) {
		const workspace = workspaceCtx.workspaces.find((candidate) => candidate.id === workspaceId);
		if (!workspace) throw new Error(m.compose_load_workspaces_failed());

		if (workspaceCtx.currentWorkspace?.id !== workspaceId) {
			await workspaceCtx.setWorkspace(workspace);
		} else if (!workspaceCtx.settingsReady) {
			await workspaceCtx.loadSettings(workspaceId);
		}

		if (!workspaceCtx.settingsReady || workspaceCtx.currentWorkspace?.id !== workspaceId) {
			throw new Error(m.compose_load_workspace_settings_failed());
		}
	}

	async function loadAccounts(workspaceId = selectedWorkspaceId): Promise<boolean> {
		if (!workspaceId) return false;
		const requestSequence = ++accountsRequestSequence;
		accountsLoading = true;
		accountsError = '';
		try {
			const { data, error: err } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (err) throw new Error(err.detail || m.compose_load_accounts_failed());
			if (requestSequence !== accountsRequestSequence || selectedWorkspaceId !== workspaceId)
				return false;
			accounts = (data ?? []).filter((account) => account.is_active);
			normalizeSelectedAccounts();
			settingsByAccount = normalizeAllAccountSettings(settingsByAccount);
			return true;
		} catch (err) {
			if (requestSequence === accountsRequestSequence && selectedWorkspaceId === workspaceId) {
				accountsError = err instanceof Error ? err.message : m.compose_load_accounts_failed();
			}
			return false;
		} finally {
			if (requestSequence === accountsRequestSequence && selectedWorkspaceId === workspaceId) {
				accountsLoading = false;
			}
		}
	}

	async function loadProviderReadiness(workspaceId = selectedWorkspaceId) {
		if (!workspaceId) return;
		const requestSequence = ++readinessRequestSequence;
		providerReadiness = [];
		providerReadinessWorkspaceId = '';
		providerReadinessLoading = true;
		providerReadinessError = '';
		try {
			const { data, error: err } = await client.GET('/provider-readiness', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (err) throw new Error(err.detail || m.compose_load_readiness_failed());
			if (requestSequence !== readinessRequestSequence || selectedWorkspaceId !== workspaceId)
				return;
			providerReadiness = data?.providers ?? [];
			providerReadinessWorkspaceId = workspaceId;
		} catch (err) {
			if (requestSequence === readinessRequestSequence && selectedWorkspaceId === workspaceId) {
				providerReadinessError =
					err instanceof Error ? err.message : m.compose_load_readiness_failed();
				error = providerReadinessError;
			}
		} finally {
			if (requestSequence === readinessRequestSequence && selectedWorkspaceId === workspaceId) {
				providerReadinessLoading = false;
			}
		}
	}

	function hydrateInitialPublication(publication: Publication) {
		hydratedPublicationId = publication.id;
		publicationId = publication.id;
		revision = publication.revision;
		selectedWorkspaceId = publication.workspace_id;
		fields = fieldsFromPublication(publication);
		media = (publication.media ?? []).map(mediaSummaryToFocusedMedia);
		segments = (publication.segments ?? []).map((segment) => ({
			id: segment.id,
			content: segment.body,
			title: segment.title,
			description: segment.description,
			url: segment.url,
			media: (segment.media ?? []).map((item) => ({
				id: item.id,
				mimeType: item.mime_type,
				role: item.role,
				altText: item.alt_text,
				settings: item.settings
			})),
			settingsByAccount: {}
		}));
		if (segments.length === 0) {
			segments = emptySegmentsForMode(mode);
			segments[0].content = publication.source_text;
		}
		activeSettingsSegmentId = segments[0].id;
		selectedAccountIds = (publication.renditions ?? []).map(
			(rendition) => rendition.social_account_id
		);
		settingsByAccount = Object.fromEntries(
			(publication.renditions ?? []).map((rendition) => [
				rendition.social_account_id,
				{ ...(rendition.settings ?? {}) }
			])
		);
		for (const rendition of publication.renditions ?? []) {
			const hydratedSegments = new SvelteSet<string>();
			for (const segment of rendition.segments ?? []) {
				const canonical = segments.find((item) => item.id === segment.publication_segment_id);
				if (!canonical) continue;
				if (hydratedSegments.has(canonical.id)) {
					if (segment.body.trim()) {
						canonical.settingsByAccount = {
							...(canonical.settingsByAccount ?? {}),
							[rendition.social_account_id]: {
								...(canonical.settingsByAccount?.[rendition.social_account_id] ?? {}),
								first_comment: segment.body
							}
						};
					}
					continue;
				}
				hydratedSegments.add(canonical.id);
				canonical.settingsByAccount = {
					...(canonical.settingsByAccount ?? {}),
					[rendition.social_account_id]: { ...(segment.settings ?? {}) }
				};
				for (const renditionMedia of segment.media ?? []) {
					const accountMediaSettings = {
						...(renditionMedia.settings ?? {}),
						...(renditionMedia.alt_text ? { alt_text: renditionMedia.alt_text } : {}),
						...(renditionMedia.thumbnail_timestamp_ms
							? { thumbnail_timestamp_ms: renditionMedia.thumbnail_timestamp_ms }
							: {})
					};
					setMediaAccountSettings(
						canonical.media,
						renditionMedia.id,
						rendition.social_account_id,
						accountMediaSettings
					);
					setMediaAccountSettings(
						media,
						renditionMedia.id,
						rendition.social_account_id,
						accountMediaSettings
					);
				}
			}
		}
		thumbnailMediaId = youtubeThumbnailId(publication.renditions ?? []);
		hydrateSchedule(publication.scheduled_at);
	}

	function fieldsFromPublication(publication: Publication): FocusedComposerFields {
		const renditions = publication.renditions ?? [];
		const youtube = renditions.find(
			(rendition) => getPlatformKey(rendition.platform) === 'youtube'
		);
		const social = renditions.find((rendition) => getPlatformKey(rendition.platform) !== 'youtube');
		const base: FocusedComposerFields = {};
		if (publication.source_url) base.linkUrl = publication.source_url;
		if (mode === 'post') {
			base.postText = social?.body || publication.source_text;
			base.linkUrl = publication.source_url;
		}
		if (mode === 'story') {
			base.caption = social?.body || youtube?.body || publication.source_text;
		}
		if (mode === 'short_video' || mode === 'video') {
			base.videoTitle = youtube?.title || publication.title;
			base.videoDescription = youtube?.description || youtube?.body || publication.source_text;
			base.caption = social?.body || '';
		}
		return base;
	}

	function hydrateSchedule(scheduledAt?: string) {
		if (!scheduledAt || scheduledAt === '0001-01-01T00:00:00Z') {
			selectedDate = undefined;
			selectedTime = null;
			return;
		}
		const schedule = workspaceScheduleFromISO(scheduledAt, scheduleTimezoneLabel);
		selectedDate = schedule?.date;
		selectedTime = schedule?.time ?? null;
	}

	async function changeWorkspace(workspaceId: string) {
		const changeSequence = ++workspaceChangeSequence;
		const changedExistingWorkspace = Boolean(selectedWorkspaceId);
		autoSaveReady = false;
		selectedWorkspaceId = workspaceId;
		resetWorkspaceScopedState();
		if (changedExistingWorkspace) success = m.compose_workspace_context_reset();
		try {
			const settingsReady = await loadSchedulingSettings(workspaceId);
			if (
				!settingsReady ||
				changeSequence !== workspaceChangeSequence ||
				selectedWorkspaceId !== workspaceId
			) {
				return;
			}
			await Promise.all([loadAccounts(workspaceId), loadProviderReadiness(workspaceId)]);
			await resolveSelectedCapabilities();
		} catch (err) {
			if (changeSequence === workspaceChangeSequence && selectedWorkspaceId === workspaceId) {
				error = err instanceof Error ? err.message : m.compose_load_workspace_settings_failed();
			}
		} finally {
			if (changeSequence === workspaceChangeSequence && selectedWorkspaceId === workspaceId) {
				loading = false;
				autoSaveReady = true;
				queueAutoSave();
			}
		}
	}

	function resetWorkspaceScopedState() {
		clearAutoSaveTimer();
		saveGeneration += 1;
		lastSavedSnapshot = '';
		accountsRequestSequence += 1;
		readinessRequestSequence += 1;
		destinationOptionsRequestSequence += 1;
		nextSlotRequestSequence += 1;
		publicationId = '';
		accounts = [];
		selectedAccountIds = [];
		providerReadiness = [];
		providerReadinessWorkspaceId = '';
		providerReadinessLoading = false;
		providerReadinessError = '';
		settingsDialogOpen = false;
		settingsAccountId = '';
		destinationOptionsByAccount = {};
		destinationOptionsErrors = {};
		destinationOptionsLoadingAccountId = '';
		media = [];
		thumbnailMedia = null;
		thumbnailMediaId = '';
		settingsByAccount = {};
		segmentSettingsByAccount = {};
		segments = emptySegmentsForMode(mode);
		activeSettingsSegmentId = 'segment-1';
		resolvedCapabilities = {};
		capabilityResolveLoading = false;
		capabilityResolveError = '';
		capabilityResolveRequestSequence += 1;
		selectedDate = undefined;
		selectedTime = null;
		showScheduleDialog = false;
		validationIssues = [];
		schedulingSettings = defaultFocusedSchedulingSettings();
		schedulingSettingsWorkspaceId = '';
		accountsLoading = false;
		accountsError = '';
		uploading = false;
		autoSaving = false;
		suggestingSlot = false;
		scheduleError = '';
		error = '';
		success = '';
	}

	async function retryAccounts() {
		const loaded = await loadAccounts();
		if (loaded) await resolveSelectedCapabilities();
	}

	function selectAllAccounts() {
		selectedAccountIds = compatibleAccounts.map((account) => account.id);
		settingsByAccount = normalizeAllAccountSettings(settingsByAccount);
		validationIssues = [];
		void resolveSelectedCapabilities();
	}

	function clearAllAccounts() {
		selectedAccountIds = [];
		settingsDialogOpen = false;
		settingsAccountId = '';
		validationIssues = [];
		resolvedCapabilities = {};
	}

	function normalizeSelectedAccounts() {
		const compatible = accounts.filter(isAccountCompatible).map((account) => account.id);
		const preserved = selectedAccountIds.filter((id) => compatible.includes(id));
		if (preserved.length > 0) {
			selectedAccountIds = preserved;
		} else if (!initialPublication || selectedAccountIds.length === 0) {
			selectedAccountIds = compatible;
		} else {
			selectedAccountIds = [];
		}
		if (settingsAccountId && !selectedAccountIds.includes(settingsAccountId)) {
			settingsDialogOpen = false;
			settingsAccountId = '';
		}
	}

	function toggleAccount(account: SocialAccount) {
		if (!isAccountCompatible(account)) return;
		selectedAccountIds = selectedAccountIds.includes(account.id)
			? selectedAccountIds.filter((id) => id !== account.id)
			: [...selectedAccountIds, account.id];
		if (!selectedAccountIds.includes(account.id) && settingsAccountId === account.id) {
			settingsDialogOpen = false;
			settingsAccountId = '';
		}
		settingsByAccount = normalizeAllAccountSettings(settingsByAccount);
		validationIssues = [];
		void resolveSelectedCapabilities();
	}

	function isAccountCompatible(account: SocialAccount): boolean {
		return isAccountCompatibleWithMode(mode, account, capabilities);
	}

	function capabilityForAccount(
		account: SocialAccount
	): Capability | ResolvedAccountCapability | null {
		if (resolvedCapabilities[account.id]) return resolvedCapabilities[account.id];
		const provider = getPlatformKey(account.platform);
		return (
			capabilities.find(
				(capability) =>
					capability.provider === provider && (capability.intents ?? []).includes(mode)
			) ?? null
		);
	}

	function readinessForAccount(account: SocialAccount): ProviderReadinessItem | null {
		const provider = getPlatformKey(account.platform);
		return providerReadiness.find((item) => item.provider === provider) ?? null;
	}

	function readinessBlockers(account: SocialAccount): string[] {
		return readinessForAccount(account)?.blocking_issues ?? [];
	}

	function accountBlockerText(account: SocialAccount): string {
		return readinessBlockers(account)
			.map((item) => item.replaceAll('_', ' '))
			.join(', ');
	}

	async function resolveSelectedCapabilities(): Promise<boolean> {
		const accountIds = selectedAccountIds;
		if (!selectedWorkspaceId || accountIds.length === 0) {
			resolvedCapabilities = {};
			capabilityResolveError = '';
			return true;
		}
		const requestSequence = ++capabilityResolveRequestSequence;
		capabilityResolveLoading = true;
		capabilityResolveError = '';
		const [, localeRegion = 'US'] = getLocaleTag().split('-');
		try {
			const { data, error: resolveError } = await client.POST('/capabilities/resolve', {
				body: {
					account_ids: accountIds,
					intent: mode,
					source_url: fields.linkUrl ?? '',
					locale: getLocaleTag(),
					region: localeRegion,
					account_settings: Object.fromEntries(
						selectedAccounts.map((account) => [account.id, settingsForAccount(account)])
					),
					segments: composerSegments().map((segment) => ({
						id: segment.id,
						content: segment.content,
						title: segment.title ?? '',
						description: segment.description ?? '',
						url: segment.url ?? '',
						media: segment.media.map((item) => ({ media_id: item.id }))
					}))
				}
			});
			if (resolveError) {
				throw new Error(resolveError.detail || m.compose_load_capabilities_failed());
			}
			if (requestSequence !== capabilityResolveRequestSequence) return false;
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
								(options ?? []).map((option) => ({ value: option.value, label: option.label }))
							])
						)
					}
				};
			}
			validationIssues = (data?.accounts ?? []).flatMap((capability) => capability.issues ?? []);
			settingsByAccount = normalizeAllAccountSettings(settingsByAccount);
			return (data?.accounts ?? []).every((capability) => capability.compatible);
		} catch (resolveError) {
			if (requestSequence !== capabilityResolveRequestSequence) return false;
			capabilityResolveError =
				resolveError instanceof Error ? resolveError.message : m.compose_load_capabilities_failed();
			return false;
		} finally {
			if (requestSequence === capabilityResolveRequestSequence) {
				capabilityResolveLoading = false;
			}
		}
	}

	function composerSegments(): FocusedSegmentInput[] {
		if (mode === 'thread') {
			return segments.map((segment, index) => ({
				...segment,
				media: index === 0 && segment.media.length === 0 ? focusedMediaInputs(media) : segment.media
			}));
		}
		return [
			{
				id: segments[0]?.id || 'segment-1',
				content: firstFocusedValue(fields.postText, fields.caption, fields.videoDescription),
				title: fields.videoTitle,
				description: fields.videoDescription,
				url: fields.linkUrl,
				media: focusedMediaInputs(media),
				settingsByAccount: segmentSettingsByAccount
			}
		];
	}

	function focusedMediaInputs(items: FocusedMedia[]) {
		return items.map((item) => ({
			id: item.id,
			mimeType: item.mime_type,
			role: item.role,
			altText: item.altText,
			settings: item.settings,
			settingsByAccount: item.settingsByAccount
		}));
	}

	function firstFocusedValue(...values: Array<string | undefined>): string {
		return values.find((value) => value?.trim())?.trim() ?? '';
	}

	function updateField(key: FocusedFieldKey, value: string) {
		fields = { ...fields, [key]: value };
		validationIssues = [];
		queueAutoSave();
	}

	function updateThreadSegment(segmentId: string, content: string) {
		segments = segments.map((segment) =>
			segment.id === segmentId ? { ...segment, content } : segment
		);
		validationIssues = [];
		queueAutoSave();
	}

	function addThreadSegment() {
		const id = `segment-${Date.now()}-${segments.length + 1}`;
		segments = [...segments, { id, content: '', media: [], settingsByAccount: {} }];
		activeSettingsSegmentId = id;
		validationIssues = [];
		queueAutoSave();
	}

	function removeThreadSegment(segmentId: string) {
		if (segments.length <= 2) return;
		segments = segments.filter((segment) => segment.id !== segmentId);
		if (activeSettingsSegmentId === segmentId) {
			activeSettingsSegmentId = segments[0].id;
		}
		validationIssues = [];
		void resolveSelectedCapabilities();
		queueAutoSave();
	}

	function updateMediaAltText(mediaId: string, altText: string) {
		media = media.map((item) => (item.id === mediaId ? { ...item, altText } : item));
		validationIssues = [];
		queueAutoSave();
	}

	function fieldValue(key: FocusedFieldKey): string {
		return fields[key] ?? '';
	}

	function focusedMediaFromLibrary(item: StudioMediaItem): FocusedMedia {
		return {
			id: item.id,
			mime_type: item.mime_type,
			url: item.url,
			size: item.size,
			filename: item.original_filename || item.id,
			altText: item.alt_text
		};
	}

	function setFocusedMediaSelection(ids: string[], items: StudioMediaItem[]) {
		const libraryByID = new Map(items.map((item) => [item.id, item]));
		const existingByID = new Map(media.map((item) => [item.id, item]));
		media = ids.slice(0, composerMediaLimit).map((id) => {
			const libraryItem = libraryByID.get(id);
			return (
				existingByID.get(id) ??
				(libraryItem
					? focusedMediaFromLibrary(libraryItem)
					: {
							id,
							mime_type: 'image/png',
							url: getAuthenticatedMediaByID(id),
							filename: id
						})
			);
		});
		validationIssues = [];
		void resolveSelectedCapabilities();
		queueAutoSave();
	}

	function openFocusedMediaPicker(purpose: 'media' | 'thumbnail') {
		mediaPickerPurpose = purpose;
		mediaPickerOpen = true;
	}

	async function applyFocusedMediaPicker(ids: string[], items: StudioMediaItem[]) {
		if (mediaPickerPurpose === 'thumbnail') {
			const id = ids[0] ?? '';
			const item = items.find((candidate) => candidate.id === id);
			thumbnailMediaId = id;
			thumbnailMedia = item ? { ...focusedMediaFromLibrary(item), role: 'thumbnail' } : null;
			validationIssues = [];
			queueAutoSave();
			return;
		}
		setFocusedMediaSelection(ids, items);
	}

	async function uploadFocusedFiles(files: File[]) {
		if (!selectedWorkspaceId || uploading) return;
		const available = Math.max(0, composerMediaLimit - media.length);
		const selected = files
			.filter(
				(file) =>
					isSupportedMediaFile(file) &&
					(mode === 'post' || file.type.startsWith('image/') || file.type.startsWith('video/'))
			)
			.slice(0, available);
		if (selected.length === 0) return;
		uploading = true;
		error = '';
		try {
			const uploaded: FocusedMedia[] = [];
			for (const file of selected) {
				const item = await uploadMediaFile({ workspaceId: selectedWorkspaceId, file });
				uploaded.push({
					id: item.id,
					mime_type: item.mime_type,
					url: item.url,
					size: item.size,
					filename: item.original_filename || file.name,
					altText: item.alt_text
				});
			}
			media = [...media, ...uploaded].slice(0, composerMediaLimit);
			validationIssues = [];
			await resolveSelectedCapabilities();
			queueAutoSave();
		} catch (uploadError) {
			error = uploadError instanceof Error ? uploadError.message : m.compose_upload_failed();
		} finally {
			uploading = false;
			draggingMedia = false;
		}
	}

	async function openStudioFromFocusedComposer() {
		if (!selectedWorkspaceId) return;
		mediaPickerOpen = false;
		clearAutoSaveTimer();
		if (hasDraftContent()) {
			await persistPublication();
			lastSavedSnapshot = saveSnapshot();
		}

		const returnURL = new URL(
			publicationId
				? resolve(`/publications/${encodeURIComponent(publicationId)}` as '/')
				: $page.url,
			$page.url
		);
		returnURL.searchParams.delete('studio_return');
		const maxSelection = mediaPickerPurpose === 'thumbnail' ? 1 : composerMediaLimit;
		const purpose = mediaPickerPurpose === 'thumbnail' ? 'thumbnail' : 'post_media';
		const token = await createStudioReturnToken({
			workspace_id: selectedWorkspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose,
			max_selection: maxSelection,
			constraints: {
				max_count: maxSelection,
				allowed_mimes: ['image/png', 'image/jpeg', 'image/webp'],
				composer_mode: mode
			}
		});
		const snapshot: ComposerRecoverySnapshot = {
			version: 1,
			workspace_id: selectedWorkspaceId,
			return_url: `${returnURL.pathname}${returnURL.search}`,
			purpose,
			created_at: new Date().toISOString(),
			expires_at: token.expires_at,
			payload: {
				mode,
				publication_id: publicationId,
				selected_workspace_id: selectedWorkspaceId,
				selected_account_ids: [...selectedAccountIds],
				fields: $state.snapshot(fields),
				media: $state.snapshot(media),
				segments: $state.snapshot(segments),
				active_settings_segment_id: activeSettingsSegmentId,
				thumbnail_media: $state.snapshot(thumbnailMedia),
				thumbnail_media_id: thumbnailMediaId,
				settings_by_account: $state.snapshot(settingsByAccount),
				segment_settings_by_account: $state.snapshot(segmentSettingsByAccount),
				selected_date: selectedDate?.toString(),
				selected_time: selectedTime,
				picker_purpose: mediaPickerPurpose
			} satisfies FocusedStudioSnapshotPayload
		};
		storeComposerRecovery(token.token, snapshot);
		await goto(
			resolve(
				`/studio/new?workspace=${encodeURIComponent(selectedWorkspaceId)}&return_token=${encodeURIComponent(token.token)}` as '/'
			)
		);
	}

	async function restoreStudioReturn() {
		if (!$page?.url) return;
		const token = $page.url.searchParams.get('studio_return');
		if (!token) return;
		const cleanURL = new URL($page.url);
		cleanURL.searchParams.delete('studio_return');
		replaceState(resolve(`${cleanURL.pathname}${cleanURL.search}` as '/'), {});
		try {
			const snapshot = loadComposerRecovery(token);
			const result = await consumeStudioReturnToken(token);
			let purpose: 'media' | 'thumbnail' = result.purpose === 'thumbnail' ? 'thumbnail' : 'media';
			if (snapshot?.workspace_id === result.workspace_id) {
				const payload = snapshot.payload as FocusedStudioSnapshotPayload;
				publicationId = payload.publication_id;
				selectedWorkspaceId = payload.selected_workspace_id;
				selectedAccountIds = [...payload.selected_account_ids];
				fields = structuredClone(payload.fields);
				media = structuredClone(payload.media);
				segments = structuredClone(payload.segments);
				activeSettingsSegmentId = payload.active_settings_segment_id;
				thumbnailMedia = structuredClone(payload.thumbnail_media);
				thumbnailMediaId = payload.thumbnail_media_id;
				settingsByAccount = structuredClone(payload.settings_by_account);
				segmentSettingsByAccount = structuredClone(payload.segment_settings_by_account);
				purpose = payload.picker_purpose;
				if (payload.selected_date) {
					const [year, month, day] = payload.selected_date.split('-').map(Number);
					selectedDate = new CalendarDate(year, month, day);
				}
				selectedTime = payload.selected_time;
			}

			if (purpose === 'thumbnail') {
				thumbnailMediaId = result.media_ids[0] ?? thumbnailMediaId;
				if (result.media_ids[0]) {
					thumbnailMedia = {
						id: result.media_ids[0],
						mime_type: 'image/png',
						url: getAuthenticatedMediaByID(result.media_ids[0]),
						filename: result.media_ids[0],
						role: 'thumbnail'
					};
				}
			} else {
				setFocusedMediaSelection([...media.map((item) => item.id), ...result.media_ids], []);
			}
			await resolveSelectedCapabilities();
			const autosaveSnapshot = saveSnapshot();
			await saveDraftAutomatically(autosaveSnapshot);
			clearComposerRecovery(token);
			success = `${result.media_ids.length} Studio ${result.media_ids.length === 1 ? 'export' : 'exports'} added.`;
		} catch (cause) {
			error =
				cause instanceof Error
					? `${cause.message} Your Studio exports are still available in Media.`
					: 'Studio exports are still available in Media.';
		}
	}

	async function handleDestinationFile(setting: SettingDefinition, file: File) {
		const account = settingsAccount;
		if (!account || !selectedWorkspaceId) return;
		uploading = true;
		error = '';
		try {
			const uploaded = await uploadMediaFile({ workspaceId: selectedWorkspaceId, file });
			updateAccountSetting(account, setting.key, uploaded.id);
		} catch (uploadError) {
			error = uploadError instanceof Error ? uploadError.message : m.compose_upload_failed();
		} finally {
			uploading = false;
		}
	}

	function requestDeleteDestination(account: SocialAccount) {
		settingsDialogOpen = false;
		deleteDestinationAccount = account;
		deleteDestinationDialogOpen = true;
	}

	async function confirmDeleteDestination() {
		const account = deleteDestinationAccount;
		if (!account || !publicationId) return;
		const { data, error: deleteError } = await client.DELETE(
			'/publications/{id}/renditions/{account_id}',
			{
				params: {
					path: { id: publicationId, account_id: account.id },
					query: { confirm: true, expected_revision: revision }
				}
			}
		);
		if (deleteError) {
			const conflict = parseDraftConflict(deleteError);
			if (conflict) {
				draftConflict = conflict;
				conflictDialogOpen = true;
			}
			throw new Error(deleteError.detail || m.compose_save_outputs_failed());
		}
		if (data?.revision) revision = data.revision;
		selectedAccountIds = selectedAccountIds.filter((id) => id !== account.id);
		const nextSettings = { ...settingsByAccount };
		delete nextSettings[account.id];
		settingsByAccount = nextSettings;
		const nextResolved = { ...resolvedCapabilities };
		delete nextResolved[account.id];
		resolvedCapabilities = nextResolved;
		deleteDestinationAccount = null;
		success = m.compose_delete_destination();
		ui.triggerRefresh();
	}

	async function deletePublication() {
		if (!publicationId || deletingPublication) return;
		clearAutoSaveTimer();
		deletingPublication = true;
		error = '';
		try {
			const { error: deleteError } = await client.DELETE('/publications/{id}', {
				params: {
					path: { id: publicationId },
					query: { confirm: true, expected_revision: revision }
				}
			});
			if (deleteError) {
				const conflict = parseDraftConflict(deleteError);
				if (conflict) {
					draftConflict = conflict;
					conflictDialogOpen = true;
				}
				throw new Error(deleteError.detail || m.compose_delete_post_failed());
			}
			publicationId = '';
			lastSavedSnapshot = '';
			deletePublicationDialogOpen = false;
			ui.clearActiveComposerDraft();
			ui.triggerRefresh();
			onSuccess?.();
		} catch (deleteError) {
			error = deleteError instanceof Error ? deleteError.message : m.compose_delete_post_failed();
		} finally {
			deletingPublication = false;
		}
	}

	function removeMedia(mediaId: string) {
		media = media.filter((item) => item.id !== mediaId);
		validationIssues = [];
		void resolveSelectedCapabilities();
	}

	function clearThumbnail() {
		thumbnailMedia = null;
		thumbnailMediaId = '';
		validationIssues = [];
	}

	function getScheduledAt(): string | undefined {
		if (!selectedWorkspaceSettingsReady || !selectedDate || !selectedTime) return undefined;
		return workspaceScheduleToISO(selectedDate, selectedTime, scheduleTimezoneLabel);
	}

	function scheduleLabel(): string {
		if (!selectedDate || !selectedTime) return m.compose_schedule();
		const date = selectedDate.toDate(scheduleTimezoneLabel);
		return `${date.toLocaleDateString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			timeZone: scheduleTimezoneLabel
		})} ${selectedTime}`;
	}

	function clearSchedule() {
		selectedDate = undefined;
		selectedTime = null;
		scheduleError = '';
	}

	function applyInitialScheduleDate() {
		if (selectedDate || !initialScheduleDate) return;
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(initialScheduleDate);
		if (!match) return;
		const requestedDate = new CalendarDate(Number(match[1]), Number(match[2]), Number(match[3]));
		if (requestedDate.compare(workspaceClock(scheduleTimezoneLabel).date) < 0) {
			error = m.compose_schedule_future();
			return;
		}
		selectedDate = requestedDate;
	}

	async function fillNextSlot(showComposerError = false): Promise<boolean> {
		if (!selectedWorkspaceId || !selectedWorkspaceSettingsReady) {
			if (showComposerError) {
				error = m.compose_load_workspace_settings_failed();
				success = '';
			}
			return false;
		}
		const requestSequence = ++nextSlotRequestSequence;
		const workspaceId = selectedWorkspaceId;
		const timezone = scheduleTimezoneLabel;
		suggestingSlot = true;
		scheduleError = '';
		try {
			const { data, error: nextSlotError } = await client.GET('/posting-schedules/next-slot', {
				params: { query: { workspace_id: workspaceId } }
			});
			if (
				requestSequence !== nextSlotRequestSequence ||
				selectedWorkspaceId !== workspaceId ||
				scheduleTimezoneLabel !== timezone
			) {
				return false;
			}
			if (nextSlotError) {
				throw new Error(nextSlotError.detail || m.compose_next_free_slot_failed());
			}
			const schedule = data?.slot_time
				? workspaceScheduleFromISO(data.slot_time, scheduleTimezoneLabel)
				: null;
			if (!schedule) {
				scheduleError = m.compose_no_free_slot();
				if (showComposerError) {
					error = scheduleError;
					success = '';
				}
				return false;
			}
			selectedDate = schedule.date;
			selectedTime = schedule.time;
			return true;
		} catch (nextSlotError) {
			if (requestSequence !== nextSlotRequestSequence || selectedWorkspaceId !== workspaceId) {
				return false;
			}
			scheduleError =
				nextSlotError instanceof Error ? nextSlotError.message : m.compose_next_free_slot_failed();
			if (showComposerError) {
				error = scheduleError;
				success = '';
			}
		} finally {
			if (requestSequence === nextSlotRequestSequence && selectedWorkspaceId === workspaceId) {
				suggestingSlot = false;
			}
		}
		return false;
	}

	async function suggestNextSlot() {
		await fillNextSlot(false);
	}

	async function quickSchedule() {
		if (selectedDate && selectedTime) {
			showScheduleDialog = false;
			await runAction('schedule');
			return;
		}

		const didApplySlot = await fillNextSlot(true);
		if (!didApplySlot) return;
		showScheduleDialog = false;
		await runAction('schedule');
	}

	function formBlockers(): string[] {
		const blockers: string[] = [];
		if (!selectedWorkspaceId) blockers.push(m.compose_choose_workspace_blocker());
		if (selectedAccounts.length === 0) blockers.push(m.compose_choose_account_blocker());
		if (capabilityResolveError) blockers.push(capabilityResolveError);
		if (mode === 'thread') {
			if (segments.length < 2) blockers.push(m.compose_thread_minimum());
			for (const [index, segment] of segments.entries()) {
				if (
					!segment.content.trim() &&
					segment.media.length === 0 &&
					!(index === 0 && media.length > 0)
				) {
					blockers.push(m.compose_thread_post_required({ number: index + 1 }));
				}
			}
		}
		for (const field of roleFields) {
			if (field.required && !fieldValue(field.key).trim()) {
				blockers.push(m.compose_field_required({ field: field.label }));
			}
		}
		return blockers;
	}

	function accountBlockers(account: SocialAccount, includeShared = true): string[] {
		const blockers: string[] = [];
		const resolved = resolvedCapabilities[account.id];
		for (const issue of resolved?.issues ?? []) {
			if (issue.severity === 'error' && (includeShared || isAccountSpecificIssue(issue))) {
				blockers.push(issue.message);
			}
		}
		for (const issue of validationIssues) {
			if (
				issue.severity === 'error' &&
				(includeShared || isAccountSpecificIssue(issue)) &&
				issueMatchesProvider(issue, getPlatformKey(account.platform))
			) {
				blockers.push(issue.message);
			}
		}
		const mediaMin = resolved?.media.min_count ?? 0;
		if (includeShared && mediaMin > 0 && media.length < mediaMin) {
			blockers.push(
				mediaMin === 1
					? m.compose_add_media_singular()
					: m.compose_add_media_plural({ count: mediaMin })
			);
		}
		for (const setting of visibleSettings(account)) {
			if (!setting.required) continue;
			if (setting.scope === 'media_item') {
				for (const item of mediaForSettingsDialog()) {
					const values = item.settingsByAccount?.[account.id] ?? {};
					if (!settingDependenciesMet(setting, values)) continue;
					const value = values[setting.key];
					if (requiredSettingMissing(setting, value)) {
						blockers.push(
							m.compose_destination_setting_required({
								setting: setting.label,
								platform: getPlatformName(account.platform)
							})
						);
					}
				}
				continue;
			}
			const values =
				setting.scope === 'segment'
					? segmentSettingsForAccount(account)
					: settingsForAccount(account);
			if (!settingDependenciesMet(setting, values)) continue;
			if (requiredSettingMissing(setting, values[setting.key])) {
				blockers.push(
					m.compose_destination_setting_required({
						setting: setting.label,
						platform: getPlatformName(account.platform)
					})
				);
			}
		}
		if (readinessBlockers(account).length > 0) {
			blockers.push(
				m.compose_provider_blocked({
					platform: getPlatformName(account.platform),
					reason: accountBlockerText(account)
				})
			);
		}
		return uniqueIssueMessages(blockers);
	}

	function accountIssueMessages(account: SocialAccount): string[] {
		const provider = getPlatformKey(account.platform);
		return uniqueIssueMessages([
			...accountBlockers(account, false),
			...(resolvedCapabilities[account.id]?.issues ?? [])
				.filter((issue) => isAccountSpecificIssue(issue) && isActionableAccountIssue(issue))
				.map((issue) => issue.message),
			...validationIssues
				.filter((issue) => isAccountSpecificIssue(issue) && issueMatchesProvider(issue, provider))
				.map((issue) => issue.message)
		]);
	}

	function requiredSettingMissing(setting: SettingDefinition, value: unknown): boolean {
		return (
			value === undefined ||
			value === null ||
			String(value).trim() === '' ||
			(setting.type === 'boolean' && value !== true)
		);
	}

	function normalizeAllAccountSettings(
		current: Record<string, Record<string, unknown>>
	): Record<string, Record<string, unknown>> {
		const next = { ...current };
		for (const account of selectedAccounts) {
			next[account.id] = normalizeSettings(account, next[account.id] ?? {});
		}
		return next;
	}

	function normalizeSettings(
		account: SocialAccount,
		current: Record<string, unknown>
	): Record<string, unknown> {
		const next = { ...current };
		for (const field of capabilityForAccount(account)?.settings ?? []) {
			if (field.scope !== 'destination') continue;
			if (next[field.key] !== undefined) continue;
			if (field.default !== undefined) next[field.key] = field.default;
			else if (field.type === 'boolean') next[field.key] = false;
			else next[field.key] = '';
		}
		return next;
	}

	function settingsForAccount(account: SocialAccount): Record<string, unknown> {
		return normalizeSettings(account, settingsByAccount[account.id] ?? {});
	}

	function dialogSettingsForAccount(account: SocialAccount): Record<string, unknown> {
		return {
			...settingsForAccount(account),
			...segmentSettingsForAccount(account)
		};
	}

	function segmentSettingsForAccount(account: SocialAccount): Record<string, unknown> {
		if (mode !== 'thread') return segmentSettingsByAccount[account.id] ?? {};
		const segment = segments.find((item) => item.id === activeSettingsSegmentId) ?? segments[0];
		return segment?.settingsByAccount?.[account.id] ?? {};
	}

	function updateAccountSetting(account: SocialAccount, key: string, value: unknown) {
		const definition = visibleSettings(account).find((field) => field.key === key);
		if (definition?.scope === 'segment') {
			if (mode !== 'thread') {
				segmentSettingsByAccount = {
					...segmentSettingsByAccount,
					[account.id]: {
						...(segmentSettingsByAccount[account.id] ?? {}),
						[key]: value
					}
				};
			} else {
				const segmentIndex = Math.max(
					0,
					segments.findIndex((segment) => segment.id === activeSettingsSegmentId)
				);
				const segment = segments[segmentIndex];
				segments = segments.map((item, index) =>
					index === segmentIndex
						? {
								...item,
								settingsByAccount: {
									...(item.settingsByAccount ?? {}),
									[account.id]: {
										...(segment.settingsByAccount?.[account.id] ?? {}),
										[key]: value
									}
								}
							}
						: item
				);
			}
			validationIssues = [];
			return;
		}
		const current = settingsForAccount(account);
		settingsByAccount = {
			...settingsByAccount,
			[account.id]: { ...current, [key]: value }
		};
		validationIssues = [];
		if (key === 'content_posting_method') {
			void resolveSelectedCapabilities();
		}
	}

	function visibleSettings(account: SocialAccount): SettingDefinition[] {
		const provider = getPlatformKey(account.platform);
		return (capabilityForAccount(account)?.settings ?? []).filter((field) => {
			if (
				provider === 'youtube' &&
				['title', 'description', 'thumbnail_media_id'].includes(field.key)
			) {
				return false;
			}
			if (
				mode === 'post' &&
				['url', 'link_url', 'link_title', 'link_description'].includes(field.key) &&
				!fields.linkUrl?.trim() &&
				!field.required
			)
				return false;
			return true;
		});
	}

	function settingDependenciesMet(
		setting: SettingDefinition,
		values: Record<string, unknown>
	): boolean {
		return (setting.dependencies ?? []).every((condition) => {
			const value = values[condition.key];
			const present = value !== undefined && value !== null && String(value).trim() !== '';
			switch (condition.operator) {
				case 'present':
					return present;
				case 'absent':
					return !present;
				case 'equals':
					return present && String(value) === String(condition.value);
				case 'not_equals':
					return !present || String(value) !== String(condition.value);
				case 'in':
					return Array.isArray(condition.value) && condition.value.includes(value);
			}
		});
	}

	function mediaForSettingsDialog(): FocusedMediaInput[] {
		if (mode !== 'thread') return focusedMediaInputs(media);
		const segment = segments.find((item) => item.id === activeSettingsSegmentId) ?? segments[0];
		return segment?.media.length ? segment.media : focusedMediaInputs(media);
	}

	function mediaSettingsForDialog(account: SocialAccount): Record<string, Record<string, unknown>> {
		return Object.fromEntries(
			mediaForSettingsDialog().map((item) => [
				item.id,
				{ ...(item.settingsByAccount?.[account.id] ?? {}) }
			])
		);
	}

	function updateMediaAccountSetting(
		account: SocialAccount,
		mediaId: string,
		key: string,
		value: unknown
	) {
		media = media.map((item) =>
			item.id === mediaId
				? {
						...item,
						settingsByAccount: {
							...(item.settingsByAccount ?? {}),
							[account.id]: {
								...(item.settingsByAccount?.[account.id] ?? {}),
								[key]: value
							}
						}
					}
				: item
		);
		segments = segments.map((segment) => ({
			...segment,
			media: segment.media.map((item) =>
				item.id === mediaId
					? {
							...item,
							settingsByAccount: {
								...(item.settingsByAccount ?? {}),
								[account.id]: {
									...(item.settingsByAccount?.[account.id] ?? {}),
									[key]: value
								}
							}
						}
					: item
			)
		}));
		validationIssues = [];
	}

	function setMediaAccountSettings(
		items: Array<FocusedMedia | FocusedMediaInput>,
		mediaId: string,
		accountId: string,
		settings: Record<string, unknown>
	) {
		const item = items.find((candidate) => candidate.id === mediaId);
		if (!item) return;
		item.settingsByAccount = {
			...(item.settingsByAccount ?? {}),
			[accountId]: settings
		};
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
		let optionSources = loadableDestinationOptionSources(visibleSettings(account), onlySource);
		if (optionSources.length === 0) return;
		if (!force && !search) {
			optionSources = optionSources.filter(
				(source) => destinationOptionsByAccount[account.id]?.[source] === undefined
			);
			if (optionSources.length === 0) return;
		}

		const requestSequence = ++destinationOptionsRequestSequence;
		destinationOptionsLoadingAccountId = account.id;
		destinationOptionsErrors = { ...destinationOptionsErrors, [account.id]: '' };
		const [, regionCode = 'US'] = getLocaleTag().split('-');
		try {
			const results = await Promise.all(
				optionSources.map(async (source) => {
					const { data, error: loadError } = await client.GET(
						'/accounts/{account_id}/publishing-options/{source}',
						{
							params: {
								path: { account_id: account.id, source },
								query: {
									region: regionCode,
									locale: getLocaleTag(),
									limit: 100,
									search
								}
							}
						}
					);
					if (loadError) {
						throw new Error(loadError.detail || m.compose_load_provider_options_failed());
					}
					return [source, data?.options ?? []] as const;
				})
			);
			if (requestSequence !== destinationOptionsRequestSequence) return;

			const optionGroups: Record<string, DestinationOption[]> = {
				...(destinationOptionsByAccount[account.id] ?? {})
			};
			for (const [source, options] of results) optionGroups[source] = options;
			destinationOptionsByAccount = {
				...destinationOptionsByAccount,
				[account.id]: optionGroups
			};
		} catch (loadError) {
			if (requestSequence !== destinationOptionsRequestSequence) return;
			destinationOptionsErrors = {
				...destinationOptionsErrors,
				[account.id]:
					loadError instanceof Error ? loadError.message : m.compose_load_provider_options_failed()
			};
		} finally {
			if (
				requestSequence === destinationOptionsRequestSequence &&
				destinationOptionsLoadingAccountId === account.id
			) {
				destinationOptionsLoadingAccountId = '';
			}
		}
	}

	function selectedSettingsInput(): Record<string, Record<string, unknown>> {
		return Object.fromEntries(
			selectedAccounts.map((account) => [account.id, settingsForAccount(account)])
		);
	}

	function publicationPayload() {
		return buildFocusedPublicationPayload({
			mode,
			workspaceId: selectedWorkspaceId,
			accounts: selectedAccounts.map((account) => ({
				id: account.id,
				platform: account.platform,
				account_username: account.account_username
			})),
			fields,
			media: focusedMediaInputs(media),
			segments: composerSegments(),
			scheduledAt: getScheduledAt(),
			thumbnailMediaId,
			settingsByAccount: selectedSettingsInput(),
			resolvedByAccount: Object.fromEntries(
				Object.entries(resolvedCapabilities).map(([accountId, capability]) => [
					accountId,
					{
						profile: capability.profile,
						outputProfile: capability.output_profile,
						revision: capability.capability_revision,
						compatible: capability.compatible
					} satisfies ResolvedComposerTarget
				])
			)
		});
	}

	function hasDraftContent(): boolean {
		return (
			media.length > 0 ||
			Boolean(thumbnailMediaId) ||
			Object.values(fields).some((value) => value?.trim()) ||
			segments.some(
				(segment) =>
					segment.content.trim() ||
					segment.title?.trim() ||
					segment.description?.trim() ||
					segment.url?.trim() ||
					segment.media.length > 0
			)
		);
	}

	function saveSnapshot(): string {
		return JSON.stringify(publicationPayload());
	}

	function markAutoSaveBaseline() {
		clearAutoSaveTimer();
		lastSavedSnapshot = saveSnapshot();
	}

	function clearAutoSaveTimer() {
		if (!autoSaveTimer) return;
		clearTimeout(autoSaveTimer);
		autoSaveTimer = null;
	}

	function scheduleAutoSave(snapshot: string) {
		clearAutoSaveTimer();
		autoSaveTimer = setTimeout(() => {
			autoSaveTimer = null;
			if (saveSnapshot() !== snapshot) return;
			void saveDraftAutomatically(snapshot);
		}, 2000);
	}

	function queueAutoSave() {
		if (!autoSaveReady || loading || saving || autoSaving || !hasDraftContent()) return;
		const snapshot = saveSnapshot();
		if (snapshot !== lastSavedSnapshot) scheduleAutoSave(snapshot);
	}

	async function saveDraftAutomatically(snapshot: string) {
		if (
			!selectedWorkspaceId ||
			!hasDraftContent() ||
			saving ||
			autoSaving ||
			snapshot === lastSavedSnapshot
		) {
			return;
		}
		const generation = saveGeneration;
		const workspaceId = selectedWorkspaceId;
		const startingPublicationId = publicationId;
		autoSaving = true;
		try {
			await persistPublication({ generation, workspaceId, startingPublicationId });
			if (
				generation !== saveGeneration ||
				selectedWorkspaceId !== workspaceId ||
				(startingPublicationId && publicationId !== startingPublicationId)
			) {
				return;
			}
			lastSavedSnapshot = snapshot;
			ui.triggerRefresh();
		} catch (saveError) {
			if (generation === saveGeneration && selectedWorkspaceId === workspaceId) {
				error =
					saveError instanceof Error ? saveError.message : m.compose_save_publication_failed();
			}
		} finally {
			if (generation === saveGeneration && selectedWorkspaceId === workspaceId) {
				autoSaving = false;
			}
		}
	}

	async function persistPublication(
		context?: {
			generation: number;
			workspaceId: string;
			startingPublicationId: string;
		},
		options: {
			force?: boolean;
			saveAsCopy?: boolean;
		} = {}
	): Promise<string> {
		return saveQueue.run(() => persistPublicationNow(context, options));
	}

	async function persistPublicationNow(
		context?: {
			generation: number;
			workspaceId: string;
			startingPublicationId: string;
		},
		options: {
			force?: boolean;
			saveAsCopy?: boolean;
		} = {}
	): Promise<string> {
		const payload = publicationPayload();
		const targetPublicationId = options.saveAsCopy
			? ''
			: context?.startingPublicationId || publicationId;
		if (targetPublicationId) {
			const { data, error: updateError } = await client.PUT('/publications/{id}', {
				params: { path: { id: targetPublicationId } },
				body: {
					expected_revision: revision,
					force: Boolean(options.force),
					title: payload.title,
					intent: payload.intent,
					content_profile: payload.content_profile,
					source_text: payload.source_text,
					source_url: payload.source_url ?? '',
					...(payload.scheduled_at
						? { scheduled_at: payload.scheduled_at }
						: { clear_schedule: true }),
					metadata: payload.metadata,
					segments: payload.segments,
					renditions: payload.renditions
				}
			});
			if (updateError) {
				const conflict = parseDraftConflict(updateError);
				if (conflict) {
					draftConflict = conflict;
					conflictDialogOpen = true;
				}
				throw new Error(updateError.detail || m.compose_save_publication_failed());
			}
			revision = data.revision;
			draftConflict = null;
			return targetPublicationId;
		}

		const { data, error: createError } = await client.POST('/publications', {
			body: payload
		});
		if (createError) throw new Error(createError.detail || m.compose_create_publication_failed());
		if (
			context &&
			(context.generation !== saveGeneration ||
				context.workspaceId !== selectedWorkspaceId ||
				context.startingPublicationId !== publicationId)
		) {
			return data.id;
		}
		publicationId = data.id;
		revision = data.revision;
		draftConflict = null;
		ui.setActiveComposerDraft(data.id);
		onDraftCreated?.(data.id);
		return data.id;
	}

	async function reloadSavedDraft() {
		if (!draftConflict) return;
		const { data, error: loadError } = await client.GET('/publications/{id}', {
			params: { path: { id: draftConflict.conflict.aggregate_id } }
		});
		if (loadError || !data) {
			throw new Error(loadError?.detail || m.compose_save_publication_failed());
		}
		hydrateInitialPublication(data);
		lastSavedSnapshot = saveSnapshot();
		error = '';
		draftConflict = null;
	}

	async function saveConflictedDraftAsCopy() {
		await persistPublication(undefined, { saveAsCopy: true });
		lastSavedSnapshot = saveSnapshot();
		success = m.compose_draft_saved();
		error = '';
	}

	async function overwriteSavedDraft() {
		if (!draftConflict) return;
		revision = draftConflict.conflict.current_revision;
		await persistPublication(undefined, { force: true });
		lastSavedSnapshot = saveSnapshot();
		success = m.compose_changes_saved();
		error = '';
	}

	async function flushPendingSave(): Promise<boolean> {
		clearAutoSaveTimer();
		await saveQueue.flush().catch(() => publicationId);
		if (
			autoSaveReady &&
			hasDraftContent() &&
			saveSnapshot() !== lastSavedSnapshot &&
			!draftConflict
		) {
			await persistPublication();
			lastSavedSnapshot = saveSnapshot();
		}
		return !draftConflict && saveSnapshot() === lastSavedSnapshot;
	}

	async function validatePublication(id: string): Promise<ValidationIssue[]> {
		const { data, error: err } = await client.POST('/publications/{id}/validate', {
			params: { path: { id } }
		});
		if (err) throw new Error(err.detail || m.compose_validation_failed());
		validationIssues = data?.issues ?? [];
		return validationIssues;
	}

	async function runAction(action: 'validate' | 'schedule' | 'publish') {
		if (action === 'schedule' && !selectedWorkspaceSettingsReady) {
			error = m.compose_load_workspace_settings_failed();
			success = '';
			return;
		}
		if (!selectedProviderReadinessReady) {
			error = providerReadinessError || m.compose_load_readiness_failed();
			success = '';
			return;
		}
		if (localBlockers.length > 0) {
			error = localBlockers[0];
			success = '';
			return;
		}
		if (accountBlockingMessages.length > 0) {
			error = accountBlockingMessages[0];
			success = '';
			return;
		}
		if (action === 'schedule') {
			const scheduledAt = getScheduledAt();
			if (!scheduledAt) {
				error = m.compose_choose_schedule();
				success = '';
				return;
			}
			if (!isFutureSchedule(scheduledAt)) {
				error = m.compose_schedule_future();
				success = '';
				return;
			}
		}
		clearAutoSaveTimer();
		saving = true;
		error = '';
		success = '';
		try {
			const capabilitiesReady = await resolveSelectedCapabilities();
			if (!capabilitiesReady) {
				throw new Error(
					capabilityResolveError ||
						validationIssues.find((issue) => issue.severity === 'error')?.message ||
						m.compose_fix_before_publishing()
				);
			}
			const id = await persistPublication();
			if (action === 'validate') {
				await validatePublication(id);
				success = m.compose_validation_complete();
			} else if (action === 'schedule') {
				const issues = await validatePublication(id);
				if (issues.some((issue) => issue.severity === 'error')) {
					throw new Error(m.compose_fix_before_scheduling());
				}
				const { data, error: scheduleError } = await client.POST('/publications/{id}/schedule', {
					params: { path: { id } },
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
				success = data?.message ?? m.compose_publication_scheduled();
			} else if (action === 'publish') {
				const issues = await validatePublication(id);
				if (issues.some((issue) => issue.severity === 'error')) {
					throw new Error(m.compose_fix_before_publishing());
				}
				const { data, error: publishError } = await client.POST('/publications/{id}/publish-now', {
					params: { path: { id } },
					body: { expected_revision: revision }
				});
				if (publishError) {
					const conflict = parseDraftConflict(publishError);
					if (conflict) {
						draftConflict = conflict;
						conflictDialogOpen = true;
					}
					throw new Error(publishError.detail || m.compose_publish_failed());
				}
				success = data?.message ?? m.compose_publication_queued();
			}
			lastSavedSnapshot = saveSnapshot();
			ui.triggerRefresh();
			if (isEditMode && action !== 'validate') onSuccess?.();
		} catch (err) {
			error = err instanceof Error ? err.message : m.compose_action_failed();
		} finally {
			saving = false;
		}
	}

	function mediaSummaryToFocusedMedia(item: MediaSummary): FocusedMedia {
		return {
			id: item.id,
			mime_type: item.mime_type,
			url: item.url,
			size: item.size,
			filename: item.original_filename || item.id,
			role: item.role,
			altText: item.alt_text,
			settings: item.settings
		};
	}

	function mediaItemLabel(item: FocusedMediaInput): string {
		return media.find((candidate) => candidate.id === item.id)?.filename || item.id;
	}

	function youtubeThumbnailId(renditions: Rendition[]): string {
		const youtube = renditions.find(
			(rendition) => getPlatformKey(rendition.platform) === 'youtube'
		);
		const value = youtube?.settings?.thumbnail_media_id;
		return typeof value === 'string' ? value : '';
	}

	function isVideo(item: FocusedMedia): boolean {
		return item.mime_type.startsWith('video/');
	}

	function isImage(item: FocusedMedia): boolean {
		return item.mime_type.startsWith('image/');
	}

	function previewSrc(item: FocusedMedia): string {
		return getAuthenticatedMediaByID(item.id) || item.url;
	}

	function accountLabel(account: SocialAccount): string {
		return account.account_username || account.slug || getPlatformName(account.platform);
	}

	function emptySegmentsForMode(intent: ComposerModeKey): FocusedSegmentInput[] {
		const count = intent === 'thread' ? 2 : 1;
		return Array.from({ length: count }, (_, index) => ({
			id: `segment-${index + 1}`,
			content: '',
			media: [],
			settingsByAccount: {}
		}));
	}
</script>

<div class="flex min-h-0 flex-1 flex-col bg-background" data-testid="focused-composer">
	{#if !loading}
		<div class="border-b bg-background px-3 py-2 md:px-4 md:py-3">
			<div class="flex flex-wrap items-center justify-between gap-2">
				<div class="flex min-w-0 flex-wrap items-center gap-2">
					{#if modeControl}
						{@render modeControl()}
					{/if}
					{#if onCancel}
						<Button
							variant="ghost"
							size="sm"
							class="h-11 md:h-8"
							onclick={onCancel}
							disabled={saving || autoSaving}
						>
							{m.common_cancel()}
						</Button>
					{/if}
					{#if accounts.length > 0}
						<ComposerAccountMenu
							{accounts}
							{selectedAccountIds}
							compatibleAccountIds={compatibleAccounts.map((account) => account.id)}
							settingsAccountIds={selectedAccounts
								.filter((account) => visibleSettings(account).length > 0)
								.map((account) => account.id)}
							{accountSummaries}
							{accountIssues}
							{warningAccountIds}
							triggerLabel={m.compose_target_accounts()}
							triggerClass="h-11 md:h-8"
							description={m.compose_accounts_compatible({ format: modeMeta.label })}
							onToggle={toggleAccount}
							onSelectAll={selectAllAccounts}
							onClearAll={clearAllAccounts}
							onSettings={openDestinationSettings}
						/>
						<ComposerValidationMenu issues={globalIssues} class="md:size-8" />
					{/if}
				</div>

				<ComposerPublishActions
					class="w-full md:w-auto"
					scheduleLabel={scheduleLabel()}
					quickScheduleLabel={selectedDate && selectedTime
						? m.compose_schedule_selected_time({ schedule: scheduleLabel() })
						: m.compose_schedule_next_slot()}
					publishLabel={m.compose_publish_now()}
					deleteLabel={m.common_delete()}
					busy={saving || autoSaving}
					deleting={deletingPublication}
					quickScheduleBusy={suggestingSlot}
					scheduleSelected={Boolean(selectedDate && selectedTime)}
					canOpenSchedule={selectedWorkspaceSettingsReady}
					canQuickSchedule={canQueue && selectedWorkspaceSettingsReady}
					canPublish={canQueue}
					onSchedule={() => (showScheduleDialog = true)}
					onQuickSchedule={quickSchedule}
					onPublish={() => runAction('publish')}
					onDelete={publicationId ? () => (deletePublicationDialogOpen = true) : undefined}
				/>
			</div>
		</div>
	{/if}

	{#if loading}
		<div class="min-h-0 flex-1 overflow-y-auto" aria-busy="true">
			<PageLoading layout="composer" label={m.common_loading()} />
		</div>
	{:else}
		<div class="min-h-0 flex-1 overflow-y-auto">
			<div class="mx-auto w-full max-w-3xl space-y-6 px-4 py-5 md:px-6">
				{#if accountsError}
					<div data-testid="composer-accounts-load-error">
						<InlineNotice tone="error" message={accountsError}>
							{#snippet actions()}
								<Button
									type="button"
									variant="outline"
									size="sm"
									class="h-11 md:h-9"
									disabled={accountsLoading}
									onclick={retryAccounts}
								>
									{#if accountsLoading}
										<LoaderIcon class="size-3.5 animate-spin" />
									{/if}
									{m.common_retry()}
								</Button>
							{/snippet}
						</InlineNotice>
					</div>
				{/if}
				{#if error}
					<InlineNotice tone="error" message={error} />
				{/if}
				{#if success}
					<InlineNotice tone="success" message={success} />
				{/if}
				{#if capabilityResolveError}
					<InlineNotice tone="error" message={capabilityResolveError}>
						{#snippet actions()}
							<Button
								type="button"
								variant="outline"
								size="sm"
								onclick={() => resolveSelectedCapabilities()}
							>
								{m.common_retry()}
							</Button>
						{/snippet}
					</InlineNotice>
				{/if}

				{#if accounts.length === 0 && !accountsError}
					<div class="rounded-lg border bg-muted/20 px-4 py-3 text-sm text-muted-foreground">
						{m.compose_connect_compatible()}
					</div>
				{/if}

				<section class="flex flex-col gap-5">
					<div class="{modeMeta.mediaFirst ? 'order-1' : 'order-2'} space-y-3">
						<div class="space-y-3">
							<ComposerMediaDropzone
								bind:dragging={draggingMedia}
								disabled={!selectedWorkspaceId || media.length >= composerMediaLimit}
								{uploading}
								description={mode === 'video' ? m.compose_add_long_video() : m.compose_add_media()}
								class={media.length > 0 ? 'min-h-28 py-4' : ''}
								onChoose={() => openFocusedMediaPicker('media')}
								onDropFiles={uploadFocusedFiles}
							/>
							{#if media.length > 0}
								<div class="grid gap-2 sm:grid-cols-2">
									{#each media as item (item.id)}
										<div class="group relative overflow-hidden rounded-md border bg-background">
											{#if isImage(item)}
												<img
													src={previewSrc(item)}
													alt={item.filename || m.compose_uploaded_media()}
													class="aspect-video w-full object-cover"
												/>
											{:else if isVideo(item)}
												<video
													src={previewSrc(item)}
													class="aspect-video w-full object-cover"
													controls
													muted
													playsinline
												></video>
											{:else}
												<div
													class="flex aspect-video items-center justify-center text-sm text-muted-foreground"
												>
													{item.mime_type}
												</div>
											{/if}
											<div
												class="flex items-center justify-between gap-2 border-t bg-background px-2 py-1.5 text-xs"
												data-testid="composer-media-actions"
											>
												<span class="min-w-0 truncate">{item.filename || item.id}</span>
												<button
													type="button"
													class="flex size-11 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none md:size-9"
													aria-label={m.compose_remove_media()}
													onclick={() => removeMedia(item.id)}
												>
													<XIcon class="h-3.5 w-3.5" />
												</button>
											</div>
											{#if isImage(item)}
												<div class="border-t px-2 py-2">
													<label class="text-xs font-medium" for="media-alt-{item.id}">
														{m.media_alt_text()}
													</label>
													<Input
														id="media-alt-{item.id}"
														class="mt-1 h-11 md:h-9"
														value={item.altText ?? ''}
														placeholder={m.compose_alt_text_placeholder()}
														oninput={(event) =>
															updateMediaAltText(item.id, event.currentTarget.value)}
													/>
												</div>
											{/if}
										</div>
									{/each}
								</div>
							{/if}
						</div>

						{#if hasYouTubeTarget && (mode === 'short_video' || mode === 'video')}
							<div class="rounded-md border bg-background p-4">
								<div class="flex flex-wrap items-center gap-3">
									<Button
										type="button"
										variant="outline"
										class="h-11 gap-2"
										disabled={!selectedWorkspaceId}
										onclick={() => openFocusedMediaPicker('thumbnail')}
									>
										<ImagePlusIcon class="h-4 w-4" />
										{m.compose_thumbnail()}
									</Button>
									<p class="text-sm text-muted-foreground">{m.compose_thumbnail_youtube()}</p>
									{#if thumbnailMediaId}
										<Button variant="ghost" size="sm" class="h-8 text-xs" onclick={clearThumbnail}>
											{m.compose_clear()}
										</Button>
									{/if}
								</div>
								{#if thumbnailMedia}
									<img
										src={previewSrc(thumbnailMedia)}
										alt={thumbnailMedia.filename || m.compose_thumbnail()}
										class="mt-3 aspect-video max-h-48 rounded-md border object-cover"
									/>
								{:else if thumbnailMediaId}
									<p class="mt-2 text-xs text-muted-foreground">
										{m.compose_existing_thumbnail({ id: thumbnailMediaId })}
									</p>
								{/if}
							</div>
						{/if}
					</div>

					<div class="{modeMeta.mediaFirst ? 'order-2' : 'order-1'} space-y-4">
						{#if mode === 'thread'}
							<div class="space-y-3">
								{#each segments as segment, index (segment.id)}
									<article
										class:border-primary={activeSettingsSegmentId === segment.id}
										class="rounded-lg border bg-background p-3 transition-colors"
									>
										<div class="mb-2 flex items-center justify-between gap-2">
											<label class="text-sm font-semibold" for="thread-segment-{segment.id}">
												{m.compose_thread_post({ number: index + 1 })}
											</label>
											{#if segments.length > 2}
												<Button
													type="button"
													variant="ghost"
													size="icon"
													class="size-11 text-muted-foreground hover:text-destructive md:size-9"
													aria-label={m.compose_remove_post()}
													onclick={() => removeThreadSegment(segment.id)}
												>
													<Trash2Icon class="size-4" />
												</Button>
											{/if}
										</div>
										<Textarea
											id="thread-segment-{segment.id}"
											data-testid="composer-thread-segment-{index + 1}"
											class="min-h-28 resize-y text-base"
											rows={5}
											value={segment.content}
											placeholder={m.compose_add_to_thread()}
											onfocus={() => (activeSettingsSegmentId = segment.id)}
											oninput={(event) =>
												updateThreadSegment(segment.id, event.currentTarget.value)}
										/>
									</article>
								{/each}
								<Button
									type="button"
									variant="outline"
									class="h-11 w-full gap-2 border-dashed"
									onclick={addThreadSegment}
								>
									<PlusIcon class="size-4" />
									{m.compose_add_post()}
								</Button>
							</div>
						{/if}
						{#each roleFields as field (field.key)}
							<div>
								<label class="text-sm font-medium" for="focused-field-{field.key}">
									{field.label}
								</label>
								{#if field.type === 'textarea'}
									<Textarea
										id="focused-field-{field.key}"
										data-testid="composer-field-{field.key}"
										class="mt-1 min-h-32 resize-y text-base"
										rows={field.rows ?? 6}
										value={fieldValue(field.key)}
										oninput={(event) => updateField(field.key, event.currentTarget.value)}
									/>
								{:else}
									<Input
										id="focused-field-{field.key}"
										data-testid="composer-field-{field.key}"
										class="mt-1"
										type={field.type === 'url' ? 'url' : 'text'}
										value={fieldValue(field.key)}
										oninput={(event) => updateField(field.key, event.currentTarget.value)}
									/>
								{/if}
								<p class="mt-1 text-xs text-muted-foreground">{field.hint}</p>
							</div>
						{/each}
						{#if roleFields.length === 0 && mode !== 'thread'}
							<div class="rounded-md border bg-muted/20 px-3 py-2 text-sm text-muted-foreground">
								{m.compose_media_first_notice()}
							</div>
						{/if}
					</div>
				</section>
			</div>
		</div>
	{/if}
</div>

<ComposerScheduleDialog
	bind:open={showScheduleDialog}
	bind:selectedDate
	bind:selectedTime
	{timeSlots}
	timezone={scheduleTimezoneLabel}
	weekStartsOn={schedulingSettings.weekStartsOn}
	selectedDisplay={scheduleLabel()}
	externalError={scheduleError}
	suggesting={suggestingSlot}
	submitting={saving}
	{canSchedule}
	onSuggest={suggestNextSlot}
	onSchedule={() => runAction('schedule')}
	onClear={clearSchedule}
/>

<MediaPicker
	bind:open={mediaPickerOpen}
	workspaceId={selectedWorkspaceId}
	currentSelection={mediaPickerPurpose === 'thumbnail'
		? thumbnailMediaId
			? [thumbnailMediaId]
			: []
		: media.map((item) => item.id)}
	accept={mediaPickerPurpose === 'thumbnail'
		? ['image/*']
		: mode === 'post'
			? [
					'image/*',
					'video/*',
					'application/pdf',
					'application/msword',
					'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
					'application/vnd.ms-powerpoint',
					'application/vnd.openxmlformats-officedocument.presentationml.presentation'
				]
			: ['image/*', 'video/*']}
	maxSelection={mediaPickerPurpose === 'thumbnail' ? 1 : composerMediaLimit}
	multiple={mediaPickerPurpose !== 'thumbnail' && composerMediaLimit > 1}
	title={mediaPickerPurpose === 'thumbnail' ? m.compose_thumbnail() : m.compose_add_media()}
	purpose={mediaPickerPurpose === 'thumbnail' ? 'thumbnail' : 'post_media'}
	onConfirm={applyFocusedMediaPicker}
	onCreate={openStudioFromFocusedComposer}
/>

<DestinationSettingsDialog
	bind:open={settingsDialogOpen}
	account={settingsAccount}
	settings={settingsDialogFields}
	values={settingsDialogValues}
	mediaItems={settingsDialogMedia.map((item) => ({
		id: item.id,
		label: mediaItemLabel(item),
		mimeType: item.mimeType
	}))}
	mediaValues={settingsDialogMediaValues}
	optionGroups={settingsAccount ? (destinationOptionsByAccount[settingsAccount.id] ?? {}) : {}}
	optionsLoading={settingsAccount?.id === destinationOptionsLoadingAccountId}
	optionsError={settingsAccount ? (destinationOptionsErrors[settingsAccount.id] ?? '') : ''}
	scopeLabel={mode === 'thread'
		? m.compose_thread_post({
				number: Math.max(
					1,
					segments.findIndex((segment) => segment.id === activeSettingsSegmentId) + 1
				)
			})
		: ''}
	onChange={(key, value) => {
		if (settingsAccount) updateAccountSetting(settingsAccount, key, value);
	}}
	onMediaChange={(mediaId, key, value) => {
		if (settingsAccount) updateMediaAccountSetting(settingsAccount, mediaId, key, value);
	}}
	onOptionSearch={(setting, search) => {
		if (settingsAccount && setting.options_source) {
			void loadDestinationOptions(settingsAccount, true, setting.options_source, search);
		}
	}}
	onFileChange={handleDestinationFile}
	onRetry={() => {
		if (settingsAccount) void loadDestinationOptions(settingsAccount, true);
	}}
	onRemove={settingsAccount &&
	publicationId &&
	initialPublication?.renditions?.some(
		(rendition) => rendition.social_account_id === settingsAccount.id
	)
		? () => requestDeleteDestination(settingsAccount)
		: undefined}
/>

<DestructiveConfirmDialog
	bind:open={deletePublicationDialogOpen}
	title={m.sidebar_delete_draft_confirm()}
	description={m.compose_delete_draft_body()}
	onConfirm={deletePublication}
/>

<DestructiveConfirmDialog
	bind:open={deleteDestinationDialogOpen}
	title={m.compose_delete_destination_title({
		account: deleteDestinationAccount ? accountLabel(deleteDestinationAccount) : ''
	})}
	description={m.compose_delete_destination_body()}
	confirmLabel={m.compose_delete_destination_confirm()}
	onConfirm={confirmDeleteDestination}
/>

<DraftConflictDialog
	bind:open={conflictDialogOpen}
	conflict={draftConflict}
	onReload={reloadSavedDraft}
	onSaveCopy={saveConflictedDraftAsCopy}
	onOverwrite={overwriteSavedDraft}
/>
