<script lang="ts">
	import { onMount, tick, type Snippet } from 'svelte';
	import { client, type SocialAccount, type Workspace, getToken } from '$lib/api/client';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { getAuthenticatedMediaByID } from '$lib/media-url';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { Button } from '$lib/components/ui/button';
	import { Calendar } from '$lib/components/ui/calendar';
	import * as Popover from '$lib/components/ui/popover';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import ComposePreviewPanel, { type PreviewGroup } from './compose-preview-panel.svelte';
	import PlatformIcon from './platform-icon.svelte';
	import { getPlatformKey, getPlatformName } from '$lib/utils';
	import { CalendarDate, getLocalTimeZone, today, isEqualDay } from '@internationalized/date';
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import PlusIcon from 'lucide-svelte/icons/plus';
	import XIcon from 'lucide-svelte/icons/x';
	import ClockIcon from 'lucide-svelte/icons/clock';
	import LightbulbIcon from 'lucide-svelte/icons/lightbulb';
	import ShuffleIcon from 'lucide-svelte/icons/shuffle';
	import ImageIcon from 'lucide-svelte/icons/image';
	import SendIcon from 'lucide-svelte/icons/send';
	import ChevronDownIcon from 'lucide-svelte/icons/chevron-down';
	import UnlinkIcon from 'lucide-svelte/icons/unlink';
	import Link2Icon from 'lucide-svelte/icons/link-2';
	import GripVerticalIcon from 'lucide-svelte/icons/grip-vertical';
	import Trash2Icon from 'lucide-svelte/icons/trash-2';
	import TypeIcon from 'lucide-svelte/icons/type';
	import EyeIcon from 'lucide-svelte/icons/eye';
	import { ui } from '$lib/stores/ui.svelte';
	import { Skeleton } from '$lib/components/ui/skeleton/index.js';
	import { ReorderableList } from 'svelte-reorderable-list';
	import * as Sheet from '$lib/components/ui/sheet';
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

	// --------------------------------------------------------------------------
	// Types
	// --------------------------------------------------------------------------
	interface InitialPost {
		id: string;
		workspace_id: string;
		content: string;
		thread_draft?: string | null;
		status: string;
		scheduled_at: string;
		media: Array<{ media_id: string; mime_type?: string; alt_text?: string }>;
		destinations: Array<{ social_account_id: string; platform: string }>;
	}

	interface SocialMediaSet {
		id: string;
		workspace_id: string;
		name: string;
		is_default: boolean;
		accounts: Array<{
			social_account_id: string;
			platform: string;
			account_username: string;
			is_main: boolean;
		}>;
	}

	interface Props {
		initialPost?: InitialPost;
		onSuccess?: () => void;
		onCancel?: () => void;
	}

	// --------------------------------------------------------------------------
	// Props & core state
	// --------------------------------------------------------------------------
	let { initialPost, onSuccess, onCancel }: Props = $props();
	let isEditMode = $derived(!!initialPost);

	let posts = $state<PostItem[]>([makeEmptyPost()]);
	let activePostIndex = $state(0);
	let draftId = $state<string | null>(null);
	let lastInitializedPostId = $state<string | null>(null);
	let isSaving = $state(false);
	let isSubmitting = $state(false);
	let error = $state('');
	let success = $state('');

	let workspaces = $state<Workspace[]>([]);
	let selectedWorkspaceId = $state<string>('');
	let accounts = $state<SocialAccount[]>([]);
	let selectedAccountIds = $state<string[]>([]);
	let loadingWorkspaces = $state(true);
	let loadingAccounts = $state(false);

	let sets = $state<SocialMediaSet[]>([]);
	let selectedSetId = $state<string | null>(null);
	let loadingSets = $state(false);

	let showPreview = $state(true);
	let showMobilePreview = $state(false);

	let selectedDate = $state<CalendarDate | undefined>(undefined);
	let selectedTime = $state<string | null>(null);
	let suggestingSlot = $state(false);
	let showSchedulePopover = $state(false);

	let showPromptCard = $state(false);
	let currentPrompt = $state<{ text: string; category: string } | null>(null);
	let loadingPrompt = $state(false);

	let variants = $state<Map<string, Record<string, VariantPost>>>(new Map());
	let activeVariantAccountId = $state<string | null>(null);

	let isDraggingFile = $state(false);
	let isUploading = $state(false);

	let mediaAltTexts = $state<Map<string, string>>(new Map());
	let mediaMimeTypes = $state<Map<string, string>>(new Map());
	let editingAltMediaId = $state<string | null>(null);

	let autoSaveTimer: ReturnType<typeof setTimeout> | null = null;
	let lastSavedSnapshot = $state('');
	let textareaRefs = $state<Map<number, HTMLTextAreaElement>>(new Map());

	// --------------------------------------------------------------------------
	// Constants & derived values
	// --------------------------------------------------------------------------
	const PLATFORM_CHAR_LIMITS: Record<string, number> = {
		x: 280,
		mastodon: 500,
		bluesky: 300,
		linkedin: 3000,
		threads: 500
	};

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

	const isToday = $derived(
		selectedDate ? isEqualDay(selectedDate, today(getLocalTimeZone())) : false
	);

	const timeSlots = $derived.by(() => {
		if (!isToday) return allTimeSlots;
		const now = new Date();
		const currentMinutes = now.getHours() * 60 + now.getMinutes();
		return allTimeSlots.filter((slot) => {
			const [h, m] = slot.split(':').map(Number);
			return h * 60 + m > currentMinutes;
		});
	});

	const activePost = $derived(posts[activePostIndex] ?? posts[0]);
	const hasContent = $derived(hasAnyContent(posts));
	const totalChars = $derived(posts.reduce((sum, p) => sum + p.content.length, 0));
	const isThread = $derived(posts.length > 1);

	const selectedAccounts = $derived(accounts.filter((a) => selectedAccountIds.includes(a.id)));
	const mediaCapabilityWarnings = $derived.by(() => {
		const warnings: string[] = [];
		const sourcePosts = isThread ? posts : activePost ? [activePost] : [];

		for (const account of selectedAccounts) {
			const platform = getPlatformKey(account.platform);
			for (const post of sourcePosts) {
				const mediaIds = getVariantMediaIds(account.id, post.key) ?? post.mediaIds;
				warnings.push(...getProviderMediaWarnings(platform, mediaIds));
			}
		}

		return Array.from(new Set(warnings));
	});
	const activeVariantAccount = $derived(
		activeVariantAccountId ? (accounts.find((a) => a.id === activeVariantAccountId) ?? null) : null
	);
	const activeVariantIsUnsynced = $derived(
		activeVariantAccountId ? variants.has(activeVariantAccountId) : false
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

	const editorPlatformLimits = $derived.by(() => {
		const seen = new Set<string>();
		return editorTargetAccounts
			.map((a) => {
				const key = getPlatformKey(a.platform);
				return {
					platform: getPlatformName(a.platform),
					key,
					limit: PLATFORM_CHAR_LIMITS[key] ?? 280
				};
			})
			.filter((item) => {
				if (seen.has(item.key)) return false;
				seen.add(item.key);
				return true;
			});
	});

	const editorMaxChars = $derived.by(() => {
		if (editorTargetAccounts.length === 0) return 280;
		const limits = editorTargetAccounts.map(
			(a) => PLATFORM_CHAR_LIMITS[getPlatformKey(a.platform)] ?? 280
		);
		return Math.min(...limits);
	});

	const previewGroups = $derived.by<PreviewGroup[]>(() => {
		const groups: PreviewGroup[] = [];
		const seenPlatforms = new Set<string>();
		const sourcePosts = isThread ? posts : activePost ? [activePost] : [];

		for (const account of selectedAccounts) {
			const platformKey = getPlatformKey(account.platform);
			if (seenPlatforms.has(platformKey)) continue;
			seenPlatforms.add(platformKey);
			const previewPosts = sourcePosts
				.map((post) => ({
					key: post.key,
					content: getVariantContent(account.id, post.key) ?? post.content,
					mediaIds: getVariantMediaIds(account.id, post.key) ?? post.mediaIds,
					mediaMimeTypes: getMediaMimeTypeRecord(
						getVariantMediaIds(account.id, post.key) ?? post.mediaIds
					)
				}))
				.filter((post) => !isThread || post.content.trim().length > 0 || post.mediaIds.length > 0);

			groups.push({
				key: `${account.id}:${platformKey}`,
				platformKey,
				platformName: getPlatformName(account.platform),
				username: account.account_username || 'username',
				displayName: account.account_username || 'Display Name',
				isUnsynced: variants.has(account.id),
				posts: previewPosts
			});
		}

		return groups;
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

		const nextVariants = new Map<string, Record<string, VariantPost>>();
		for (const [accountID, value] of variants.entries()) {
			if (validIds.has(accountID)) {
				nextVariants.set(accountID, value);
			}
		}
		if (nextVariants.size !== variants.size) {
			variants = nextVariants;
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

	function textareaAction(el: HTMLTextAreaElement, index: number) {
		textareaRefs.set(index, el);
		autoResize(el);
		return {
			update() {
				textareaRefs.set(index, el);
			},
			destroy() {
				textareaRefs.delete(index);
			}
		};
	}

	function getScheduledAt(): string | undefined {
		if (!selectedDate || !selectedTime) return undefined;
		const [hours, minutes] = selectedTime.split(':').map(Number);
		const date = selectedDate.toDate(getLocalTimeZone());
		date.setHours(hours, minutes, 0, 0);
		return date.toISOString();
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
			variants: variantEntries
		});
	}

	function canUnsyncAccount(account: SocialAccount | null | undefined): boolean {
		if (!account) return false;
		if (!isThread) return true;
		return getPlatformKey(account.platform) !== 'linkedin';
	}

	function getVariantPost(accountId: string, postKey: string): VariantPost | null {
		const values = variants.get(accountId);
		if (!values) return null;
		return values[postKey] ?? null;
	}

	function getVariantContent(accountId: string, postKey: string): string | null {
		const variant = getVariantPost(accountId, postKey);
		if (!variant) return null;
		return variant.content;
	}

	function getVariantMediaIds(accountId: string, postKey: string): string[] | null {
		const variant = getVariantPost(accountId, postKey);
		if (!variant) return null;
		return variant.mediaIds;
	}

	function getVariantPayloadForSave(): Record<string, Record<string, VariantPost>> {
		return Object.fromEntries(
			Array.from(variants.entries()).map(([accountId, values]) => [accountId, values])
		);
	}

	function makeVariantRecord(sourcePosts: PostItem[]): Record<string, VariantPost> {
		return Object.fromEntries(
			sourcePosts.map((post) => [
				post.key,
				{
					content: post.content,
					mediaIds: [...post.mediaIds]
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
						mediaIds: value?.mediaIds ? [...value.mediaIds] : [...post.mediaIds]
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
				arraysEqual(leftValue?.mediaIds ?? post.mediaIds, rightValue.mediaIds)
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

	function getMediaMimeTypeRecord(mediaIds: string[]): Record<string, string> {
		return Object.fromEntries(
			mediaIds.map((id) => [id, mediaMimeTypes.get(id) ?? '']).filter(([, mimeType]) => mimeType)
		);
	}

	function isVideoMedia(mediaId: string): boolean {
		return mediaMimeTypes.get(mediaId)?.startsWith('video/') ?? false;
	}

	function getProviderMediaWarnings(platform: string, mediaIds: string[]): string[] {
		if (mediaIds.length === 0) return [];
		const videos = mediaIds.filter((id) => isVideoMedia(id));
		const warnings: string[] = [];

		if ((platform === 'x' || platform === 'bluesky') && videos.length > 0 && mediaIds.length > 1) {
			warnings.push(
				`${getPlatformName(platform)} supports one video per post and cannot mix it with images.`
			);
		}
		if (platform === 'linkedin' && mediaIds.length > 1) {
			warnings.push('LinkedIn publishing currently sends only the first media attachment.');
		}
		if (platform === 'threads' && mediaIds.length > 1) {
			warnings.push('Threads publishing currently sends only the first media attachment.');
		}
		if (platform === 'threads') {
			for (const id of videos) {
				const mimeType = mediaMimeTypes.get(id) ?? '';
				if (mimeType !== 'video/mp4' && mimeType !== 'video/quicktime') {
					warnings.push('Threads supports MP4 or MOV video.');
				}
			}
		}
		return warnings;
	}

	function normalizeVariantsMap(
		nextVariants: Map<string, Record<string, VariantPost>>,
		sourcePosts: PostItem[] = posts
	): Map<string, Record<string, VariantPost>> {
		const normalized = new Map<string, Record<string, VariantPost>>();
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
		if (!post) {
			draftId = null;
			lastInitializedPostId = null;
			posts = [makeEmptyPost()];
			activePostIndex = 0;
			lastSavedSnapshot = '';
			variants = new Map();
			activeVariantAccountId = null;
			selectedAccountIds = [];
			selectedSetId = null;
			mediaAltTexts = new Map();
			mediaMimeTypes = new Map();
			const tomorrow = today(getLocalTimeZone()).add({ days: 1 });
			selectedDate = new CalendarDate(tomorrow.year, tomorrow.month, tomorrow.day);
			selectedTime = '10:00';
			if (workspaces.length > 0) {
				selectedWorkspaceId = workspaceCtx.currentWorkspace?.id ?? workspaces[0].id;
				await loadAccounts(selectedWorkspaceId);
				await loadSets(selectedWorkspaceId);
			}
			return;
		}

		draftId = post.id;
		lastInitializedPostId = post.id;
		selectedWorkspaceId = post.workspace_id;
		selectedAccountIds = post.destinations?.map((d) => d.social_account_id) ?? [];

		// Load alt texts from media
		const newAlts = new Map<string, string>();
		const newMimeTypes = new Map<string, string>();
		post.media?.forEach((m) => {
			if (m.alt_text) newAlts.set(m.media_id, m.alt_text);
			if (m.mime_type) newMimeTypes.set(m.media_id, m.mime_type);
		});
		mediaAltTexts = newAlts;
		mediaMimeTypes = newMimeTypes;

		// Read the thread state. Prefer the explicit `thread_draft`
		// field on the post (new P0.2 representation, set by the
		// backend when the post is a thread draft). Fall back to the
		// legacy `__openpost_thread__:` blob inside `content` for posts
		// that were saved before the migration ran. If neither is
		// present, treat it as a single-post draft.
		const threadSource: string | null = post.thread_draft ?? null;
		const legacySource: string | null = isThreadDraft(post.content) ? post.content : null;
		const source = threadSource ?? legacySource;
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
		selectedSetId = null;

		if (post.scheduled_at && post.scheduled_at !== '0001-01-01T00:00:00Z') {
			const date = new Date(post.scheduled_at);
			selectedDate = new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
			selectedTime = `${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
		} else {
			const tomorrow = today(getLocalTimeZone()).add({ days: 1 });
			selectedDate = new CalendarDate(tomorrow.year, tomorrow.month, tomorrow.day);
			selectedTime = '10:00';
		}

		await loadAccounts(selectedWorkspaceId, selectedAccountIds);
		await loadSets(selectedWorkspaceId, false);
		if (!source) {
			await loadVariants(post.id);
		}
		lastSavedSnapshot = getSaveSnapshot();
	}

	onMount(async () => {
		try {
			const { data, error: err } = await client.GET('/workspaces');
			if (err || !data) throw new Error('Failed to load workspaces');
			workspaces = data;
			await initializeFromPost(initialPost);
		} catch (e) {
			console.error('Failed to load workspaces:', e);
		} finally {
			loadingWorkspaces = false;
		}
	});

	$effect(() => {
		const post = initialPost;
		if (!loadingWorkspaces && post && lastInitializedPostId !== post.id) {
			initializeFromPost(post);
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
		const text = ui.promptText;
		if (text && !initialPost && !loadingWorkspaces) {
			posts = [{ ...makeEmptyPost(), content: text }];
			activePostIndex = 0;
			ui.clearPrompt();
		}
	});

	$effect(() => {
		const selected = new Set(selectedAccountIds);
		let changed = false;
		const nextVariants = new Map<string, Record<string, VariantPost>>();
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
		if (activeVariantAccountId) {
			const activeAccount = accounts.find((account) => account.id === activeVariantAccountId);
			if (!canUnsyncAccount(activeAccount)) {
				activeVariantAccountId = null;
			}
		}
	});

	// --------------------------------------------------------------------------
	// Data loading
	// --------------------------------------------------------------------------
	async function loadAccounts(workspaceId: string, preferredAccountIds?: string[]) {
		if (!workspaceId) return;
		try {
			const { data, error: err } = await client.GET('/accounts', {
				params: { query: { workspace_id: workspaceId } }
			});
			accounts = data ?? [];
			if (preferredAccountIds && preferredAccountIds.length > 0) {
				const validIds = accounts.map((a) => a.id);
				selectedAccountIds = preferredAccountIds.filter((id) => validIds.includes(id));
				if (selectedAccountIds.length === 0) {
					selectedAccountIds = accounts.map((a) => a.id);
				}
			} else {
				selectedAccountIds = accounts.map((a) => a.id);
			}
			sanitizeSelectedAccounts(accounts);
		} catch (e) {
			console.error('Failed to load accounts:', e);
			accounts = [];
			selectedAccountIds = [];
			sanitizeSelectedAccounts([]);
		}
	}

	async function loadSets(workspaceId: string, autoApplyDefault = true) {
		if (!workspaceId) return;
		try {
			const { data, error: err } = await client.GET('/sets', {
				params: { query: { workspace_id: workspaceId } }
			});
			sets = (data ?? []) as unknown as SocialMediaSet[];
			if (selectedSetId) {
				const selectedSet = sets.find((set) => set.id === selectedSetId) ?? null;
				if (!selectedSet) {
					selectedSetId = null;
				} else {
					const nextSelectedIds = selectedSet.accounts.map((account) => account.social_account_id);
					if (!arraysEqual(nextSelectedIds, selectedAccountIds)) {
						applySet(selectedSet);
					}
				}
			}
			if (autoApplyDefault && !selectedSetId) {
				const defaultSet = sets.find((s) => s.is_default);
				if (defaultSet) {
					selectedSetId = defaultSet.id;
					applySet(defaultSet);
				}
			}
		} catch (e) {
			console.error('Failed to load sets:', e);
			sets = [];
		}
	}

	function applySet(set: SocialMediaSet) {
		selectedAccountIds = set.accounts.map((a) => a.social_account_id);
		scheduleAutoSave();
	}

	function handleWorkspaceChange(value: string) {
		selectedWorkspaceId = value;
		selectedSetId = null;
		variants = new Map();
		activeVariantAccountId = null;
		loadAccounts(value);
		loadSets(value);
	}

	function handleSetChange(setId: string | null) {
		selectedSetId = setId;
		if (setId) {
			const set = sets.find((s) => s.id === setId);
			if (set) applySet(set);
		} else {
			selectedAccountIds = accounts.map((a) => a.id);
			scheduleAutoSave();
		}
	}

	function toggleAccount(id: string) {
		if (selectedAccountIds.includes(id)) {
			selectedAccountIds = selectedAccountIds.filter((a) => a !== id);
			if (variants.has(id)) {
				const nextVariants = new Map(variants);
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
	}

	function selectAllAccounts() {
		selectedAccountIds = accounts.map((a) => a.id);
		scheduleAutoSave();
	}

	function clearAllAccounts() {
		selectedAccountIds = [];
		scheduleAutoSave();
	}

	// --------------------------------------------------------------------------
	// Draft saving
	// --------------------------------------------------------------------------
	function scheduleAutoSave() {
		if (autoSaveTimer) clearTimeout(autoSaveTimer);
		autoSaveTimer = setTimeout(() => {
			if (!hasContent) return;
			const snapshot = getSaveSnapshot();
			if (snapshot !== lastSavedSnapshot) {
				saveDraft();
			}
		}, 2000);
	}

	async function saveDraft() {
		if (!selectedWorkspaceId || !hasContent) return;
		isSaving = true;
		error = '';

		try {
			// Threads: store the encoded draft in the new dedicated
			// `thread_draft` field, and put the first post's text in
			// `content` so the parent row still carries a meaningful
			// preview. The backend is the source of truth on the
			// server side; the prefix is no longer stored on the
			// post row.
			const isThreadDraft_ = isThread;
			const threadDraft = isThreadDraft_
				? encodeThreadDraft(posts, getVariantPayloadForSave())
				: null;
			const draftContent = posts[0].content;
			const draftMediaIds = isThreadDraft_ ? posts.flatMap((p) => p.mediaIds) : posts[0].mediaIds;

			const defaultDelay = workspaceCtx.settings.random_delay_minutes;
			const body = {
				workspace_id: selectedWorkspaceId,
				content: draftContent,
				social_account_ids: selectedAccountIds,
				media_ids: draftMediaIds,
				random_delay_minutes: defaultDelay,
				...(threadDraft ? { thread_draft: threadDraft } : {})
			};
			if (draftId) {
				const { error: patchErr } = await (client as any).PATCH('/posts/{id}', {
					params: { path: { id: draftId } },
					body: {
						content: draftContent,
						scheduled_at: '',
						social_account_ids: selectedAccountIds,
						media_ids: draftMediaIds,
						random_delay_minutes: defaultDelay,
						...(threadDraft ? { thread_draft: threadDraft } : {})
					}
				});
				if (patchErr) throw new Error((patchErr as any).detail || 'Failed to update draft');
			} else {
				const { data, error: postErr } = await client.POST('/posts', { body });
				if (postErr) throw new Error((postErr as any).detail || 'Failed to save draft');
				if (data?.id) draftId = data.id;
			}

			if (draftId && !isThread) {
				await persistVariants(draftId);
			}

			lastSavedSnapshot = getSaveSnapshot();
			ui.triggerRefresh();
		} catch (e) {
			console.error('Failed to auto-save draft:', e);
			error = (e as Error).message || 'Failed to save draft';
		} finally {
			isSaving = false;
		}
	}

	// --------------------------------------------------------------------------
	// Publishing
	// --------------------------------------------------------------------------
	async function publish(publishNow: boolean = false) {
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

		let scheduledAt: string | undefined;
		if (publishNow) {
			scheduledAt = new Date().toISOString();
		} else {
			scheduledAt = getScheduledAt();
			if (!scheduledAt) {
				error = m.compose_select_date_time();
				return;
			}
		}

		const randomDelay = publishNow ? 0 : workspaceCtx.settings.random_delay_minutes;
		isSubmitting = true;

		try {
			if (isThread) {
				const validPosts = posts.filter(
					(p) => p.content.trim().length > 0 || p.mediaIds.length > 0
				);
				if (validPosts.length < 2) {
					error = m.compose_thread_minimum();
					isSubmitting = false;
					return;
				}

				const { data, error: err } = await client.POST('/posts/thread' as any, {
					body: {
						workspace_id: selectedWorkspaceId,
						social_account_ids: selectedAccountIds,
						scheduled_at: scheduledAt,
						random_delay_minutes: randomDelay,
						posts: validPosts.map((p) => ({
							content: p.content,
							media_ids: p.mediaIds
						}))
					}
				});
				if (err) throw new Error((err as any).detail || 'Failed to create thread');
				if (data?.post_ids && variants.size > 0) {
					await persistThreadVariants(data.post_ids, validPosts);
				}
			} else {
				const postId = draftId;
				// Always explicitly clear any leftover thread_draft on the
				// server side. We send an empty string so the backend
				// upsert removes the row. This covers the case where a
				// user had a multi-post thread draft, removed posts until
				// only one was left, and is now publishing a single post.
				const clearThreadDraft = isThread ? undefined : '';
				if (postId) {
					const { error: patchErr } = await (client as any).PATCH('/posts/{id}', {
						params: { path: { id: postId } },
						body: {
							content: posts[0].content,
							scheduled_at: scheduledAt,
							social_account_ids: selectedAccountIds,
							media_ids: posts[0].mediaIds,
							random_delay_minutes: randomDelay,
							...(clearThreadDraft !== undefined ? { thread_draft: clearThreadDraft } : {})
						}
					});
					if (patchErr) throw new Error((patchErr as any).detail || 'Failed to update post');
				} else {
					const { data, error: postErr } = await client.POST('/posts', {
						body: {
							workspace_id: selectedWorkspaceId,
							content: posts[0].content,
							social_account_ids: selectedAccountIds,
							scheduled_at: scheduledAt,
							media_ids: posts[0].mediaIds,
							random_delay_minutes: randomDelay
						}
					});
					if (postErr) throw new Error((postErr as any).detail || 'Failed to create post');
					if (data?.id) draftId = data.id;
				}

				if (draftId) {
					await persistVariants(draftId);
				}
			}

			success = publishNow ? m.compose_publishing_now() : m.compose_scheduled_success();
			ui.triggerRefresh();

			if (isEditMode && onSuccess) {
				setTimeout(() => onSuccess(), 800);
			} else {
				posts = [makeEmptyPost()];
				activePostIndex = 0;
				draftId = null;
				lastSavedSnapshot = '';
				variants = new Map();
				activeVariantAccountId = null;
				setTimeout(() => (success = ''), 3000);
			}
		} catch (e) {
			error = (e as Error).message || 'Failed to publish';
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
		try {
			for (const file of Array.from(files)) {
				if (!file.type.startsWith('image/') && !file.type.startsWith('video/')) continue;
				const targetPost = posts[targetPostIndex];
				if (!targetPost) break;
				if (getEditorMediaIdsForPost(targetPost).length >= 4) break;

				const formData = new FormData();
				formData.append('file', file);
				formData.append('workspace_id', selectedWorkspaceId);

				const token = getToken();
				const resp = await fetch(`${getApiBase()}/media/upload`, {
					method: 'POST',
					headers: token ? { Authorization: `Bearer ${token}` } : {},
					body: formData
				});

				const data = await resp.json();
				if (resp.ok) {
					if (data.mime_type) {
						const nextMimeTypes = new Map(mediaMimeTypes);
						nextMimeTypes.set(data.id, data.mime_type);
						mediaMimeTypes = nextMimeTypes;
					}
					addMediaToPost(targetPostIndex, data.id);
					scheduleAutoSave();
				} else {
					error = data.error || 'Failed to upload media';
				}
			}
		} catch (e) {
			console.error('Failed to upload media:', e);
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
			const newAlts = new Map(mediaAltTexts);
			newAlts.delete(mediaId);
			mediaAltTexts = newAlts;
			const newMimeTypes = new Map(mediaMimeTypes);
			newMimeTypes.delete(mediaId);
			mediaMimeTypes = newMimeTypes;
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
		const newVariants = new Map(variants);
		const current = {
			...normalizeVariantRecord(newVariants.get(accountId), posts),
			[postKey]: {
				content: getVariantContent(accountId, postKey) ?? posts[index].content,
				mediaIds
			}
		};
		newVariants.set(accountId, current);
		variants = newVariants;
	}

	function setMediaAltText(mediaId: string, alt: string) {
		const newAlts = new Map(mediaAltTexts);
		if (alt.trim()) {
			newAlts.set(mediaId, alt.trim());
		} else {
			newAlts.delete(mediaId);
		}
		mediaAltTexts = newAlts;

		// Persist to backend
		(client as any)
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
			const { data, error: err } = await (client as any).GET('/prompts/random', {
				params: { query: { workspace_id: selectedWorkspaceId } }
			});
			if (err) throw err;
			if (data) {
				currentPrompt = { text: data.text, category: data.category };
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

	// --------------------------------------------------------------------------
	// Variants
	// --------------------------------------------------------------------------
	function handleVariantChange(accountId: string, index: number, value: string) {
		const newVariants = new Map(variants);
		const postKey = posts[index]?.key;
		if (!postKey) return;
		const current = {
			...normalizeVariantRecord(newVariants.get(accountId), posts),
			[postKey]: {
				content: value,
				mediaIds: getVariantMediaIds(accountId, postKey) ?? [...posts[index].mediaIds]
			}
		};
		newVariants.set(accountId, current);
		variants = newVariants;
		scheduleAutoSave();
	}

	async function loadVariants(postId: string) {
		try {
			const { data, error: err } = await (client as any).GET('/posts/{id}/variants', {
				params: { path: { id: postId } }
			});
			if (err) throw err;
			const nextVariants = new Map<string, Record<string, VariantPost>>();
			const variantMediaIds = new Set<string>();
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
							mediaIds
						}
					});
				}
			}
			variants = nextVariants;

			// Fetch MIME types for variant-only media IDs not already in mediaMimeTypes
			const missingIds = [...variantMediaIds].filter((id) => !mediaMimeTypes.has(id));
			if (missingIds.length > 0) {
				const token = getToken();
				const resp = await fetch(
					`${getApiBase()}/api/v1/media/metadata?workspace_id=${encodeURIComponent(
						initialPost?.workspace_id ?? ''
					)}&media_ids=${encodeURIComponent(missingIds.join(','))}`,
					{
						headers: token ? { Authorization: `Bearer ${token}` } : {}
					}
				);
				if (resp.ok) {
					const mediaData = await resp.json();
					const nextMimeTypes = new Map(mediaMimeTypes);
					for (const m of mediaData.media ?? []) {
						if (m.mime_type) {
							nextMimeTypes.set(m.id, m.mime_type);
						}
					}
					mediaMimeTypes = nextMimeTypes;
				}
			}
		} catch (e) {
			console.error('Failed to load variants:', e);
			variants = new Map();
		}
	}

	async function persistVariants(postId: string) {
		if (isThread) return;

		const { error: deleteErr } = await (client as any).DELETE('/posts/{id}/variants', {
			params: { path: { id: postId } }
		});
		if (deleteErr) {
			throw new Error((deleteErr as any).detail || 'Failed to reset variants');
		}

		if (variants.size === 0) return;

		const variantPayload = Array.from(variants.entries()).map(([accountId, values]) => ({
			social_account_id: accountId,
			content: values[posts[0]?.key ?? '']?.content ?? posts[0]?.content ?? '',
			media_ids: JSON.stringify(values[posts[0]?.key ?? '']?.mediaIds ?? posts[0]?.mediaIds ?? []),
			is_unsynced: true
		}));
		const { error: upsertErr } = await (client as any).PUT('/posts/{id}/variants', {
			params: { path: { id: postId } },
			body: { variants: variantPayload }
		});
		if (upsertErr) {
			throw new Error((upsertErr as any).detail || 'Failed to save variants');
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

	function resyncAccount(accountId: string) {
		if (!variants.has(accountId)) return;
		const nextVariants = new Map(variants);
		nextVariants.delete(accountId);
		variants = nextVariants;
		activeVariantAccountId = null;
		scheduleAutoSave();
	}

	async function persistThreadVariants(postIds: string[], sourcePosts: PostItem[]) {
		for (let index = 0; index < postIds.length; index++) {
			const postKey = sourcePosts[index]?.key;
			if (!postKey) continue;
			const payload = Array.from(variants.entries()).map(([accountId, values]) => ({
				social_account_id: accountId,
				content: values[postKey]?.content ?? sourcePosts[index]?.content ?? '',
				media_ids: JSON.stringify(values[postKey]?.mediaIds ?? sourcePosts[index]?.mediaIds ?? []),
				is_unsynced: true
			}));
			if (payload.length === 0) continue;
			const { error: upsertErr } = await (client as any).PUT('/posts/{id}/variants', {
				params: { path: { id: postIds[index] } },
				body: { variants: payload }
			});
			if (upsertErr) {
				throw new Error((upsertErr as any).detail || 'Failed to save thread variants');
			}
		}
	}

	// --------------------------------------------------------------------------
	// Scheduling
	// --------------------------------------------------------------------------
	async function suggestNextSlot() {
		if (!selectedWorkspaceId) return;
		suggestingSlot = true;
		try {
			const { data, error: err } = await (client as any).GET('/posting-schedules/next-slot', {
				params: { query: { workspace_id: selectedWorkspaceId } }
			});
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
				const slotDateTime = selectedDate.toDate(getLocalTimeZone());
				slotDateTime.setHours(rawHours, rawMinutes, 0, 0);
				if (slotDateTime.getTime() <= Date.now()) {
					selectedDate = selectedDate.add({ days: 1 });
				}
			}
		} catch (e) {
			console.error('Failed to get next available slot:', e);
		} finally {
			suggestingSlot = false;
		}
	}

	function formatScheduledDisplay(): string {
		if (!selectedDate || !selectedTime) return m.compose_schedule();
		const now = today(getLocalTimeZone());
		const diffDays = selectedDate.compare(now);

		if (diffDays === 0) return `${m.common_today()} ${selectedTime}`;
		if (diffDays === 1) return `${m.common_tomorrow()} ${selectedTime}`;
		const date = selectedDate.toDate(getLocalTimeZone());
		return `${date.toLocaleDateString(getLocaleTag(), { month: 'short', day: 'numeric' })} ${selectedTime}`;
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
	<div class="flex flex-wrap items-center justify-between gap-2 border-b px-3 py-2 md:px-4 md:py-3">
		<div class="flex flex-wrap items-center gap-2">
			{#if isEditMode && onCancel}
				<Button variant="ghost" size="sm" class="text-xs" onclick={onCancel}
					>{m.common_back()}</Button
				>
			{/if}

			<!-- Workspace selector -->
			{#if workspaces.length > 1}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="sm" class="gap-1 text-xs">
								<span class="hidden text-muted-foreground sm:inline">
									{workspaces.find((w) => w.id === selectedWorkspaceId)?.name ??
										m.compose_workspace()}
								</span>
								<span class="text-muted-foreground sm:hidden">
									{workspaces
										.find((w) => w.id === selectedWorkspaceId)
										?.name?.slice(0, 2)
										.toUpperCase() ?? 'WS'}
								</span>
								<ChevronDownIcon class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-52" align="start">
						<DropdownMenu.Label class="text-xs tracking-wider text-muted-foreground uppercase"
							>{m.compose_workspace()}</DropdownMenu.Label
						>
						<DropdownMenu.Separator />
						{#each workspaces as ws (ws.id)}
							<DropdownMenu.Item
								onclick={() => handleWorkspaceChange(ws.id)}
								class="gap-2 {selectedWorkspaceId === ws.id ? 'bg-muted' : ''}"
							>
								<div
									class="flex h-6 w-6 items-center justify-center rounded-md bg-primary/10 text-xs font-bold text-primary"
								>
									{ws.name.slice(0, 2).toUpperCase()}
								</div>
								<span class="text-sm">{ws.name}</span>
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}

			<!-- Set selector -->
			{#if sets.length > 0}
				<div class="h-4 w-px bg-border"></div>
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="sm" class="gap-1 text-xs">
								<span class="text-muted-foreground"
									>{sets.find((s) => s.id === selectedSetId)?.name ?? m.common_all()}</span
								>
								<ChevronDownIcon class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-56" align="start">
						<DropdownMenu.Label class="text-xs tracking-wider text-muted-foreground uppercase"
							>{m.compose_social_set()}</DropdownMenu.Label
						>
						<DropdownMenu.Separator />
						<DropdownMenu.Item
							onclick={() => handleSetChange(null)}
							class="gap-2 {selectedSetId === null ? 'bg-muted' : ''}"
						>
							<div class="flex h-6 w-6 items-center justify-center rounded-full bg-muted">
								<span class="text-xs">{m.common_all()}</span>
							</div>
							<span class="text-sm">{m.compose_all_accounts()}</span>
						</DropdownMenu.Item>
						{#each sets as set (set.id)}
							<DropdownMenu.Item
								onclick={() => handleSetChange(set.id)}
								class="gap-2 {selectedSetId === set.id ? 'bg-muted' : ''}"
							>
								<div
									class="flex h-6 w-6 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary"
								>
									{set.name.slice(0, 2).toUpperCase()}
								</div>
								<div class="flex flex-col">
									<span class="text-sm">{set.name}</span>
									<span class="text-xs text-muted-foreground"
										>{set.accounts.length} account{set.accounts.length !== 1 ? 's' : ''}</span
									>
								</div>
								{#if set.is_default}<span class="ml-auto text-xs text-muted-foreground"
										>Default</span
									>{/if}
							</DropdownMenu.Item>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}

			<!-- Account selector -->
			{#if accounts.length > 0}
				<DropdownMenu.Root>
					<DropdownMenu.Trigger>
						{#snippet child({ props })}
							<Button {...props} variant="ghost" size="sm" class="gap-1.5 text-xs">
								<span class="hidden text-muted-foreground sm:inline">
									{selectedAccountIds.length === accounts.length
										? m.compose_all_accounts()
										: `${selectedAccountIds.length} account${selectedAccountIds.length !== 1 ? 's' : ''}`}
								</span>
								<span class="text-muted-foreground sm:hidden"
									>{selectedAccountIds.length}/{accounts.length}</span
								>
								<ChevronDownIcon class="h-3 w-3" />
							</Button>
						{/snippet}
					</DropdownMenu.Trigger>
					<DropdownMenu.Content class="w-64" align="start">
						<div class="flex items-center justify-between px-2 py-1.5">
							<span class="text-sm font-medium text-muted-foreground">{m.compose_publish_to()}</span
							>
							<div class="flex gap-1">
								<Button variant="ghost" size="xs" onclick={selectAllAccounts} class="h-5 text-xs"
									>{m.common_all()}</Button
								>
								<Button variant="ghost" size="xs" onclick={clearAllAccounts} class="h-5 text-xs"
									>{m.common_none()}</Button
								>
							</div>
						</div>
						<DropdownMenu.Separator />
						{#each accounts as account (account.id)}
							{@const isSelected = selectedAccountIds.includes(account.id)}
							{@const isUnsynced = variants.has(account.id)}
							<DropdownMenu.CheckboxItem
								checked={isSelected}
								onCheckedChange={() => toggleAccount(account.id)}
								class="gap-2"
							>
								<PlatformIcon platform={getPlatformKey(account.platform)} class="h-4 w-4" />
								<div class="flex flex-1 items-center gap-1.5">
									<span class="text-sm">{getPlatformName(account.platform)}</span>
									{#if account.account_username}<span class="text-xs text-muted-foreground"
											>@{account.account_username}</span
										>{/if}
								</div>
								{#if isUnsynced}<span class="text-xs text-amber-500">{m.compose_custom()}</span
									>{/if}
							</DropdownMenu.CheckboxItem>
						{/each}
					</DropdownMenu.Content>
				</DropdownMenu.Root>
			{/if}
		</div>

		<div class="flex flex-wrap items-center gap-1.5 md:gap-2">
			<!-- Mobile preview toggle -->
			{#if selectedAccounts.length > 0}
				<Button
					variant="ghost"
					size="icon"
					class="h-8 w-8 lg:hidden"
					onclick={() => (showMobilePreview = true)}
					title={m.compose_show_preview()}
				>
					<EyeIcon class="h-4 w-4" />
				</Button>

				<div
					class="flex max-w-[min(62vw,30rem)] items-center gap-1 overflow-x-auto overflow-y-hidden py-1 pr-2 pl-1 [-ms-overflow-style:none] [scrollbar-width:none] sm:max-w-[min(58vw,34rem)] lg:max-w-[40rem] lg:pr-3 [&::-webkit-scrollbar]:hidden"
				>
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border transition-colors {activeVariantAccountId ===
									null
										? 'border-foreground bg-foreground text-background'
										: 'border-border bg-background text-foreground hover:border-foreground/30'}"
									onclick={() => activateVariantTab(null)}
									title={m.compose_all_synced()}
								>
									<Link2Icon class="h-3.5 w-3.5" />
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content><p class="text-sm">{m.compose_all_synced()}</p></Tooltip.Content>
					</Tooltip.Root>

					{#each selectedAccounts as account (account.id)}
						{@const isUnsynced = variants.has(account.id)}
						{@const accountCanUnsync = canUnsyncAccount(account)}
						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<button
										{...props}
										type="button"
										class="relative z-0 flex h-8 w-8 shrink-0 items-center justify-center overflow-visible rounded-full border transition-colors {activeVariantAccountId ===
										account.id
											? isUnsynced
												? 'border-amber-500/70 bg-amber-500/12 text-amber-700'
												: 'border-foreground bg-foreground text-background'
											: 'border-border bg-background text-foreground hover:border-foreground/30'} {!accountCanUnsync
											? 'opacity-55'
											: ''}"
										onclick={() => activateVariantTab(accountCanUnsync ? account.id : null)}
										title={getPlatformName(account.platform)}
									>
										<PlatformIcon platform={getPlatformKey(account.platform)} class="h-3.5 w-3.5" />
										{#if isUnsynced}
											<span
												class="absolute -right-1 -bottom-1 z-10 flex h-3.5 w-3.5 items-center justify-center rounded-full bg-amber-500 text-white shadow-sm ring-2 ring-background"
											>
												<UnlinkIcon class="h-2 w-2" />
											</span>
										{/if}
									</button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>
								<p class="text-sm">
									{#if accountCanUnsync}
										{getPlatformName(account.platform)}{account.account_username
											? ` @${account.account_username}`
											: ''}{isUnsynced
											? ` · ${m.compose_custom_state()}`
											: ` · ${m.compose_synced_state()}`}
									{:else}
										{m.compose_thread_reply_limited({
											platform: getPlatformName(account.platform)
										})}
									{/if}
								</p>
							</Tooltip.Content>
						</Tooltip.Root>
					{/each}
				</div>

				{#if activeVariantAccount && canUnsyncAccount(activeVariantAccount)}
					<Tooltip.Root>
						<Tooltip.Trigger>
							{#snippet child({ props })}
								<button
									{...props}
									type="button"
									class="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-background text-foreground transition-colors hover:border-foreground/30"
									onclick={() =>
										activeVariantIsUnsynced
											? resyncAccount(activeVariantAccount.id)
											: unsyncAccount(activeVariantAccount.id)}
									title={activeVariantIsUnsynced ? m.compose_sync_back() : m.compose_unsync()}
								>
									{#if activeVariantIsUnsynced}
										<Link2Icon class="h-3.5 w-3.5" />
									{:else}
										<UnlinkIcon class="h-3.5 w-3.5" />
									{/if}
								</button>
							{/snippet}
						</Tooltip.Trigger>
						<Tooltip.Content>
							<p class="text-sm">
								{activeVariantIsUnsynced ? m.compose_sync_back() : m.compose_unsync()}
							</p>
						</Tooltip.Content>
					</Tooltip.Root>
				{/if}
			{/if}

			<!-- Prompt -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="icon"
							class="h-8 w-8 {showPromptCard ? 'text-amber-500' : ''}"
							onclick={() => (showPromptCard ? dismissPrompt() : fetchRandomPrompt())}
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

			<!-- Suggest next slot -->
			<Tooltip.Root>
				<Tooltip.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="ghost"
							size="sm"
							class="h-8 gap-1 text-xs"
							onclick={suggestNextSlot}
							disabled={suggestingSlot || isSubmitting}
						>
							{#if suggestingSlot}<span
									class="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current"
								></span>{:else}<ShuffleIcon class="h-3 w-3" />{/if}
							<span class="hidden sm:inline">{m.compose_suggest()}</span>
						</Button>
					{/snippet}
				</Tooltip.Trigger>
				<Tooltip.Content><p class="text-sm">{m.compose_fill_next_slot()}</p></Tooltip.Content>
			</Tooltip.Root>

			<!-- Schedule picker -->
			<Popover.Root bind:open={showSchedulePopover}>
				<Popover.Trigger>
					{#snippet child({ props })}
						<Button
							{...props}
							variant="outline"
							size="sm"
							class="gap-1.5 text-xs"
							disabled={isSubmitting || !hasContent}
						>
							<ClockIcon class="h-3.5 w-3.5" />
							<span class="hidden sm:inline">{formatScheduledDisplay()}</span>
						</Button>
					{/snippet}
				</Popover.Trigger>
				<Popover.Content class="w-auto max-w-[calc(100vw-2rem)] p-0" align="end">
					<div class="p-3 md:p-4">
						<div class="mb-3 flex items-center justify-between">
							<span class="text-sm font-medium">{m.compose_schedule()}</span>
						</div>
						<Calendar
							type="single"
							bind:value={selectedDate}
							minValue={today(getLocalTimeZone())}
							class="bg-transparent p-0 [--cell-size:--spacing(8)]"
							weekdayFormat="short"
							weekStartsOn={workspaceCtx.weekStartsOn}
						/>
						<div class="mt-3 max-h-48 overflow-y-auto">
							<div class="grid grid-cols-3 gap-1.5 sm:grid-cols-4">
								{#each timeSlots as time (time)}
									<Button
										variant={selectedTime === time ? 'default' : 'outline'}
										size="sm"
										onclick={() => {
											selectedTime = time;
											showSchedulePopover = false;
										}}
										class="h-8 text-xs"
									>
										{time}
									</Button>
								{/each}
							</div>
						</div>
					</div>
				</Popover.Content>
			</Popover.Root>

			<!-- Schedule button -->
			<Button
				size="sm"
				class="gap-1.5"
				onclick={() => publish(false)}
				disabled={isSubmitting || !hasContent || selectedAccountIds.length === 0}
			>
				{#if isSubmitting}<LoaderIcon class="h-3.5 w-3.5 animate-spin" />{:else}<SendIcon
						class="h-3.5 w-3.5"
					/>{/if}
				<span class="hidden sm:inline">{m.compose_schedule()}</span>
			</Button>

			<!-- Publish now -->
			<Button
				size="sm"
				variant="secondary"
				onclick={() => publish(true)}
				disabled={isSubmitting || !hasContent || selectedAccountIds.length === 0}
				class="gap-1.5"
			>
				{#if isSubmitting}<LoaderIcon class="h-3.5 w-3.5 animate-spin" />{/if}
				<span class="hidden sm:inline">{m.compose_publish_now()}</span>
				<span class="sm:hidden">{m.compose_publish_now()}</span>
			</Button>
		</div>
	</div>

	<!-- ====================================================================== -->
	<!-- Messages -->
	<!-- ====================================================================== -->
	{#if error}
		<div
			class="mx-3 mt-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive md:mx-4 md:mt-3"
		>
			{error}
		</div>
	{/if}
	{#if success}
		<div
			class="mx-3 mt-2 rounded-md border border-green-500/20 bg-green-500/10 px-3 py-2 text-sm text-green-600 md:mx-4 md:mt-3"
		>
			{success}
		</div>
	{/if}
	{#if mediaCapabilityWarnings.length > 0}
		<div
			class="mx-3 mt-2 rounded-md border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 md:mx-4 md:mt-3 dark:text-amber-300"
		>
			<div class="font-medium">Media compatibility warning</div>
			<ul class="mt-1 list-disc space-y-0.5 pl-4">
				{#each mediaCapabilityWarnings as warning (warning)}
					<li>{warning}</li>
				{/each}
			</ul>
		</div>
	{/if}

	<!-- ====================================================================== -->
	<!-- Main Content Area -->
	<!-- ====================================================================== -->
	<div class="flex flex-1 overflow-hidden">
		<!-- Compose Column -->
		<div class="flex flex-1 flex-col overflow-y-auto">
			<div class="mx-auto w-full max-w-2xl px-3 py-4 md:px-6 md:py-6">
				<!-- Prompt Card -->
				{#if showPromptCard}
					<div class="relative mb-5 rounded border bg-muted/30 p-4">
						<div class="absolute top-2 right-2 flex items-center gap-1">
							<button
								type="button"
								class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onclick={fetchRandomPrompt}
								disabled={loadingPrompt}
								title={m.compose_shuffle()}
							>
								<ShuffleIcon class="h-3.5 w-3.5" />
							</button>
							<button
								type="button"
								class="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
								onclick={dismissPrompt}
								title={m.compose_close()}
							>
								<XIcon class="h-3.5 w-3.5" />
							</button>
						</div>
						{#if loadingPrompt}
							<div class="space-y-2 py-2">
								<Skeleton class="h-3 w-full" />
								<Skeleton class="h-3 w-3/4" />
							</div>
						{:else if currentPrompt}
							<p class="text-sm leading-relaxed text-foreground/80">{currentPrompt.text}</p>
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
								aria-label="Drop zone for post {i + 1}"
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
												class="drag-handle -ml-4 cursor-grab rounded p-0.5 text-muted-foreground opacity-0 transition-opacity group-hover/post:opacity-60 hover:opacity-100 active:cursor-grabbing"
												title="Drag to reorder"
											>
												<GripVerticalIcon class="h-4 w-4" />
											</button>
										</div>
									{/if}

									<div class="min-w-0 flex-1">
										<div class="relative">
											<textarea
												id="post-textarea-{i}"
												use:textareaAction={i}
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
														? m.compose_write_custom_version({
																platform: getPlatformName(activeVariantAccount?.platform ?? '')
															})
														: m.compose_unsync_to_edit_placeholder()
													: i === 0
														? m.compose_whats_on_your_mind()
														: m.compose_add_to_thread()}
												class="w-full resize-none border-0 bg-transparent py-2 pr-3 text-base leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:ring-0 focus:outline-none md:py-3 md:pr-4 md:text-lg"
												style="min-height: {i === 0 ? '120px' : '56px'};"
												disabled={isSubmitting ||
													(!!activeVariantAccountId && !activeVariantIsUnsynced)}
											></textarea>

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
															class="absolute inset-0 flex items-start justify-end gap-1 bg-black/0 p-2 opacity-0 transition-all group-hover/media:bg-black/40 group-hover/media:opacity-100"
														>
															<button
																type="button"
																class="rounded-md bg-black/60 px-2 py-1 text-xs text-white backdrop-blur-sm transition-colors hover:bg-black/80"
																onclick={(e) => {
																	e.stopPropagation();
																	editingAltMediaId =
																		editingAltMediaId === mediaId ? null : mediaId;
																}}
															>
																<TypeIcon class="h-3 w-3" />
															</button>
															<button
																type="button"
																class="rounded-md bg-black/60 p-1 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80"
																onclick={(e) => {
																	e.stopPropagation();
																	removeMedia(i, mi);
																}}
															>
																<XIcon class="h-3 w-3" />
															</button>
														</div>
														{#if editingAltMediaId === mediaId}
															<div
																class="absolute inset-x-0 bottom-0 bg-black/70 p-2 backdrop-blur-sm"
															>
																<textarea
																	value={mediaAltTexts.get(mediaId) || ''}
																	oninput={(e) =>
																		setMediaAltText(
																			mediaId,
																			(e.target as HTMLTextAreaElement).value
																		)}
																	placeholder="Alt text..."
																	rows={2}
																	class="w-full resize-none rounded bg-white/10 px-2 py-1 text-xs text-white placeholder:text-white/50 focus:outline-none"
																></textarea>
																<div class="mt-1 flex justify-end gap-1">
																	<button
																		type="button"
																		class="text-[10px] text-white/70 hover:text-white"
																		onclick={() => (editingAltMediaId = null)}>Done</button
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
													class="text-[10px] font-medium text-muted-foreground/60 tabular-nums"
													>#{i + 1}</span
												>{/if}

											<label
												class={activeVariantAccountId && !activeVariantIsUnsynced
													? 'cursor-not-allowed opacity-50'
													: 'cursor-pointer'}
											>
												<input
													type="file"
													accept="image/*,video/*"
													multiple
													disabled={!!activeVariantAccountId && !activeVariantIsUnsynced}
													class="hidden"
													onchange={(e) => {
														const target = e.target as HTMLInputElement;
														if (target.files) handleFileUpload(target.files, i);
													}}
												/>
												<div
													class="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
												>
													<ImageIcon class="h-3.5 w-3.5" />
												</div>
											</label>

											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<div {...props} class="flex cursor-default items-center gap-1.5">
															<svg
																class="h-4 w-4 {getCharCounterColor(
																	getEditorContentForPost(post).length,
																	editorMaxChars
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
																		getEditorContentForPost(post).length,
																		editorMaxChars
																	)}
																	stroke-width="2.5"
																	stroke-linecap="round"
																	stroke-dasharray={50.27}
																	stroke-dashoffset={50.27 *
																		Math.max(
																			0,
																			1 - getEditorContentForPost(post).length / editorMaxChars
																		)}
																	transform="rotate(-90 10 10)"
																/>
															</svg>
															<span class="text-[10px] text-muted-foreground/60 tabular-nums"
																>{getEditorContentForPost(post).length}/{editorMaxChars}</span
															>
														</div>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content class="min-w-32">
													<div class="space-y-1">
														<p class="text-xs font-medium text-muted-foreground">
															Character limits
														</p>
														{#each editorPlatformLimits as pl (pl.key)}
															<div class="flex items-center justify-between gap-3 text-xs">
																<div class="flex items-center gap-1.5">
																	<PlatformIcon platform={pl.key} class="h-3 w-3" /><span
																		>{pl.platform}</span
																	>
																</div>
																<span
																	class="tabular-nums {getEditorContentForPost(post).length >
																	pl.limit
																		? 'text-red-500'
																		: 'text-muted-foreground'}"
																	>{getEditorContentForPost(post).length}/{pl.limit}</span
																>
															</div>
														{/each}
													</div>
												</Tooltip.Content>
											</Tooltip.Root>

											<button
												type="button"
												class="flex items-center gap-1.5 text-xs text-muted-foreground/60 transition-colors hover:text-foreground"
												onclick={addPost}
											>
												<PlusIcon class="h-3 w-3" />{m.compose_add_post()}
											</button>
										</div>

										{#if isThread}
											<button
												type="button"
												class="absolute top-3 right-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity group-hover/post:opacity-100 hover:bg-muted hover:text-destructive"
												onclick={() => removePost(i)}
												title="Remove post"
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

		<!-- Preview Column -->
		{#if showPreview && selectedAccounts.length > 0}
			<div class="hidden w-[420px] border-l bg-muted/20 px-6 py-6 lg:block">
				<div class="sticky top-6">
					<div class="mb-4 flex items-center justify-between">
						<span class="text-xs font-medium tracking-wider text-muted-foreground uppercase"
							>Preview</span
						>
						<button
							type="button"
							class="text-xs text-muted-foreground hover:text-foreground"
							onclick={() => (showPreview = false)}>{m.compose_hide()}</button
						>
					</div>
					<ComposePreviewPanel groups={previewGroups} />
				</div>
			</div>
		{:else if !showPreview && selectedAccounts.length > 0}
			<div
				class="hidden w-10 border-l bg-muted/20 lg:flex lg:items-start lg:justify-center lg:pt-4"
			>
				<button
					type="button"
					class="text-muted-foreground hover:text-foreground"
					onclick={() => (showPreview = true)}
					title={m.compose_show_preview()}
				>
					<PlatformIcon platform={getPlatformKey(selectedAccounts[0].platform)} class="h-4 w-4" />
				</button>
			</div>
		{/if}
	</div>
</div>

<!-- ====================================================================== -->
<!-- Mobile Preview Sheet -->
<!-- ====================================================================== -->
<Sheet.Root bind:open={showMobilePreview}>
	<Sheet.Content side="bottom" class="h-[85vh] rounded-t-xl p-0">
		<Sheet.Header class="border-b px-4 py-3">
			<Sheet.Title class="text-sm font-medium">Preview</Sheet.Title>
		</Sheet.Header>
		<div class="overflow-y-auto px-4 py-4">
			<ComposePreviewPanel groups={previewGroups} />
		</div>
	</Sheet.Content>
</Sheet.Root>
