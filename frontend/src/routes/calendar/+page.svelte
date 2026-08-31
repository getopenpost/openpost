<script lang="ts">
	import { goto } from '$app/navigation';
	import { onDestroy, untrack } from 'svelte';
	import { SvelteDate, SvelteMap, SvelteSet } from 'svelte/reactivity';
	import { resolve } from '$app/paths';
	import { resolveAppPath } from '$lib/app-path';
	import { client, type SocialAccount } from '$lib/api/client';
	import { loadWorkspaceAccounts } from '$lib/api/performance-cache';
	import type { components } from '$lib/api/types';
	import { publicationCalendarOccurrence } from '$lib/publication-calendar';
	import CalendarDragOverlay from '$lib/calendar/calendar-drag-overlay.svelte';
	import {
		resolveWeekCalendarTarget,
		WeekCalendarDragController,
		type WeekCalendarTarget
	} from '$lib/calendar/calendar-drag';
	import {
		isFutureSchedule,
		workspaceClock,
		workspaceDateKeyFromISO,
		workspaceScheduleMoveToDate,
		workspaceScheduleToISO
	} from '$lib/components/compose/schedule-timezone';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import PageHeader from '$lib/components/page-header.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import * as Select from '$lib/components/ui/select';
	import * as Sheet from '$lib/components/ui/sheet';
	import * as Tooltip from '$lib/components/ui/tooltip';
	import { getLocaleTag } from '$lib/i18n';
	import { formatSocialAccountName } from '$lib/utils';
	import { workspaceColor } from '$lib/workspace-color';
	import { m } from '$lib/paraglide/messages';
	import { ui } from '$lib/stores/ui.svelte';
	import { publicationInvalidationForWorkspace } from '$lib/publication-invalidation';
	import { WorkspaceContextError, workspaceCtx } from '$lib/stores/workspace.svelte';
	import { cn } from '$lib/utils';
	import { CalendarDate } from '@internationalized/date';
	import CalendarDaysIcon from '@lucide/svelte/icons/calendar-days';
	import ChevronLeftIcon from '@lucide/svelte/icons/chevron-left';
	import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
	import Loader2Icon from '@lucide/svelte/icons/loader-2';
	import ListIcon from '@lucide/svelte/icons/list';
	import LockIcon from '@lucide/svelte/icons/lock-keyhole';
	import PlusIcon from '@lucide/svelte/icons/plus';
	import RefreshCwIcon from '@lucide/svelte/icons/refresh-cw';
	import Rows3Icon from '@lucide/svelte/icons/rows-3';

	type Publication = components['schemas']['PublicationResponse'];
	type Rendition = components['schemas']['RenditionResponse'];
	type CalendarView = 'month' | 'week';
	type CalendarStatus = 'all' | 'scheduled' | 'published';

	type CalendarDay = {
		date: Date;
		key: string;
		outsideMonth: boolean;
		today: boolean;
	};

	type AccountBadge = {
		id: string;
		platform: string;
		label: string;
	};

	type CalendarItem = {
		id: string;
		key: string;
		href: string;
		title: string;
		status: string;
		occursAt: string;
		movable: boolean;
		workspaceId: string;
		workspaceName: string;
		accounts: AccountBadge[];
		platforms: string[];
		publication?: Publication;
	};

	type WeekDragTarget = WeekCalendarTarget & {
		day: CalendarDay;
	};

	type WeekDragView = {
		item: CalendarItem;
		target: WeekCalendarTarget | null;
		targetLabel: string;
		width: number;
		height: number;
	};

	const WEEK_DRAG_OVERLAY_MIN_WIDTH = 180;
	const WEEK_DRAG_OVERLAY_MAX_WIDTH = 220;
	const WEEK_DRAG_OVERLAY_HEIGHT = 58;
	const WEEK_DRAG_TARGET_HEIGHT = 36;

	let currentMonth = $state(startOfMonth(workspaceTodayDate('UTC')));
	let viewMode = $state<CalendarView>('month');
	let selectedStatus = $state<CalendarStatus>('all');
	let selectedWorkspaceIds = $state<string[]>([]);
	let selectedPlatform = $state('all');
	let publications = $state<Publication[]>([]);
	let accountsByWorkspace = $state<Record<string, SocialAccount[]>>({});
	let loading = $state(true);
	let loadError = $state('');
	let errorMessage = $state('');
	let successMessage = $state('');
	let draggingKey = $state('');
	let dropTargetKey = $state('');
	let reschedulingKey = $state('');
	let weekDragView = $state<WeekDragView | null>(null);
	let weekDragOverlayElement: HTMLDivElement | undefined = $state();
	let weekScrollElement: HTMLElement | undefined = $state();
	let weekBodyElement: HTMLElement | undefined = $state();
	let selectedEmptyDateKey = $state('');
	let selectedMonthDayKey = $state('');
	let monthDayOpen = $state(false);
	let activeRequest = 0;
	let dataRevision = 0;
	let completedLoadKey = $state('');
	let initializedCalendarWorkspace = '';
	let handledInvalidationRevision = 0;
	const weekDragController = new WeekCalendarDragController<CalendarItem, WeekDragTarget>({
		itemKey: (item) => item.key,
		resolveTarget: resolveWeekDragTarget,
		targetKey: (target) => (target ? `${target.day.key}|${target.minutes}` : ''),
		getOverlayElement: () => weekDragOverlayElement,
		getScrollElement: () => weekScrollElement,
		onActivate: ({ item, sourceBounds, target }) =>
			activateWeekDragView(item, sourceBounds, target),
		onTargetChange: updateWeekDragView,
		onDrop: (item, target) => void rescheduleItem(item, target.day.date, target.time),
		onFinish: clearWeekDragView,
		isSameTarget: sameWeekDragSlot
	});

	const workspaces = $derived(workspaceCtx.workspaces);
	const viewerWorkspaceId = $derived(workspaceCtx.currentWorkspace?.id ?? '');
	const viewerTimeZone = $derived(
		workspaceCtx.settingsWorkspaceID === viewerWorkspaceId
			? workspaceCtx.settings.timezone || 'UTC'
			: 'UTC'
	);
	const workspaceTodayKey = $derived(workspaceClock(viewerTimeZone).date.toString());
	const activeWorkspaceIds = $derived.by(() => {
		if (selectedWorkspaceIds.length > 0) return selectedWorkspaceIds;
		return workspaces.map((workspace) => workspace.id);
	});
	const days = $derived.by(() =>
		buildCalendarDays(currentMonth, workspaceCtx.weekStartsOn, workspaceTodayDate(viewerTimeZone))
	);
	const weekDays = $derived.by(() =>
		buildWeekDays(currentMonth, workspaceCtx.weekStartsOn, workspaceTodayDate(viewerTimeZone))
	);
	const displayDays = $derived(viewMode === 'week' ? weekDays : days);
	const visibleRange = $derived(calendarRequestRange(displayDays, viewerTimeZone));
	const loadKey = $derived(
		`${visibleRange.from}|${visibleRange.before}|${activeWorkspaceIds.join(',')}|${workspaces.map((w) => w.id).join(',')}|${viewerTimeZone}`
	);
	const initialLoading = $derived(loading && completedLoadKey !== loadKey);
	const weekdayLabels = $derived.by(() =>
		days.slice(0, 7).map((day) => formatWorkspaceDate(day.date, { weekday: 'short' }))
	);
	const visibleDayKeys = $derived(new SvelteSet(displayDays.map((day) => day.key)));
	const allItems = $derived.by((): CalendarItem[] =>
		publications
			.map(publicationToCalendarItem)
			.filter((item): item is CalendarItem => item !== null)
			.sort(
				(a, b) =>
					new Date(a.occursAt).getTime() - new Date(b.occursAt).getTime() ||
					a.title.localeCompare(b.title)
			)
	);
	const availablePlatforms = $derived.by(() => {
		const platforms = new SvelteSet<string>();
		for (const workspaceId of activeWorkspaceIds) {
			for (const account of accountsByWorkspace[workspaceId] ?? []) {
				if (account.platform) platforms.add(account.platform);
			}
		}
		for (const item of allItems) {
			for (const platform of item.platforms) platforms.add(platform);
		}
		return Array.from(platforms).sort((a, b) => platformLabel(a).localeCompare(platformLabel(b)));
	});
	const visibleItems = $derived.by(() =>
		allItems.filter((item) => {
			const scheduledDay = workspaceDateKeyFromISO(item.occursAt, viewerTimeZone);
			const inVisibleMonth = scheduledDay ? visibleDayKeys.has(scheduledDay) : false;
			const platformMatches =
				selectedPlatform === 'all' || item.platforms.includes(selectedPlatform);
			const statusMatches = selectedStatus === 'all' || item.status === selectedStatus;
			return inVisibleMonth && platformMatches && statusMatches;
		})
	);
	const itemsByDay = $derived.by(() => {
		const map = new SvelteMap<string, CalendarItem[]>();
		for (const item of visibleItems) {
			const key = workspaceDateKeyFromISO(item.occursAt, viewerTimeZone);
			if (!key) continue;
			const existing = map.get(key) ?? [];
			existing.push(item);
			map.set(key, existing);
		}
		return map;
	});
	const selectedMonthDay = $derived(days.find((day) => day.key === selectedMonthDayKey) ?? null);
	const selectedMonthDayItems = $derived(
		selectedMonthDay ? (itemsByDay.get(selectedMonthDay.key) ?? []) : []
	);
	const agendaDays = $derived.by(() =>
		displayDays
			.filter((day) => viewMode === 'week' || !day.outsideMonth)
			.map((day) => ({ day, items: itemsByDay.get(day.key) ?? [] }))
			.filter((entry) => entry.items.length > 0)
	);
	const emptyMonthDays = $derived(
		displayDays.filter(
			(day) =>
				(viewMode === 'week' || !day.outsideMonth) &&
				day.key >= workspaceTodayKey &&
				(itemsByDay.get(day.key)?.length ?? 0) === 0
		)
	);
	const monthAllowsCreate = $derived(
		displayDays.some((day) => (viewMode === 'week' || !day.outsideMonth) && !isPastDay(day))
	);
	const selectedEmptyDay = $derived.by(
		() =>
			emptyMonthDays.find((day) => day.key === selectedEmptyDateKey) ??
			emptyMonthDays.find((day) => day.today) ??
			emptyMonthDays[0] ??
			null
	);
	const weekHours = Array.from({ length: 24 }, (_, hour) => hour);
	const selectedWorkspaceLabel = $derived.by(() => {
		if (selectedWorkspaceIds.length === 0 || selectedWorkspaceIds.length === workspaces.length) {
			return m.calendar_all_workspaces();
		}
		if (selectedWorkspaceIds.length === 1) {
			return workspaceName(selectedWorkspaceIds[0]);
		}
		return m.calendar_workspace_count({ count: selectedWorkspaceIds.length });
	});

	$effect(() => {
		const workspaceKey = workspaceCtx.settingsReady ? `${viewerWorkspaceId}|${viewerTimeZone}` : '';
		if (workspaceKey && workspaceKey !== initializedCalendarWorkspace) {
			initializedCalendarWorkspace = workspaceKey;
			currentMonth = startOfMonth(workspaceTodayDate(viewerTimeZone));
		}
	});

	$effect(() => {
		if (selectedPlatform !== 'all' && !availablePlatforms.includes(selectedPlatform)) {
			selectedPlatform = 'all';
		}
	});

	$effect(() => {
		const validWorkspaceIds = new Set(workspaces.map((workspace) => workspace.id));
		if (selectedWorkspaceIds.some((workspaceId) => !validWorkspaceIds.has(workspaceId))) {
			selectedWorkspaceIds = selectedWorkspaceIds.filter((workspaceId) =>
				validWorkspaceIds.has(workspaceId)
			);
		}
	});

	$effect(() => {
		const key = loadKey;
		untrack(() => void loadCalendarData(key));
	});

	$effect(() => {
		const batch = ui.publicationInvalidations;
		if (batch.revision === 0 || batch.revision === handledInvalidationRevision) return;
		handledInvalidationRevision = batch.revision;
		untrack(() => {
			const range = visibleRange;
			const workspaceIds = activeWorkspaceIds;
			const shouldRefresh = workspaceIds.some((workspaceId) => {
				const invalidation = publicationInvalidationForWorkspace(batch, workspaceId);
				if (!invalidation?.scopes.includes('calendar')) return false;
				return (
					invalidation.dateKeys.length === 0 ||
					invalidation.dateKeys.some(
						(dateKey) => dateKey >= range.firstKey && dateKey <= range.lastKey
					)
				);
			});
			if (shouldRefresh) void loadCalendarData(loadKey);
		});
	});

	onDestroy(() => weekDragController.destroy());

	async function loadCalendarData(_key: string) {
		const request = ++activeRequest;
		loading = true;
		loadError = '';
		errorMessage = '';
		try {
			if (workspaceCtx.workspaces.length === 0 && !workspaceCtx.loading) {
				await workspaceCtx.initialize();
			}
			const workspaceIds =
				selectedWorkspaceIds.length > 0
					? selectedWorkspaceIds
					: workspaceCtx.workspaces.map((workspace) => workspace.id);
			if (workspaceIds.length === 0) {
				if (request !== activeRequest) return;
				publications = [];
				accountsByWorkspace = {};
				dataRevision += 1;
				completedLoadKey = _key;
				return;
			}

			const requestRange = visibleRange;
			const [publicationGroups, accountEntries] = await Promise.all([
				Promise.all(
					workspaceIds.map((workspaceId) => fetchPublications(workspaceId, requestRange))
				),
				Promise.all(workspaceIds.map(fetchAccounts))
			]);

			if (request !== activeRequest) return;
			publications = publicationGroups.flat();
			accountsByWorkspace = Object.fromEntries(accountEntries);
			dataRevision += 1;
			completedLoadKey = _key;
		} catch (error) {
			if (request !== activeRequest) return;
			loadError =
				error instanceof WorkspaceContextError
					? m.calendar_failed_load()
					: error instanceof Error
						? error.message
						: m.calendar_failed_load();
		} finally {
			if (request === activeRequest) {
				loading = false;
			}
		}
	}

	async function fetchPublications(workspaceId: string, range: { from: string; before: string }) {
		const out: Publication[] = [];
		let offset = 0;
		while (true) {
			const query = {
				workspace_id: workspaceId,
				calendar_from: range.from,
				calendar_before: range.before,
				limit: 200,
				offset
			};
			const { data, error, response } = await client.GET('/publications', {
				params: { query }
			});
			if (error) throw new Error(error.detail || m.calendar_failed_load());
			out.push(...(data ?? []));
			const hasMore = response.headers.get('X-Has-More') === 'true';
			if (!hasMore) break;
			const nextOffset = Number(response.headers.get('X-Next-Offset') ?? offset + 200);
			if (!Number.isFinite(nextOffset) || nextOffset <= offset) break;
			offset = nextOffset;
		}
		return out;
	}

	async function fetchAccounts(workspaceId: string): Promise<[string, SocialAccount[]]> {
		return [workspaceId, await loadWorkspaceAccounts(workspaceId)];
	}

	function publicationToCalendarItem(publication: Publication): CalendarItem | null {
		const occursAt = publicationCalendarOccurrence(publication);
		if (!occursAt) return null;
		const renditions = publication.renditions ?? [];
		const accounts = accountsForRenditions(publication.workspace_id, renditions);
		const title =
			publication.title || firstLine(publication.source_text) || m.calendar_untitled_publication();
		return {
			id: publication.id,
			key: `publication:${publication.id}`,
			href: `/publications/${encodeURIComponent(publication.id)}`,
			title,
			status: publication.status,
			occursAt,
			movable: publication.status === 'scheduled',
			workspaceId: publication.workspace_id,
			workspaceName: workspaceName(publication.workspace_id),
			accounts,
			platforms: unique(accounts.map((account) => account.platform)),
			publication
		};
	}

	function accountsForRenditions(workspaceId: string, renditions: Rendition[]) {
		const byId = accountMap(workspaceId);
		return uniqueById(
			renditions.map((rendition) => {
				const account = byId.get(rendition.social_account_id);
				if (account) return accountBadge(account);
				return {
					id: rendition.social_account_id,
					platform: rendition.platform,
					label: platformLabel(rendition.platform)
				};
			})
		);
	}

	function accountMap(workspaceId: string) {
		return new Map(
			(accountsByWorkspace[workspaceId] ?? []).map((account) => [account.id, account])
		);
	}

	function accountBadge(account: SocialAccount): AccountBadge {
		return {
			id: account.id,
			platform: account.platform,
			label:
				formatSocialAccountName(account.account_username, account.platform) ||
				account.slug ||
				platformLabel(account.platform)
		};
	}

	function toggleWorkspace(workspaceId: string) {
		if (selectedWorkspaceIds.length === 0) {
			selectedWorkspaceIds = workspaces
				.map((workspace) => workspace.id)
				.filter((candidate) => candidate !== workspaceId);
		} else if (selectedWorkspaceIds.includes(workspaceId)) {
			selectedWorkspaceIds = selectedWorkspaceIds.filter((candidate) => candidate !== workspaceId);
		} else {
			selectedWorkspaceIds = [...selectedWorkspaceIds, workspaceId];
		}
		if (selectedWorkspaceIds.length === 0 || selectedWorkspaceIds.length === workspaces.length) {
			selectedWorkspaceIds = [];
		}
	}

	function workspaceSelected(workspaceId: string) {
		return selectedWorkspaceIds.length === 0 || selectedWorkspaceIds.includes(workspaceId);
	}

	function changeMonth(delta: number) {
		monthDayOpen = false;
		currentMonth =
			viewMode === 'month'
				? startOfMonth(addMonths(currentMonth, delta))
				: addDays(currentMonth, delta * 7);
	}

	function changeView(nextView: CalendarView) {
		if (nextView === viewMode) return;
		weekDragController.cancel();
		monthDayOpen = false;
		if (nextView === 'week') {
			const today = workspaceTodayDate(viewerTimeZone);
			currentMonth =
				today.getFullYear() === currentMonth.getFullYear() &&
				today.getMonth() === currentMonth.getMonth()
					? today
					: new Date(currentMonth.getFullYear(), currentMonth.getMonth(), 1, 12);
		} else {
			currentMonth = startOfMonth(currentMonth);
		}
		viewMode = nextView;
	}

	function goToToday() {
		monthDayOpen = false;
		const today = workspaceTodayDate(viewerTimeZone);
		currentMonth = viewMode === 'month' ? startOfMonth(today) : today;
	}

	function openItem(item: CalendarItem) {
		monthDayOpen = false;
		goto(resolveAppPath(item.href));
	}

	function openMonthDay(day: CalendarDay) {
		selectedMonthDayKey = day.key;
		monthDayOpen = true;
	}

	function handleMonthDayOpenChange(open: boolean) {
		monthDayOpen = open;
	}

	function createPostFromMonthDay() {
		if (!selectedMonthDay) return;
		monthDayOpen = false;
		createPostOnDate(selectedMonthDay.date);
	}

	function composeWorkspaceId() {
		if (selectedWorkspaceIds.length === 1) return selectedWorkspaceIds[0];
		return workspaceCtx.currentWorkspace?.id ?? activeWorkspaceIds[0] ?? '';
	}

	function createPostOnDate(date: Date, time = '') {
		if (isPastDate(date)) {
			errorMessage = m.calendar_past_date();
			return;
		}
		const params = new URLSearchParams({ date: dateKey(date) });
		if (time) params.set('time', time);
		const workspaceId = composeWorkspaceId();
		if (workspaceId) params.set('workspace_id', workspaceId);
		goto(resolve(`/?${params.toString()}`));
	}

	function createPostOnSelectedEmptyDate() {
		if (selectedEmptyDay) createPostOnDate(selectedEmptyDay.date);
	}

	function onDragStart(event: DragEvent, item: CalendarItem) {
		if (!item.movable) {
			event.preventDefault();
			return;
		}
		draggingKey = item.key;
		successMessage = '';
		errorMessage = '';
		event.dataTransfer?.setData('text/plain', item.key);
		if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
	}

	function onDragEnd() {
		draggingKey = '';
		dropTargetKey = '';
	}

	function onDragOver(event: DragEvent, day: CalendarDay) {
		if (!draggingKey || reschedulingKey || isPastDay(day)) return;
		event.preventDefault();
		dropTargetKey = day.key;
		if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
	}

	function onDragLeave(day: CalendarDay) {
		if (dropTargetKey === day.key) dropTargetKey = '';
	}

	async function onDrop(event: DragEvent, day: CalendarDay) {
		event.preventDefault();
		const key = event.dataTransfer?.getData('text/plain') || draggingKey;
		const item = allItems.find((candidate) => candidate.key === key);
		draggingKey = '';
		dropTargetKey = '';
		if (isPastDay(day)) {
			errorMessage = m.calendar_past_date();
			return;
		}
		if (!item?.movable || workspaceDateKeyFromISO(item.occursAt, viewerTimeZone) === day.key)
			return;
		await rescheduleItem(item, day.date);
	}

	function snappedTime(event: MouseEvent, hour: number) {
		const target = event.currentTarget;
		if (!(target instanceof HTMLElement)) return `${String(hour).padStart(2, '0')}:00`;
		const bounds = target.getBoundingClientRect();
		const quarter = Math.max(
			0,
			Math.min(3, Math.floor(((event.clientY - bounds.top) / bounds.height) * 4))
		);
		return `${String(hour).padStart(2, '0')}:${String(quarter * 15).padStart(2, '0')}`;
	}

	function onWeekPointerDown(event: PointerEvent, item: CalendarItem) {
		weekDragController.pointerDown(event, item, item.movable && !reschedulingKey);
	}

	function onWeekPointerMove(event: PointerEvent) {
		weekDragController.pointerMove(event);
	}

	function onWeekPointerUp(event: PointerEvent) {
		weekDragController.pointerUp(event);
	}

	function onWeekPointerCancel(event: PointerEvent) {
		weekDragController.pointerCancel(event);
	}

	function onWeekPointerCaptureLost(event: PointerEvent) {
		weekDragController.pointerCaptureLost(event);
	}

	function onWeekItemKeyDown(event: KeyboardEvent) {
		weekDragController.keyDown(event);
	}

	function onWeekItemClick(event: MouseEvent, item: CalendarItem) {
		if (weekDragController.consumeClick(item)) {
			event.preventDefault();
			return;
		}
		openItem(item);
	}

	function resolveWeekDragTarget(pointer: { x: number; y: number }): WeekDragTarget | null {
		if (!weekBodyElement) return null;
		const gutter = weekBodyElement.querySelector<HTMLElement>('[data-week-time-gutter]');
		if (!gutter) return null;
		const gridBounds = weekBodyElement.getBoundingClientRect();
		const resolved = resolveWeekCalendarTarget(pointer, {
			grid: {
				left: gridBounds.left,
				top: gridBounds.top,
				width: gridBounds.width,
				height: gridBounds.height
			},
			gutterWidth: gutter.getBoundingClientRect().width,
			hourHeight: gridBounds.height / weekHours.length,
			targetHeight: WEEK_DRAG_TARGET_HEIGHT
		});
		const day = resolved ? weekDays[resolved.dayIndex] : undefined;
		return resolved && day && !isPastDay(day) ? { ...resolved, day } : null;
	}

	function activateWeekDragView(
		item: CalendarItem,
		sourceBounds: { width: number },
		target: WeekDragTarget | null
	) {
		draggingKey = item.key;
		successMessage = '';
		errorMessage = '';
		weekDragView = {
			item,
			target,
			targetLabel: target
				? formatWeekDragTarget(target.day, target.time)
				: formatWeekDragSource(item),
			width: Math.min(
				WEEK_DRAG_OVERLAY_MAX_WIDTH,
				Math.max(WEEK_DRAG_OVERLAY_MIN_WIDTH, sourceBounds.width)
			),
			height: WEEK_DRAG_OVERLAY_HEIGHT
		};
	}

	function updateWeekDragView(item: CalendarItem, target: WeekDragTarget | null) {
		if (!weekDragView) return;
		weekDragView = {
			...weekDragView,
			item,
			target,
			targetLabel: target
				? formatWeekDragTarget(target.day, target.time)
				: formatWeekDragSource(item)
		};
	}

	function clearWeekDragView() {
		weekDragView = null;
		weekDragOverlayElement = undefined;
		draggingKey = '';
	}

	function sameWeekDragSlot(item: CalendarItem, target: WeekDragTarget) {
		const parts = timeParts(item.occursAt);
		return (
			workspaceDateKeyFromISO(item.occursAt, viewerTimeZone) === target.day.key &&
			parts.hour * 60 + parts.minute === target.minutes
		);
	}

	function formatWeekDragSource(item: CalendarItem) {
		const day = weekDays.find(
			(candidate) => candidate.key === workspaceDateKeyFromISO(item.occursAt, viewerTimeZone)
		);
		return day
			? `${formatWorkspaceDate(day.date, { weekday: 'short' })} ${formatTime(item.occursAt)}`
			: formatTime(item.occursAt);
	}

	function formatWeekDragTarget(day: CalendarDay, time: string) {
		const scheduledAt = workspaceScheduleToISO(calendarDate(day.date), time, viewerTimeZone);
		const formattedTime = scheduledAt ? formatTime(scheduledAt) : time;
		return `${formatWorkspaceDate(day.date, { weekday: 'short' })} ${formattedTime}`;
	}
	async function rescheduleItem(item: CalendarItem, targetDate: Date, targetTime = '') {
		if (isPastDate(targetDate)) {
			errorMessage = m.calendar_past_date();
			return;
		}
		const nextScheduledAt = targetTime
			? workspaceScheduleToISO(calendarDate(targetDate), targetTime, viewerTimeZone)
			: workspaceScheduleMoveToDate(item.occursAt, calendarDate(targetDate), viewerTimeZone);
		if (!nextScheduledAt) {
			errorMessage = m.calendar_reschedule_failed();
			return;
		}
		if (!isFutureSchedule(nextScheduledAt)) {
			errorMessage = m.calendar_past_date();
			return;
		}
		const previousPublications = publications;
		const mutationLoadKey = loadKey;
		const mutationDataRevision = dataRevision;
		reschedulingKey = item.key;
		errorMessage = '';
		successMessage = '';

		publications = publications.map((publication) =>
			publication.id === item.id ? { ...publication, scheduled_at: nextScheduledAt } : publication
		);

		try {
			if (item.publication) {
				const publication = item.publication;
				const { data, error } = await client.PUT('/publications/{id}', {
					params: { path: { id: item.id } },
					body: {
						expected_revision: publication.revision,
						title: publication.title,
						content_profile: publication.content_profile,
						source_text: publication.source_text,
						source_url: publication.source_url ?? '',
						goal: publication.goal ?? '',
						audience: publication.audience ?? '',
						metadata: publication.metadata ?? {},
						scheduled_at: nextScheduledAt
					}
				});
				if (error) throw new Error(error.detail || m.calendar_reschedule_failed());
				if (data) {
					publications = publications.map((current) => (current.id === data.id ? data : current));
				}
			}
			if (loadKey === mutationLoadKey) {
				publications = publications.map((publication) =>
					publication.id === item.id
						? { ...publication, scheduled_at: nextScheduledAt }
						: publication
				);
				dataRevision += 1;
				successMessage = m.calendar_rescheduled({
					title: item.title,
					date: formatLongDateTime(nextScheduledAt)
				});
			}
			const previousDateKey = workspaceDateKeyFromISO(item.occursAt, viewerTimeZone);
			const nextDateKey = workspaceDateKeyFromISO(nextScheduledAt, viewerTimeZone);
			ui.triggerRefresh({
				workspaceId: item.workspaceId,
				scopes: ['activity', 'calendar'],
				dateKeys: [previousDateKey, nextDateKey].filter((value): value is string => Boolean(value))
			});
		} catch (error) {
			if (loadKey === mutationLoadKey && dataRevision === mutationDataRevision) {
				publications = previousPublications;
				errorMessage = error instanceof Error ? error.message : m.calendar_reschedule_failed();
			}
		} finally {
			reschedulingKey = '';
		}
	}

	function startOfMonth(date: Date) {
		return new Date(date.getFullYear(), date.getMonth(), 1);
	}

	function addMonths(date: Date, count: number) {
		return new Date(date.getFullYear(), date.getMonth() + count, 1);
	}

	function addDays(date: Date, count: number) {
		return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count, 12);
	}

	function buildCalendarDays(month: Date, weekStart: number, todayDate: Date) {
		const first = startOfWeek(startOfMonth(month), weekStart);
		const todayKey = dateKey(todayDate);
		const monthValue = month.getMonth();
		return Array.from({ length: 42 }, (_, index): CalendarDay => {
			const date = new SvelteDate(first);
			date.setDate(first.getDate() + index);
			return {
				date,
				key: dateKey(date),
				outsideMonth: date.getMonth() !== monthValue,
				today: dateKey(date) === todayKey
			};
		});
	}

	function buildWeekDays(date: Date, weekStart: number, todayDate: Date) {
		const first = startOfWeek(date, weekStart);
		const todayKey = dateKey(todayDate);
		return Array.from({ length: 7 }, (_, index): CalendarDay => {
			const value = addDays(first, index);
			return {
				date: value,
				key: dateKey(value),
				outsideMonth: false,
				today: dateKey(value) === todayKey
			};
		});
	}

	function startOfWeek(date: Date, weekStart: number) {
		const out = new SvelteDate(date);
		out.setHours(0, 0, 0, 0);
		const diff = (out.getDay() - weekStart + 7) % 7;
		out.setDate(out.getDate() - diff);
		return out;
	}

	function dateKey(date: Date) {
		const year = date.getFullYear();
		const month = String(date.getMonth() + 1).padStart(2, '0');
		const day = String(date.getDate()).padStart(2, '0');
		return `${year}-${month}-${day}`;
	}

	function isPastDate(date: Date) {
		return dateKey(date) < workspaceTodayKey;
	}

	function isPastDay(day: CalendarDay) {
		return day.key < workspaceTodayKey;
	}

	function monthKey(date: Date) {
		return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
	}

	function calendarDate(date: Date) {
		return new CalendarDate(date.getFullYear(), date.getMonth() + 1, date.getDate());
	}

	function calendarRequestRange(calendarDays: CalendarDay[], timeZone: string) {
		const first = calendarDays[0]?.date ?? currentMonth;
		const last = calendarDays[calendarDays.length - 1]?.date ?? currentMonth;
		const beforeDate = addDays(last, 1);
		return {
			from: workspaceScheduleToISO(calendarDate(first), '00:00', timeZone) ?? first.toISOString(),
			before:
				workspaceScheduleToISO(calendarDate(beforeDate), '00:00', timeZone) ??
				beforeDate.toISOString(),
			firstKey: dateKey(first),
			lastKey: dateKey(last)
		};
	}

	function workspaceTodayDate(timeZone: string, instant = new Date()) {
		const date = workspaceClock(timeZone, instant).date;
		return new Date(date.year, date.month - 1, date.day, 12);
	}

	function formatWorkspaceDate(date: Date, options: Intl.DateTimeFormatOptions): string {
		return calendarDate(date)
			.toDate(viewerTimeZone)
			.toLocaleDateString(getLocaleTag(), { ...options, timeZone: viewerTimeZone });
	}

	function firstLine(text: string) {
		return text.trim().split(/\n+/)[0]?.trim() ?? '';
	}

	function unique(values: string[]) {
		return Array.from(new Set(values.filter(Boolean)));
	}

	function uniqueById(accounts: AccountBadge[]) {
		const seen = new SvelteSet<string>();
		return accounts.filter((account) => {
			if (!account.id || seen.has(account.id)) return false;
			seen.add(account.id);
			return true;
		});
	}

	function workspaceName(workspaceId: string) {
		return (
			workspaces.find((workspace) => workspace.id === workspaceId)?.name ??
			m.calendar_unknown_workspace()
		);
	}

	function workspaceDotStyle(workspaceId: string) {
		const workspace = workspaces.find((candidate) => candidate.id === workspaceId);
		return `background-color: ${workspace ? workspaceColor(workspace) : '#f97316'};`;
	}

	function platformLabel(platform: string) {
		const labels = new Map([
			['x', 'X'],
			['twitter', 'X'],
			['mastodon', 'Mastodon'],
			['bluesky', 'Bluesky'],
			['linkedin', 'LinkedIn'],
			['threads', 'Threads'],
			['facebook', 'Facebook'],
			['instagram', 'Instagram'],
			['tiktok', 'TikTok'],
			['youtube', 'YouTube']
		]);
		return labels.get(platform) ?? platform;
	}

	function formatMonth(date: Date) {
		return formatWorkspaceDate(date, { month: 'long', year: 'numeric' });
	}

	function formatCalendarTitle() {
		if (viewMode === 'month') return formatMonth(currentMonth);
		const firstDay = weekDays[0].date;
		const lastDay = weekDays[6].date;
		const firstYear = formatWorkspaceDate(firstDay, { year: 'numeric' });
		const lastYear = formatWorkspaceDate(lastDay, { year: 'numeric' });
		const rangeOptions: Intl.DateTimeFormatOptions = {
			month: 'short',
			day: 'numeric',
			timeZone: viewerTimeZone
		};
		if (firstYear !== lastYear) rangeOptions.year = 'numeric';
		return new Intl.DateTimeFormat(getLocaleTag(), rangeOptions).formatRange(firstDay, lastDay);
	}

	function statusFilterLabel() {
		switch (selectedStatus) {
			case 'scheduled':
				return m.calendar_status_scheduled();
			case 'published':
				return m.calendar_status_published();
			default:
				return m.calendar_status_all();
		}
	}

	function formatTime(value: string) {
		return new Date(value).toLocaleTimeString(getLocaleTag(), {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: viewerTimeZone
		});
	}

	function timeParts(value: string) {
		const parts = new Intl.DateTimeFormat('en-GB', {
			hour: '2-digit',
			minute: '2-digit',
			hourCycle: 'h23',
			timeZone: viewerTimeZone
		}).formatToParts(new Date(value));
		return {
			hour: Number(parts.find((part) => part.type === 'hour')?.value ?? 0),
			minute: Number(parts.find((part) => part.type === 'minute')?.value ?? 0)
		};
	}

	function itemsForHour(day: CalendarDay, hour: number) {
		return (itemsByDay.get(day.key) ?? []).filter((item) => timeParts(item.occursAt).hour === hour);
	}

	function formatAgendaDate(value: Date) {
		return formatWorkspaceDate(value, {
			weekday: 'long',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatEmptyDate(value: Date) {
		return formatWorkspaceDate(value, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		});
	}

	function formatLongDateTime(value: string) {
		return new Date(value).toLocaleString(getLocaleTag(), {
			month: 'short',
			day: 'numeric',
			hour: '2-digit',
			minute: '2-digit',
			timeZone: viewerTimeZone
		});
	}

	function itemTone(item: CalendarItem) {
		if (item.status === 'published') {
			return 'border-emerald-500/20 bg-emerald-50/65 text-emerald-950 hover:bg-emerald-100 dark:bg-emerald-950/25 dark:text-emerald-100 dark:hover:bg-emerald-950/40';
		}
		return 'border-violet-500/20 bg-violet-50/65 text-violet-950 hover:bg-violet-100 dark:bg-violet-950/25 dark:text-violet-100 dark:hover:bg-violet-950/40';
	}
</script>

<svelte:head>
	<title>{m.calendar_page_title()}</title>
</svelte:head>

<div
	class="flex min-h-0 flex-1 flex-col overflow-hidden bg-background"
	style="container-type: inline-size;"
>
	<header class="border-b bg-background/95">
		<div class="px-4 py-4 lg:px-6" style="container-type: inline-size;">
			<PageHeader
				title={formatCalendarTitle()}
				contentClass="min-w-max shrink-0"
				titleClass="whitespace-nowrap"
				loading={initialLoading}
				class="flex-wrap gap-2"
			>
				{#snippet actions()}
					<div class="flex flex-wrap items-center gap-1.5">
						<div class="inline-flex rounded-md border bg-card p-1">
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-sm"
											aria-label={viewMode === 'month'
												? m.calendar_previous_month()
												: m.calendar_previous_week()}
											onclick={() => changeMonth(-1)}
										>
											<ChevronLeftIcon class="size-4" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>
									{viewMode === 'month' ? m.calendar_previous_month() : m.calendar_previous_week()}
								</Tooltip.Content>
							</Tooltip.Root>
							<Button variant="ghost" size="sm" onclick={goToToday}>{m.calendar_today()}</Button>
							<Tooltip.Root>
								<Tooltip.Trigger>
									{#snippet child({ props })}
										<Button
											{...props}
											variant="ghost"
											size="icon-sm"
											aria-label={viewMode === 'month'
												? m.calendar_next_month()
												: m.calendar_next_week()}
											onclick={() => changeMonth(1)}
										>
											<ChevronRightIcon class="size-4" />
										</Button>
									{/snippet}
								</Tooltip.Trigger>
								<Tooltip.Content>
									{viewMode === 'month' ? m.calendar_next_month() : m.calendar_next_week()}
								</Tooltip.Content>
							</Tooltip.Root>
						</div>

						<div class="inline-flex rounded-md border bg-card p-1">
							<Button
								variant={viewMode === 'month' ? 'secondary' : 'ghost'}
								size="sm"
								class="min-w-11 gap-1.5 md:min-w-8 2xl:min-w-0"
								aria-label={m.calendar_month_view()}
								onclick={() => changeView('month')}
							>
								<CalendarDaysIcon class="size-3.5" aria-hidden="true" />
								<span class="hidden 2xl:inline">{m.calendar_month_view()}</span>
							</Button>
							<Button
								variant={viewMode === 'week' ? 'secondary' : 'ghost'}
								size="sm"
								class="min-w-11 gap-1.5 md:min-w-8 2xl:min-w-0"
								aria-label={m.calendar_week_view()}
								onclick={() => changeView('week')}
							>
								<Rows3Icon class="size-3.5" aria-hidden="true" />
								<span class="hidden 2xl:inline">{m.calendar_week_view()}</span>
							</Button>
						</div>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" class="max-w-64 justify-start">
										<span class="truncate">{selectedWorkspaceLabel}</span>
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-64" align="end">
								<DropdownMenu.Label>{m.calendar_workspace_filter()}</DropdownMenu.Label>
								<DropdownMenu.CheckboxItem
									checked={selectedWorkspaceIds.length === 0}
									onCheckedChange={() => (selectedWorkspaceIds = [])}
									class="gap-2"
								>
									<span>{m.calendar_all_workspaces()}</span>
								</DropdownMenu.CheckboxItem>
								<DropdownMenu.Separator />
								{#each workspaces as workspace (workspace.id)}
									<DropdownMenu.CheckboxItem
										checked={workspaceSelected(workspace.id)}
										onCheckedChange={() => toggleWorkspace(workspace.id)}
										class="gap-2"
									>
										<span class="h-2 w-2 rounded-full" style={workspaceDotStyle(workspace.id)}
										></span>
										<span class="truncate">{workspace.name}</span>
									</DropdownMenu.CheckboxItem>
								{/each}
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" class="max-w-48 justify-start">
										<span class="truncate">
											{selectedPlatform === 'all'
												? m.calendar_all_platforms()
												: platformLabel(selectedPlatform)}
										</span>
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-52" align="end">
								<DropdownMenu.Label>{m.calendar_platform_filter()}</DropdownMenu.Label>
								<DropdownMenu.RadioGroup bind:value={selectedPlatform}>
									<DropdownMenu.RadioItem value="all" class="gap-2">
										<span>{m.calendar_all_platforms()}</span>
									</DropdownMenu.RadioItem>
									{#each availablePlatforms as platform (platform)}
										<DropdownMenu.RadioItem value={platform} class="gap-2">
											<PlatformIcon {platform} class="size-4" />
											<span>{platformLabel(platform)}</span>
										</DropdownMenu.RadioItem>
									{/each}
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<DropdownMenu.Root>
							<DropdownMenu.Trigger>
								{#snippet child({ props })}
									<Button {...props} variant="outline" class="max-w-44 justify-start">
										<span class="truncate">{statusFilterLabel()}</span>
									</Button>
								{/snippet}
							</DropdownMenu.Trigger>
							<DropdownMenu.Content class="w-48" align="end">
								<DropdownMenu.Label>{m.calendar_status_filter()}</DropdownMenu.Label>
								<DropdownMenu.RadioGroup bind:value={selectedStatus}>
									<DropdownMenu.RadioItem value="all">
										{m.calendar_status_all()}
									</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="scheduled">
										{m.calendar_status_scheduled()}
									</DropdownMenu.RadioItem>
									<DropdownMenu.RadioItem value="published">
										{m.calendar_status_published()}
									</DropdownMenu.RadioItem>
								</DropdownMenu.RadioGroup>
							</DropdownMenu.Content>
						</DropdownMenu.Root>

						<Button
							variant="outline"
							class="gap-1.5"
							aria-label={m.calendar_open_queue()}
							href={resolve('/settings') + '?tab=schedule#posting-schedule'}
						>
							<ListIcon class="size-4" aria-hidden="true" />
							<span class="hidden 2xl:inline">{m.calendar_open_queue()}</span>
						</Button>

						<Tooltip.Root>
							<Tooltip.Trigger>
								{#snippet child({ props })}
									<Button
										{...props}
										variant="outline"
										size="icon"
										aria-label={m.calendar_refresh()}
										disabled={loading || Boolean(reschedulingKey)}
										onclick={() => loadCalendarData(loadKey)}
									>
										<RefreshCwIcon class={cn('size-4', loading && 'animate-spin')} />
									</Button>
								{/snippet}
							</Tooltip.Trigger>
							<Tooltip.Content>{m.calendar_refresh()}</Tooltip.Content>
						</Tooltip.Root>
					</div>
				{/snippet}
			</PageHeader>
		</div>
	</header>

	{#if loadError && completedLoadKey === loadKey}
		<div class="border-b px-4 py-2 lg:px-6">
			<InlineNotice tone="error" message={loadError}>
				{#snippet actions()}
					<Button
						variant="outline"
						size="sm"
						disabled={loading}
						onclick={() => void loadCalendarData(loadKey)}
					>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		</div>
	{:else if errorMessage}
		<div class="border-b px-4 py-2 lg:px-6">
			<InlineNotice
				tone="error"
				message={errorMessage}
				dismissLabel={m.common_close()}
				onDismiss={() => (errorMessage = '')}
			/>
		</div>
	{:else if successMessage}
		<div class="border-b px-4 py-2 lg:px-6">
			<InlineNotice
				tone="success"
				message={successMessage}
				dismissLabel={m.common_close()}
				onDismiss={() => (successMessage = '')}
			/>
		</div>
	{/if}

	<div data-calendar-content class="min-h-0 flex-1 overflow-auto px-3 py-3 lg:px-6 lg:py-5">
		{#if initialLoading}
			<PageLoading layout="calendar" label={m.common_loading()} />
		{:else if loadError && completedLoadKey !== loadKey}
			<EmptyState
				icon={CalendarDaysIcon}
				title={m.calendar_failed_load()}
				description={loadError}
				actionLabel={m.common_retry()}
				onAction={() => void loadCalendarData(loadKey)}
				variant="muted"
			/>
		{:else}
			<section class="space-y-5 xl:hidden" aria-label={m.calendar_month_grid()}>
				{#if visibleItems.length > 0 && selectedEmptyDay}
					<div data-testid="calendar-empty-date-create" class="rounded-lg border bg-muted/20 p-3">
						<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
							<div class="min-w-0">
								<h2 class="text-sm font-semibold">{m.calendar_empty_date_heading()}</h2>
								<p class="mt-1 text-xs text-muted-foreground">
									{m.calendar_empty_date_body({ month: formatMonth(currentMonth) })}
								</p>
							</div>
							<div class="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center">
								<Select.Root
									type="single"
									value={selectedEmptyDay.key}
									onValueChange={(value) => value && (selectedEmptyDateKey = value)}
								>
									<Select.Trigger
										class="min-h-11 w-full sm:min-h-9 sm:w-44"
										aria-label={m.calendar_empty_date_picker({
											month: formatMonth(currentMonth)
										})}
									>
										{formatEmptyDate(selectedEmptyDay.date)}
									</Select.Trigger>
									<Select.Content>
										{#each emptyMonthDays as day (day.key)}
											<Select.Item value={day.key}>{formatEmptyDate(day.date)}</Select.Item>
										{/each}
									</Select.Content>
								</Select.Root>
								<Button
									class="min-h-11 w-full gap-2 sm:min-h-9 sm:w-auto"
									onclick={createPostOnSelectedEmptyDate}
								>
									<PlusIcon class="size-4" />
									{m.calendar_create_post()}
								</Button>
							</div>
						</div>
					</div>
				{/if}

				{#each agendaDays as entry (entry.day.key)}
					<section>
						<div class="mb-2 flex items-center justify-between gap-3">
							<h2 class="text-sm font-semibold">{formatAgendaDate(entry.day.date)}</h2>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={`${m.calendar_create_post()} ${entry.day.key}`}
								disabled={isPastDay(entry.day)}
								onclick={() => createPostOnDate(entry.day.date)}
							>
								<PlusIcon class="size-4" />
							</Button>
						</div>
						<div class="divide-y overflow-hidden rounded-lg border bg-card">
							{#each entry.items as item (item.key)}
								<button
									type="button"
									class="flex w-full items-start gap-3 p-3 text-left transition-colors hover:bg-muted/45 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
									onclick={() => openItem(item)}
								>
									<div class="w-14 shrink-0 pt-0.5 text-sm font-medium text-muted-foreground">
										{formatTime(item.occursAt)}
									</div>
									<div class="min-w-0 flex-1">
										<p class="line-clamp-2 text-sm leading-snug font-medium">{item.title}</p>
										<div
											class="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"
										>
											<span>{item.workspaceName}</span>
											{#each item.accounts.slice(0, 3) as account (account.id)}
												<span
													class="inline-flex max-w-28 items-center gap-1 rounded-full bg-muted px-2 py-0.5"
												>
													<PlatformIcon platform={account.platform} class="size-3" />
													<span class="truncate">{account.label}</span>
												</span>
											{/each}
										</div>
									</div>
								</button>
							{/each}
						</div>
					</section>
				{/each}
			</section>

			{#if viewMode === 'month'}
				<section
					class="month-shell hidden min-w-[980px] overflow-hidden rounded-lg border bg-card xl:grid"
					aria-label={m.calendar_month_grid()}
				>
					<div class="grid grid-cols-7 border-b bg-muted/45">
						{#each weekdayLabels as label (label)}
							<div class="px-2 py-1.5 text-xs font-medium tracking-normal text-muted-foreground">
								{label}
							</div>
						{/each}
					</div>
					<div class="month-grid grid min-h-0 grid-cols-7">
						{#each days as day (day.key)}
							{@const dayItems = itemsByDay.get(day.key) ?? []}
							<div
								role="group"
								aria-label={formatAgendaDate(day.date)}
								data-calendar-day={day.key}
								class={cn(
									'group/day relative flex min-h-0 flex-col overflow-hidden border-r border-b bg-background/70 p-1.5 transition-colors last:border-r-0',
									day.outsideMonth && 'bg-muted/25 text-muted-foreground',
									day.today && 'bg-primary/[0.035]',
									dropTargetKey === day.key && 'bg-primary/10 ring-2 ring-primary ring-inset'
								)}
								ondragover={(event) => onDragOver(event, day)}
								ondragleave={() => onDragLeave(day)}
								ondrop={(event) => onDrop(event, day)}
							>
								<div class="mb-1 flex h-5 items-center justify-between gap-1.5">
									<div class="flex min-w-0 items-center gap-1">
										<span
											class={cn(
												'flex size-5 shrink-0 items-center justify-center rounded-sm text-[11px] font-semibold',
												day.today && 'bg-primary text-primary-foreground',
												day.outsideMonth && !day.today && 'text-muted-foreground'
											)}
										>
											{day.date.getDate()}
										</span>
										{#if dayItems.length > 0}
											<Tooltip.Root>
												<Tooltip.Trigger>
													{#snippet child({ props })}
														<button
															{...props}
															type="button"
															class="relative flex h-5 min-w-5 items-center justify-center rounded-sm bg-muted px-1 text-[10px] font-semibold text-muted-foreground transition-colors before:absolute before:-inset-1.5 hover:bg-muted/80 hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
															aria-label={m.calendar_view_day_posts({
																count: dayItems.length,
																date: formatAgendaDate(day.date)
															})}
															data-calendar-day-count
															onclick={(event) => {
																event.stopPropagation();
																openMonthDay(day);
															}}
														>
															{m.calendar_day_item_count({ count: dayItems.length })}
														</button>
													{/snippet}
												</Tooltip.Trigger>
												<Tooltip.Content>
													{m.calendar_view_day_posts({
														count: dayItems.length,
														date: formatAgendaDate(day.date)
													})}
												</Tooltip.Content>
											</Tooltip.Root>
										{/if}
									</div>
									<Tooltip.Root>
										<Tooltip.Trigger>
											{#snippet child({ props })}
												<Button
													{...props}
													type="button"
													variant="ghost"
													size="icon-xs"
													class="relative size-5 shrink-0 rounded-sm opacity-60 group-hover/day:opacity-100 before:absolute before:-inset-1.5 hover:bg-muted"
													aria-label={`${m.calendar_create_post()} ${day.key}`}
													disabled={isPastDay(day)}
													data-calendar-day-action
													onclick={(event) => {
														event.stopPropagation();
														createPostOnDate(day.date);
													}}
												>
													<PlusIcon class="size-3" />
												</Button>
											{/snippet}
										</Tooltip.Trigger>
										<Tooltip.Content>{m.calendar_create_post()}</Tooltip.Content>
									</Tooltip.Root>
								</div>

								<div class="min-h-0 flex-1 space-y-1 overflow-hidden">
									{#each dayItems.slice(0, 2) as item (item.key)}
										<button
											type="button"
											draggable={item.movable}
											data-calendar-item
											class={cn(
												'month-event flex h-6 w-full items-center gap-1 overflow-hidden rounded-sm border px-1.5 text-left text-xs transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
												itemTone(item),
												draggingKey === item.key && 'opacity-50',
												reschedulingKey === item.key && 'pointer-events-none opacity-60'
											)}
											aria-label={m.calendar_publication_card({ title: item.title })}
											title={`${formatTime(item.occursAt)} · ${item.title} · ${item.workspaceName}`}
											ondragstart={(event) => onDragStart(event, item)}
											ondragend={onDragEnd}
											onclick={() => openItem(item)}
										>
											<span
												class="size-1.5 shrink-0 rounded-full"
												style={workspaceDotStyle(item.workspaceId)}
												aria-hidden="true"
											></span>
											{#if item.accounts.length > 0}
												<span
													class="flex shrink-0 items-center -space-x-1"
													aria-label={m.calendar_account_count({ count: item.accounts.length })}
												>
													{#each item.accounts.slice(0, 3) as account (account.id)}
														<span
															class="flex size-4 items-center justify-center rounded-full border border-border bg-background ring-1 ring-background"
															title={`${platformLabel(account.platform)} ${account.label}`}
														>
															<PlatformIcon platform={account.platform} class="size-2.5" />
														</span>
													{/each}
													{#if item.accounts.length > 3}
														<span
															class="flex size-4 items-center justify-center rounded-full border border-border bg-muted text-[8px] font-medium text-muted-foreground ring-1 ring-background"
														>
															+{item.accounts.length - 3}
														</span>
													{/if}
												</span>
											{/if}
											<time class="shrink-0 text-[11px] font-medium text-current/75 tabular-nums">
												{formatTime(item.occursAt)}
											</time>
											<span class="min-w-0 flex-1 truncate font-medium">{item.title}</span>
											{#if item.status === 'published'}
												<LockIcon class="size-3 shrink-0 text-current/65" aria-hidden="true" />
												<span class="sr-only">{m.calendar_status_published()}</span>
											{:else}
												<span class="sr-only">{m.calendar_status_scheduled()}</span>
											{/if}
											{#if reschedulingKey === item.key}
												<Loader2Icon class="size-3 shrink-0 animate-spin text-current/60" />
											{/if}
										</button>
									{/each}
								</div>
							</div>
						{/each}
					</div>
				</section>
			{:else}
				<section
					bind:this={weekScrollElement}
					class="hidden h-full min-h-[720px] overflow-auto rounded-lg border bg-card shadow-sm xl:block"
					aria-label={m.calendar_week_grid()}
				>
					<div class="min-w-[1120px]">
						<div
							class="sticky top-0 z-30 grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))] border-b bg-background/95 backdrop-blur"
						>
							<div class="border-r p-2 text-xs text-muted-foreground">{viewerTimeZone}</div>
							{#each weekDays as day (day.key)}
								<div
									class={cn(
										'border-r px-2 py-2 text-center last:border-r-0',
										day.today && 'bg-primary/[0.045]'
									)}
								>
									<div class="text-xs font-medium text-muted-foreground">
										{formatWorkspaceDate(day.date, { weekday: 'short' })}
									</div>
									<div
										class="mt-0.5 flex items-center justify-center gap-1.5 text-sm font-semibold"
									>
										<span>{day.date.getDate()}</span>
										{#if (itemsByDay.get(day.key)?.length ?? 0) > 0}
											<Badge class="bg-muted text-muted-foreground">
												{m.calendar_day_item_count({
													count: itemsByDay.get(day.key)?.length ?? 0
												})}
											</Badge>
										{/if}
									</div>
								</div>
							{/each}
						</div>
						<div bind:this={weekBodyElement}>
							{#each weekHours as hour (hour)}
								<div class="grid grid-cols-[4.5rem_repeat(7,minmax(0,1fr))]">
									<div
										data-week-time-gutter={hour === 0 ? '' : undefined}
										class="border-r border-b px-2 pt-1 text-right text-xs text-muted-foreground tabular-nums"
									>
										{String(hour).padStart(2, '0')}:00
									</div>
									{#each weekDays as day (day.key)}
										<div
											role="group"
											aria-label={`${formatAgendaDate(day.date)} ${String(hour).padStart(2, '0')}:00`}
											class={cn(
												'week-hour relative h-20 border-r border-b last:border-r-0',
												day.today && 'bg-primary/[0.025]'
											)}
										>
											<button
												type="button"
												class="absolute inset-0 w-full cursor-crosshair focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset disabled:cursor-not-allowed"
												disabled={isPastDay(day)}
												aria-label={`${m.calendar_create_post()} ${day.key} ${String(hour).padStart(2, '0')}:00`}
												onclick={(event) => createPostOnDate(day.date, snappedTime(event, hour))}
											></button>
											{#each itemsForHour(day, hour) as item (item.key)}
												<button
													type="button"
													data-calendar-week-item
													class={cn(
														'absolute right-1 left-1 z-10 min-h-9 touch-none rounded-md border px-2 py-1 text-left text-xs shadow-xs transition-[opacity,box-shadow,border-color] hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
														item.movable && 'cursor-grab active:cursor-grabbing',
														itemTone(item),
														draggingKey === item.key && 'border-dashed opacity-30 shadow-none',
														reschedulingKey === item.key && 'pointer-events-none opacity-60'
													)}
													style={`top: calc(${(timeParts(item.occursAt).minute / 60) * 100}% + 0.125rem);`}
													aria-label={m.calendar_publication_card({
														title: item.title
													})}
													onpointerdown={(event) => onWeekPointerDown(event, item)}
													onpointermove={onWeekPointerMove}
													onpointerup={onWeekPointerUp}
													onpointercancel={onWeekPointerCancel}
													onlostpointercapture={onWeekPointerCaptureLost}
													onkeydown={onWeekItemKeyDown}
													onclick={(event) => onWeekItemClick(event, item)}
												>
													<span class="flex items-center gap-1 font-medium">
														{#if !item.movable}<LockIcon class="size-3 shrink-0" />{/if}
														<span class="truncate">{formatTime(item.occursAt)} · {item.title}</span>
													</span>
												</button>
											{/each}
										</div>
									{/each}
								</div>
							{/each}
						</div>
					</div>
				</section>
			{/if}

			{#if visibleItems.length === 0}
				<div class="mt-5 xl:hidden">
					<EmptyState
						icon={CalendarDaysIcon}
						title={m.calendar_no_scheduled_title()}
						description={m.calendar_no_scheduled_body()}
						actionLabel={monthAllowsCreate ? m.calendar_create_post() : undefined}
						onAction={monthAllowsCreate ? createPostOnSelectedEmptyDate : undefined}
						variant="dashed"
					/>
				</div>
			{/if}
		{/if}
	</div>
</div>

{#if weekDragView}
	<CalendarDragOverlay
		title={weekDragView.item.title}
		accounts={weekDragView.item.accounts}
		target={weekDragView.target}
		targetLabel={weekDragView.targetLabel}
		width={weekDragView.width}
		height={weekDragView.height}
		bind:overlayElement={weekDragOverlayElement}
	/>
{/if}

<Sheet.Root open={monthDayOpen} onOpenChange={handleMonthDayOpenChange}>
	<Sheet.Content side="right" class="w-full! p-0 sm:max-w-lg!" data-testid="calendar-day-drawer">
		<Sheet.Header class="border-b px-4 py-4 pr-14 sm:px-5">
			<div class="flex items-center justify-between gap-3">
				<div class="min-w-0">
					<Sheet.Title class="truncate text-base font-semibold">
						{selectedMonthDay ? formatAgendaDate(selectedMonthDay.date) : ''}
					</Sheet.Title>
					<Sheet.Description class="mt-1 text-sm">
						{m.calendar_day_posts_summary({ count: selectedMonthDayItems.length })}
					</Sheet.Description>
				</div>
				{#if selectedMonthDay && !isPastDay(selectedMonthDay)}
					<Button size="sm" onclick={createPostFromMonthDay}>
						<PlusIcon class="mr-1.5 size-4" />
						{m.calendar_create_post()}
					</Button>
				{/if}
			</div>
		</Sheet.Header>

		<div class="min-h-0 flex-1 overflow-y-auto px-4 sm:px-5">
			<div class="divide-y">
				{#each selectedMonthDayItems as item (item.key)}
					<button
						type="button"
						class="flex w-full items-start gap-3 py-4 text-left transition-colors hover:bg-muted/35 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none focus-visible:ring-inset"
						onclick={() => openItem(item)}
					>
						<time
							class="w-14 shrink-0 pt-0.5 text-xs font-medium text-muted-foreground tabular-nums"
						>
							{formatTime(item.occursAt)}
						</time>
						<span class="min-w-0 flex-1">
							<span class="line-clamp-2 text-sm leading-snug font-medium">{item.title}</span>
							<span class="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
								<span class="inline-flex items-center gap-1.5">
									<span
										class="size-2 rounded-full"
										style={workspaceDotStyle(item.workspaceId)}
										aria-hidden="true"
									></span>
									<span>{item.workspaceName}</span>
								</span>
								<span>
									{item.status === 'published'
										? m.calendar_status_published()
										: m.calendar_status_scheduled()}
								</span>
								{#if item.accounts.length > 0}
									<span
										class="flex items-center -space-x-1"
										aria-label={m.calendar_account_count({ count: item.accounts.length })}
									>
										{#each item.accounts.slice(0, 5) as account (account.id)}
											<span
												class="flex size-6 items-center justify-center rounded-full border border-border bg-background ring-2 ring-background"
												title={`${platformLabel(account.platform)} ${account.label}`}
											>
												<PlatformIcon platform={account.platform} class="size-3.5" />
											</span>
										{/each}
										{#if item.accounts.length > 5}
											<span
												class="flex size-6 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-medium text-muted-foreground ring-2 ring-background"
											>
												{m.calendar_more_accounts({ count: item.accounts.length - 5 })}
											</span>
										{/if}
									</span>
								{/if}
							</span>
						</span>
					</button>
				{/each}
			</div>
		</div>
	</Sheet.Content>
</Sheet.Root>

<style>
	.month-shell {
		grid-template-rows: auto minmax(0, 1fr);
		height: 100%;
		min-height: 30rem;
		max-height: min(52rem, calc(100dvh - 16.5rem));
	}

	.month-grid {
		grid-template-rows: repeat(6, minmax(0, 1fr));
	}

	@media (max-height: 52rem) {
		.month-event:nth-child(n + 2) {
			display: none;
		}
	}

	@media (min-width: 90rem) {
		.month-shell {
			max-height: min(52rem, calc(100dvh - 10rem));
		}
	}

	.week-hour {
		background-image: linear-gradient(
			to bottom,
			transparent calc(25% - 0.5px),
			color-mix(in oklch, var(--border) 55%, transparent) 25%,
			transparent calc(25% + 0.5px),
			transparent calc(50% - 0.5px),
			color-mix(in oklch, var(--border) 55%, transparent) 50%,
			transparent calc(50% + 0.5px),
			transparent calc(75% - 0.5px),
			color-mix(in oklch, var(--border) 55%, transparent) 75%,
			transparent calc(75% + 0.5px)
		);
	}
</style>
