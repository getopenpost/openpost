<script lang="ts">
	import { onMount } from 'svelte';
	import BarChartIcon from 'lucide-svelte/icons/chart-no-axes-column-increasing';
	import UserRoundIcon from 'lucide-svelte/icons/user-round';
	import UsersIcon from 'lucide-svelte/icons/users';
	import type { components } from '$lib/api/types';
	import { client } from '$lib/api/client';
	import EmptyState from '$lib/components/empty-state.svelte';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import InstanceAdminTrend from '$lib/components/instance-admin-trend.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import SectionHeader from '$lib/components/section-header.svelte';
	import * as Avatar from '$lib/components/ui/avatar';
	import { Badge } from '$lib/components/ui/badge';
	import { Button } from '$lib/components/ui/button';
	import * as Pagination from '$lib/components/ui/pagination';
	import { getLocaleTag } from '$lib/i18n';
	import { m } from '$lib/paraglide/messages';

	type InstanceOverview = components['schemas']['InstanceOverviewResponse'];
	type InstanceUserPage = components['schemas']['InstanceUserPage'];
	type InstanceUser = components['schemas']['InstanceUserResponse'];

	const USERS_PER_PAGE = 20;

	let overview = $state.raw<InstanceOverview | null>(null);
	let overviewLoading = $state(true);
	let overviewError = $state('');
	let userPage = $state(1);
	let users = $state.raw<InstanceUserPage | null>(null);
	let usersLoading = $state(true);
	let usersError = $state('');
	let usersRequestSequence = 0;

	const visibleUsers = $derived(users?.users ?? []);
	const firstVisibleUser = $derived(
		users && users.total > 0 ? (users.page - 1) * users.per_page + 1 : 0
	);
	const lastVisibleUser = $derived(users ? Math.min(users.page * users.per_page, users.total) : 0);

	onMount(() => {
		void loadOverview();
		void loadUsers(userPage);
	});

	async function loadOverview() {
		overviewLoading = true;
		overviewError = '';
		const { data, error } = await client.GET('/admin/overview');
		if (error || !data) {
			overviewError = problemDetail(error, m.settings_instance_overview_load_failed());
			overviewLoading = false;
			return;
		}
		overview = data;
		overviewLoading = false;
	}

	async function loadUsers(requestedPage: number) {
		const sequence = ++usersRequestSequence;
		usersLoading = true;
		usersError = '';
		const { data, error } = await client.GET('/admin/users', {
			params: { query: { page: requestedPage, per_page: USERS_PER_PAGE } }
		});
		if (sequence !== usersRequestSequence) return;
		if (error || !data) {
			usersError = problemDetail(error, m.settings_instance_users_load_failed());
			usersLoading = false;
			return;
		}
		if (data.total_pages > 0 && requestedPage > data.total_pages) {
			userPage = data.total_pages;
			void loadUsers(data.total_pages);
			return;
		}
		users = data;
		usersLoading = false;
	}

	function changeUserPage(nextPage: number) {
		userPage = nextPage;
		void loadUsers(nextPage);
	}

	function problemDetail(error: unknown, fallback: string) {
		if (error && typeof error === 'object' && 'detail' in error) {
			const detail = error.detail;
			if (typeof detail === 'string' && detail.trim()) return detail;
		}
		return fallback;
	}

	function formatNumber(value: number) {
		return new Intl.NumberFormat(getLocaleTag()).format(value);
	}

	function formatJoinDate(value: string) {
		if (!value) return '—';
		const date = new Date(value);
		if (Number.isNaN(date.getTime())) return '—';
		return new Intl.DateTimeFormat(getLocaleTag(), {
			year: 'numeric',
			month: 'short',
			day: 'numeric'
		}).format(date);
	}

	function userName(user: InstanceUser) {
		return user.display_name.trim() || user.email;
	}

	function userInitials(user: InstanceUser) {
		const name = user.display_name.trim();
		if (!name) return user.email.slice(0, 1).toUpperCase();
		return name
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part.slice(0, 1))
			.join('')
			.toUpperCase();
	}
</script>

<div class="space-y-10" data-testid="instance-admin-overview">
	<section class="space-y-4">
		<SectionHeader
			title={m.settings_instance_overview()}
			description={m.settings_instance_overview_body()}
			icon={BarChartIcon}
			class="mb-4"
		/>

		{#if overviewLoading}
			<PageLoading layout="grid" label={m.common_loading()} items={4} />
		{:else if overviewError}
			<InlineNotice tone="error" message={overviewError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void loadOverview()}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if overview}
			<dl
				class="grid overflow-hidden rounded-lg border bg-muted/15 sm:grid-cols-2 xl:grid-cols-4"
				aria-label={m.settings_instance_overview()}
			>
				<div class="border-b p-4 sm:border-r xl:border-b-0">
					<dt class="text-sm text-muted-foreground">{m.settings_instance_total_users()}</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.total_users)}
					</dd>
				</div>
				<div class="border-b p-4 xl:border-r xl:border-b-0">
					<dt class="text-sm text-muted-foreground">{m.settings_instance_new_users()}</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.new_users_last_30_days)}
					</dd>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_last_30_days()}
					</p>
				</div>
				<div class="border-b p-4 sm:border-r sm:border-b-0">
					<dt class="text-sm text-muted-foreground">{m.settings_instance_workspaces()}</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.total_workspaces)}
					</dd>
				</div>
				<div class="p-4">
					<dt class="text-sm text-muted-foreground">{m.settings_instance_published_posts()}</dt>
					<dd class="mt-1 text-2xl font-semibold tracking-tight tabular-nums">
						{formatNumber(overview.published_last_30_days)}
					</dd>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_last_30_days()}
					</p>
				</div>
			</dl>

			<div class="grid overflow-hidden rounded-lg border lg:grid-cols-2">
				<div class="min-w-0 border-b p-4 lg:border-r lg:border-b-0">
					<h3 class="text-sm font-semibold">{m.settings_instance_registration_trend()}</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_registration_trend_body()}
					</p>
					<div class="mt-4">
						<InstanceAdminTrend
							points={overview.user_registration_trend ?? []}
							label={m.settings_instance_registration_trend()}
							seriesLabel={m.settings_instance_new_accounts()}
							emptyLabel={m.settings_instance_chart_no_activity()}
						/>
					</div>
				</div>
				<div class="min-w-0 p-4">
					<h3 class="text-sm font-semibold">{m.settings_instance_publication_trend()}</h3>
					<p class="mt-1 text-xs text-muted-foreground">
						{m.settings_instance_publication_trend_body()}
					</p>
					<div class="mt-4">
						<InstanceAdminTrend
							points={overview.publication_trend ?? []}
							label={m.settings_instance_publication_trend()}
							seriesLabel={m.settings_instance_successful_publications()}
							emptyLabel={m.settings_instance_chart_no_activity()}
						/>
					</div>
				</div>
			</div>
		{/if}
	</section>

	<section class="space-y-4">
		<SectionHeader
			title={m.settings_instance_users()}
			description={m.settings_instance_users_body()}
			icon={UsersIcon}
			class="mb-4"
		/>

		{#if usersLoading && !users}
			<PageLoading layout="list" label={m.common_loading()} items={5} />
		{:else if usersError}
			<InlineNotice tone="error" message={usersError}>
				{#snippet actions()}
					<Button variant="outline" size="sm" onclick={() => void loadUsers(userPage)}>
						{m.common_retry()}
					</Button>
				{/snippet}
			</InlineNotice>
		{:else if users && visibleUsers.length === 0}
			<EmptyState
				icon={UserRoundIcon}
				title={m.settings_instance_no_users()}
				description={m.settings_instance_no_users_body()}
				variant="muted"
				headingLevel={3}
			/>
		{:else if users}
			<div
				class="overflow-hidden rounded-lg border"
				aria-busy={usersLoading}
				data-testid="instance-user-directory"
			>
				<div
					class="hidden grid-cols-[minmax(0,1.6fr)_10rem_8rem_10rem] gap-4 border-b bg-muted/30 px-4 py-2 text-xs font-medium text-muted-foreground md:grid"
					aria-hidden="true"
				>
					<span>{m.settings_instance_user()}</span>
					<span>{m.settings_role()}</span>
					<span>{m.settings_instance_workspaces()}</span>
					<span>{m.settings_instance_joined()}</span>
				</div>
				<ul class="divide-y">
					{#each visibleUsers as user (user.id)}
						<li
							class="grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 gap-y-3 p-4 md:grid-cols-[minmax(0,1.6fr)_10rem_8rem_10rem] md:items-center"
						>
							<div class="flex min-w-0 items-center gap-3">
								<Avatar.Root class="size-9">
									{#if user.avatar_url}
										<Avatar.Image src={user.avatar_url} alt="" />
									{/if}
									<Avatar.Fallback>{userInitials(user)}</Avatar.Fallback>
								</Avatar.Root>
								<div class="min-w-0">
									<h3 class="truncate text-sm font-medium" title={userName(user)}>
										{userName(user)}
									</h3>
									<p class="truncate text-xs text-muted-foreground" title={user.email}>
										{user.email}
									</p>
								</div>
							</div>
							<div>
								<span class="sr-only md:hidden">{m.settings_role()}: </span>
								<Badge
									class={user.is_admin
										? 'border-primary/20 bg-primary/10 text-primary'
										: 'bg-muted text-muted-foreground'}
								>
									{user.is_admin
										? m.settings_instance_user_admin()
										: m.settings_instance_user_member()}
								</Badge>
							</div>
							<p class="text-sm tabular-nums">
								<span class="text-muted-foreground md:sr-only">
									{m.settings_instance_workspaces()}:
								</span>
								{formatNumber(user.workspace_count)}
							</p>
							<p class="text-right text-sm text-muted-foreground md:text-left">
								<span class="md:sr-only">{m.settings_instance_joined()} </span>
								<time datetime={user.created_at}>{formatJoinDate(user.created_at)}</time>
							</p>
						</li>
					{/each}
				</ul>
			</div>

			{#if users.total_pages > 1}
				<div class="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
					<p class="text-sm text-muted-foreground" aria-live="polite">
						{m.settings_instance_users_range({
							start: formatNumber(firstVisibleUser),
							end: formatNumber(lastVisibleUser),
							total: formatNumber(users.total)
						})}
					</p>
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
				</div>
			{/if}
		{/if}
	</section>
</div>
