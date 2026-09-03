<script lang="ts">
	import { onDestroy } from 'svelte';
	import { get } from 'svelte/store';
	import {
		getCoreRowModel,
		type ColumnDef,
		type SortingState,
		type Updater,
		type VisibilityState
	} from '@tanstack/table-core';
	import CheckIcon from '@lucide/svelte/icons/check';
	import ChevronDownIcon from '@lucide/svelte/icons/chevron-down';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SearchIcon from '@lucide/svelte/icons/search';
	import UserRoundIcon from '@lucide/svelte/icons/user-round';
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import InstanceUserActionCell from '$lib/components/instance-user-action-cell.svelte';
	import InstanceUserDateCell from '$lib/components/instance-user-date-cell.svelte';
	import InstanceUserIdentityCell from '$lib/components/instance-user-identity-cell.svelte';
	import InstanceUserMetricsCell from '$lib/components/instance-user-metrics-cell.svelte';
	import InstanceUserPlanCell from '$lib/components/instance-user-plan-cell.svelte';
	import InstanceUserRoleCell from '$lib/components/instance-user-role-cell.svelte';
	import InstanceUserSortHeader from '$lib/components/instance-user-sort-header.svelte';
	import InstanceUserPlanDialog from '$lib/components/instance-user-plan-dialog.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import { Button } from '$lib/components/ui/button';
	import { createSvelteTable, FlexRender, renderComponent } from '$lib/components/ui/data-table';
	import * as Dialog from '$lib/components/ui/dialog';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import * as Pagination from '$lib/components/ui/pagination';
	import * as Table from '$lib/components/ui/table';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';
	import { createQuery } from '@tanstack/svelte-query';
	import {
		adminQueryKeys,
		instanceUsersQueryOptions,
		isOrganizationAuditQueryKey,
		OpenPostQueryError,
		organizationQueryKeys
	} from '@openpost/query-catalog';
	import { adminQueryAPI } from '$lib/query/admin';
	import { queryClient } from '$lib/query/client';
	import { auth } from '$lib/stores/auth';
	import {
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT
	} from '$lib/settings-initial-load.svelte';

	type InstanceUser = components['schemas']['InstanceUserResponse'];
	type InstanceUserSort =
		| 'created_at'
		| 'email'
		| 'display_name'
		| 'last_active_at'
		| 'workspace_count'
		| 'publication_count';

	interface InstanceAPIProblem {
		detail?: string;
	}

	const USERS_PER_PAGE = 25;
	const instanceUserSorts = new Set<string>([
		'created_at',
		'email',
		'display_name',
		'last_active_at',
		'workspace_count',
		'publication_count'
	]);

	function isInstanceUserSort(value: string): value is InstanceUserSort {
		return instanceUserSorts.has(value);
	}

	let userPage = $state(1);
	let searchInput = $state('');
	let appliedSearch = $state('');
	let sorting = $state.raw<SortingState>([{ id: 'created_at', desc: true }]);
	let columnVisibility = $state.raw<VisibilityState>({});

	let impersonationDialogOpen = $state(false);
	let impersonationUser = $state.raw<InstanceUser | null>(null);
	let impersonationBusyUserID = $state('');
	let impersonationURL = $state('');
	let impersonationExpiresAt = $state('');
	let impersonationError = $state('');
	let impersonationCopied = $state(false);
	let impersonationRequestSequence = 0;
	let active = true;

	let planDialogOpen = $state(false);
	let planDialogUser = $state.raw<InstanceUser | null>(null);
	let authorizationError = $state('');

	onDestroy(() => {
		active = false;
		impersonationRequestSequence += 1;
	});

	const usersFilters = $derived.by(() => {
		const activeSort = sorting[0] ?? { id: 'created_at', desc: true };
		return {
			page: userPage,
			perPage: USERS_PER_PAGE,
			search: appliedSearch,
			sort: isInstanceUserSort(activeSort.id) ? activeSort.id : 'created_at',
			direction: activeSort.desc ? ('desc' as const) : ('asc' as const)
		};
	});
	const usersQuery = createQuery(() => ({
		...instanceUsersQueryOptions(adminQueryAPI, usersFilters),
		enabled: !authorizationError
	}));
	const users = $derived(authorizationError ? null : (usersQuery.data ?? null));
	const usersLoading = $derived(
		!authorizationError && (usersQuery.isFetching || usersQuery.isPending)
	);
	const usersError = $derived(authorizationError || usersQuery.error?.message || '');
	const reportInitialLoad = registerSettingsInitialLoad(
		SETTINGS_INITIAL_LOAD_PARTICIPANT.instanceUsers
	);
	$effect(() => reportInitialLoad(usersLoading && !users));
	const rowActionsDisabled = $derived(
		Boolean(authorizationError) || usersQuery.isPlaceholderData || usersQuery.isFetching
	);
	const visibleUsers = $derived(users?.users ?? []);
	const firstVisibleUser = $derived(
		users && users.total > 0 ? (users.page - 1) * users.per_page + 1 : 0
	);
	const lastVisibleUser = $derived(users ? Math.min(users.page * users.per_page, users.total) : 0);

	const columns = $derived<ColumnDef<InstanceUser, unknown>[]>([
		{
			id: 'display_name',
			accessorKey: 'display_name',
			header: ({ column }) =>
				renderComponent(InstanceUserSortHeader, {
					column,
					label: m.settings_instance_user(),
					sortLabel: m.settings_instance_sort_by({
						column: m.settings_instance_user()
					})
				}),
			cell: ({ row }) => renderComponent(InstanceUserIdentityCell, { user: row.original }),
			enableHiding: false
		},
		{
			id: 'plan_ids',
			accessorKey: 'plan_ids',
			header: m.settings_instance_plan(),
			cell: ({ row }) =>
				renderComponent(InstanceUserPlanCell, {
					planIDs: row.original.plan_ids ?? []
				}),
			enableSorting: false
		},
		{
			id: 'role',
			accessorKey: 'is_admin',
			header: m.settings_role(),
			cell: ({ row }) =>
				renderComponent(InstanceUserRoleCell, {
					isAdmin: row.original.is_admin
				}),
			enableSorting: false
		},
		{
			id: 'workspace_count',
			accessorKey: 'workspace_count',
			header: ({ column }) =>
				renderComponent(InstanceUserSortHeader, {
					column,
					label: m.settings_instance_access(),
					sortLabel: m.settings_instance_sort_by({
						column: m.settings_instance_access()
					})
				}),
			cell: ({ row }) =>
				renderComponent(InstanceUserMetricsCell, {
					primaryLabel: m.settings_instance_organizations(),
					primaryValue: row.original.organization_count,
					secondaryLabel: m.settings_instance_workspaces(),
					secondaryValue: row.original.workspace_count
				})
		},
		{
			id: 'publication_count',
			accessorKey: 'publication_count',
			header: ({ column }) =>
				renderComponent(InstanceUserSortHeader, {
					column,
					label: m.settings_instance_content(),
					sortLabel: m.settings_instance_sort_by({
						column: m.settings_instance_content()
					})
				}),
			cell: ({ row }) =>
				renderComponent(InstanceUserMetricsCell, {
					primaryLabel: m.settings_instance_social_accounts(),
					primaryValue: row.original.social_account_count,
					secondaryLabel: m.settings_instance_publications(),
					secondaryValue: row.original.publication_count
				})
		},
		{
			id: 'last_active_at',
			accessorKey: 'last_active_at',
			header: ({ column }) =>
				renderComponent(InstanceUserSortHeader, {
					column,
					label: m.settings_instance_last_active(),
					sortLabel: m.settings_instance_sort_by({
						column: m.settings_instance_last_active()
					})
				}),
			cell: ({ row }) =>
				renderComponent(InstanceUserDateCell, {
					value: row.original.last_active_at,
					includeTime: true
				})
		},
		{
			id: 'created_at',
			accessorKey: 'created_at',
			header: ({ column }) =>
				renderComponent(InstanceUserSortHeader, {
					column,
					label: m.settings_instance_joined(),
					sortLabel: m.settings_instance_sort_by({
						column: m.settings_instance_joined()
					})
				}),
			cell: ({ row }) =>
				renderComponent(InstanceUserDateCell, {
					value: row.original.created_at
				})
		},
		{
			id: 'actions',
			header: m.settings_instance_actions(),
			cell: ({ row }) =>
				renderComponent(InstanceUserActionCell, {
					user: row.original,
					busy: impersonationBusyUserID === row.original.id,
					disabled: rowActionsDisabled,
					onImpersonate: createImpersonationLink,
					onChangePlan: openPlanDialog
				}),
			enableHiding: false,
			enableSorting: false
		}
	]);

	const table = createSvelteTable({
		get data() {
			return visibleUsers;
		},
		get columns() {
			return columns;
		},
		state: {
			get sorting() {
				return sorting;
			},
			get columnVisibility() {
				return columnVisibility;
			}
		},
		onSortingChange: handleSortingChange,
		onColumnVisibilityChange: (updater) => {
			columnVisibility = updater instanceof Function ? updater(columnVisibility) : updater;
		},
		getCoreRowModel: getCoreRowModel(),
		manualSorting: true
	});

	$effect(() => {
		if (users && users.total_pages > 0 && userPage > users.total_pages) {
			userPage = users.total_pages;
		}
	});

	$effect(() => {
		const cause = usersQuery.error;
		if (!(cause instanceof OpenPostQueryError) || (cause.status !== 401 && cause.status !== 403))
			return;
		authorizationError = cause.message;
		impersonationRequestSequence += 1;
		handleImpersonationDialogOpenChange(false);
		handlePlanDialogOpenChange(false);
		queryClient.removeQueries({ queryKey: adminQueryKeys.usersRoot() });
	});

	async function retryUsers() {
		authorizationError = '';
		await usersQuery.refetch();
	}

	function handleSortingChange(updater: Updater<SortingState>) {
		const next = updater instanceof Function ? updater(sorting) : updater;
		sorting = next.slice(0, 1);
		userPage = 1;
	}

	function searchUsers(event: SubmitEvent) {
		event.preventDefault();
		submitSearch();
	}

	function submitSearch() {
		appliedSearch = searchInput.trim();
		userPage = 1;
	}

	function clearSearch() {
		searchInput = '';
		appliedSearch = '';
		userPage = 1;
	}

	function changeUserPage(nextPage: number) {
		userPage = nextPage;
	}

	function openPlanDialog(user: InstanceUser) {
		if (rowActionsDisabled) return;
		planDialogUser = user;
		planDialogOpen = true;
	}

	function handlePlanDialogOpenChange(isOpen: boolean) {
		planDialogOpen = isOpen;
		if (!isOpen) {
			planDialogUser = null;
		}
	}

	async function createImpersonationLink(user: InstanceUser) {
		if (user.is_admin || rowActionsDisabled) return;
		const actorID = get(auth).user?.id ?? '';
		if (!actorID) return;
		const sequence = ++impersonationRequestSequence;
		const isCurrentRequest = () =>
			active && sequence === impersonationRequestSequence && get(auth).user?.id === actorID;
		impersonationUser = user;
		impersonationDialogOpen = true;
		impersonationBusyUserID = user.id;
		impersonationURL = '';
		impersonationExpiresAt = '';
		impersonationError = '';
		impersonationCopied = false;

		try {
			const { data, error } = await client.POST('/admin/users/{user_id}/impersonation-links', {
				params: { path: { user_id: user.id } }
			});
			if (error || !data) {
				throw new Error(problemDetail(error, m.settings_instance_impersonation_create_failed()));
			}
			if (get(auth).user?.id !== actorID) return;
			await Promise.all([
				queryClient.invalidateQueries({
					queryKey: organizationQueryKeys.instanceAuditRoot()
				}),
				queryClient.invalidateQueries({
					predicate: (query) => isOrganizationAuditQueryKey(query.queryKey)
				})
			]);
			if (!isCurrentRequest()) return;
			impersonationURL = data.url;
			impersonationExpiresAt = data.expires_at;
		} catch (cause) {
			if (isCurrentRequest()) {
				impersonationError =
					cause instanceof Error
						? cause.message
						: m.settings_instance_impersonation_create_failed();
			}
		} finally {
			if (isCurrentRequest()) impersonationBusyUserID = '';
		}
	}

	function handleImpersonationDialogOpenChange(open: boolean) {
		impersonationDialogOpen = open;
		if (open) return;
		impersonationRequestSequence++;
		impersonationUser = null;
		impersonationBusyUserID = '';
		impersonationURL = '';
		impersonationExpiresAt = '';
		impersonationError = '';
		impersonationCopied = false;
	}

	async function copyImpersonationLink() {
		if (!impersonationURL) return;
		try {
			await navigator.clipboard.writeText(impersonationURL);
			impersonationCopied = true;
			impersonationError = '';
		} catch {
			impersonationError = m.settings_instance_impersonation_copy_failed();
		}
	}

	function problemDetail(error: InstanceAPIProblem | undefined, fallback: string) {
		return error?.detail?.trim() || fallback;
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}

	function formatDateTime(value: string) {
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			year: 'numeric',
			month: 'short',
			day: 'numeric',
			hour: 'numeric',
			minute: '2-digit'
		}).format(date);
	}

	function columnLabel(columnID: string) {
		if (columnID === 'plan_ids') return m.settings_instance_plan();
		if (columnID === 'role') return m.settings_role();
		if (columnID === 'workspace_count') return m.settings_instance_access();
		if (columnID === 'publication_count') return m.settings_instance_content();
		if (columnID === 'last_active_at') return m.settings_instance_last_active();
		if (columnID === 'created_at') return m.settings_instance_joined();
		return columnID;
	}
</script>

<div class="space-y-4" data-testid="instance-admin-users">
	<form
		class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
		onsubmit={searchUsers}
	>
		<div class="flex min-w-0 flex-1 flex-wrap gap-2">
			<div class="relative min-w-48 flex-1 sm:max-w-sm">
				<SearchIcon
					class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
				/>
				<Input
					value={searchInput}
					oninput={(event) => (searchInput = event.currentTarget.value)}
					placeholder={m.settings_instance_search_users()}
					aria-label={m.settings_instance_search_users()}
					maxlength={200}
					class="pl-9"
					onkeydown={(event) => {
						if (event.key === 'Enter' && !event.isComposing) {
							event.preventDefault();
							submitSearch();
						}
					}}
				/>
			</div>
			<Button type="submit" variant="outline" disabled={usersLoading}>
				{#if usersLoading && users}
					<LoaderIcon class="animate-spin" />
				{/if}
				{m.settings_instance_search()}
			</Button>
			{#if appliedSearch}
				<Button type="button" variant="ghost" onclick={clearSearch} disabled={usersLoading}>
					{m.settings_instance_clear_search()}
				</Button>
			{/if}
		</div>

		<DropdownMenu.Root>
			<DropdownMenu.Trigger>
				{#snippet child({ props })}
					<Button {...props} type="button" variant="outline">
						{m.settings_instance_columns()}
						<ChevronDownIcon class="size-4" />
					</Button>
				{/snippet}
			</DropdownMenu.Trigger>
			<DropdownMenu.Content align="end">
				{#each table.getAllColumns().filter((column) => column.getCanHide()) as column (column.id)}
					<DropdownMenu.CheckboxItem
						bind:checked={() => column.getIsVisible(), (value) => column.toggleVisibility(!!value)}
					>
						{columnLabel(column.id)}
					</DropdownMenu.CheckboxItem>
				{/each}
			</DropdownMenu.Content>
		</DropdownMenu.Root>
	</form>

	{#if usersLoading && !users}
		<PageLoading layout="list" label={m.common_loading()} items={7} />
	{:else}
		{#if usersError}
			<InlineNotice tone={users ? 'warning' : 'error'} message={usersError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={retryUsers}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{/if}

		{#if users && users.total === 0 && !appliedSearch}
			<EmptyState
				icon={UserRoundIcon}
				title={m.settings_instance_no_users()}
				description={m.settings_instance_no_users_body()}
				variant="muted"
				headingLevel={3}
			/>
		{:else if users}
			<div
				class={['overflow-x-auto rounded-lg border', usersLoading && 'opacity-70']}
				aria-busy={usersLoading}
				data-testid="instance-user-directory"
			>
				<Table.Root class="min-w-[72rem]">
					<Table.Header class="bg-muted/30">
						{#each table.getHeaderGroups() as headerGroup (headerGroup.id)}
							<Table.Row>
								{#each headerGroup.headers as header (header.id)}
									<Table.Head
										colspan={header.colSpan}
										class={header.column.id === 'actions'
											? 'sticky right-0 z-10 border-l bg-muted/95 px-3'
											: 'px-3'}
									>
										{#if !header.isPlaceholder}
											<FlexRender
												content={header.column.columnDef.header}
												context={header.getContext()}
											/>
										{/if}
									</Table.Head>
								{/each}
							</Table.Row>
						{/each}
					</Table.Header>
					<Table.Body>
						{#each table.getRowModel().rows as row (row.original.id)}
							<Table.Row class="group">
								{#each row.getVisibleCells() as cell (cell.id)}
									<Table.Cell
										class={cell.column.id === 'actions'
											? 'sticky right-0 border-l bg-background px-3 group-hover:bg-muted/50'
											: 'px-3 py-3'}
									>
										<FlexRender content={cell.column.columnDef.cell} context={cell.getContext()} />
									</Table.Cell>
								{/each}
							</Table.Row>
						{:else}
							<Table.Row>
								<Table.Cell
									colspan={table.getVisibleLeafColumns().length}
									class="h-28 text-center text-sm text-muted-foreground"
								>
									{m.settings_instance_no_matching_users()}
								</Table.Cell>
							</Table.Row>
						{/each}
					</Table.Body>
				</Table.Root>
			</div>

			<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<p class="text-sm text-muted-foreground" aria-live="polite">
					{m.settings_instance_users_range({
						start: formatNumber(firstVisibleUser),
						end: formatNumber(lastVisibleUser),
						total: formatNumber(users.total)
					})}
				</p>
				{#if users.total_pages > 1}
					<Pagination.Root
						count={users.total}
						perPage={users.per_page}
						page={userPage}
						onPageChange={changeUserPage}
						class="mx-0 w-auto justify-start sm:justify-end"
						aria-label={m.settings_instance_user_pagination()}
					>
						{#snippet children({ pages, currentPage })}
							<Pagination.Content>
								<Pagination.Item>
									<Pagination.Previous
										label={m.settings_instance_previous()}
										ariaLabel={m.settings_instance_previous_user_page()}
									/>
								</Pagination.Item>
								{#each pages as paginationPage (paginationPage.key)}
									{#if paginationPage.type === 'ellipsis'}
										<Pagination.Item>
											<Pagination.Ellipsis label={m.settings_instance_more_user_pages()} />
										</Pagination.Item>
									{:else}
										<Pagination.Item>
											<Pagination.Link
												page={paginationPage}
												isActive={currentPage === paginationPage.value}
												ariaLabel={m.settings_instance_go_to_user_page({
													page: formatNumber(paginationPage.value)
												})}
											>
												{paginationPage.value}
											</Pagination.Link>
										</Pagination.Item>
									{/if}
								{/each}
								<Pagination.Item>
									<Pagination.Next
										label={m.settings_instance_next()}
										ariaLabel={m.settings_instance_next_user_page()}
									/>
								</Pagination.Item>
							</Pagination.Content>
						{/snippet}
					</Pagination.Root>
				{/if}
			</div>
		{/if}
	{/if}
</div>

<Dialog.Root open={impersonationDialogOpen} onOpenChange={handleImpersonationDialogOpenChange}>
	<Dialog.Content class="sm:max-w-lg">
		<Dialog.Header>
			<Dialog.Title>
				{m.settings_instance_impersonation_title({
					user: impersonationUser?.display_name.trim() || impersonationUser?.email || ''
				})}
			</Dialog.Title>
			<Dialog.Description>{m.settings_instance_impersonation_body()}</Dialog.Description>
		</Dialog.Header>

		{#if impersonationBusyUserID}
			<div class="flex min-h-24 items-center justify-center gap-2 text-sm text-muted-foreground">
				<LoaderIcon class="size-4 animate-spin" />
				{m.settings_instance_impersonation_creating()}
			</div>
		{:else if impersonationError && !impersonationURL}
			<InlineNotice tone="error" message={impersonationError} />
		{:else if impersonationURL}
			<div class="space-y-4">
				<div class="space-y-2">
					<Label for="instance-impersonation-link">
						{m.settings_instance_impersonation_link()}
					</Label>
					<div class="flex gap-2">
						<Input
							id="instance-impersonation-link"
							value={impersonationURL}
							readonly
							class="font-mono text-xs"
						/>
						<Button variant="outline" onclick={copyImpersonationLink}>
							{#if impersonationCopied}
								<CheckIcon class="text-emerald-600 dark:text-emerald-400" />
								{m.settings_instance_copied()}
							{:else}
								<CopyIcon />
								{m.settings_instance_copy_link()}
							{/if}
						</Button>
					</div>
				</div>
				<p class="text-sm text-muted-foreground">
					{m.settings_instance_impersonation_private_window()}
				</p>
				<p class="text-xs text-muted-foreground">
					{m.settings_instance_impersonation_expires({
						time: formatDateTime(impersonationExpiresAt)
					})}
				</p>
				{#if impersonationError}
					<InlineNotice tone="error" message={impersonationError} />
				{/if}
			</div>
		{/if}

		<Dialog.Footer>
			<Button variant="outline" onclick={() => handleImpersonationDialogOpenChange(false)}>
				{m.common_close()}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>

<InstanceUserPlanDialog
	open={planDialogOpen}
	user={planDialogUser}
	onOpenChange={handlePlanDialogOpenChange}
/>
