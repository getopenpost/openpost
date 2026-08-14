<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Select from '$lib/components/ui/select';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import type { SettingsDestinationID } from '$lib/settings-navigation';
	import SearchIcon from '@lucide/svelte/icons/search';

	interface SettingsDestination {
		id: SettingsDestinationID;
		label: string;
	}

	interface Props {
		active: SettingsDestinationID;
		showInstance?: boolean;
	}

	let { active, showInstance = false }: Props = $props();
	let search = $state('');

	const personalDestinations = $derived<SettingsDestination[]>([
		{ id: 'profile', label: m.settings_profile() },
		{ id: 'notifications', label: m.notifications_settings() },
		{ id: 'security', label: m.settings_security() },
		{ id: 'developer', label: m.settings_developer() }
	]);
	const workspaceDestinations = $derived<SettingsDestination[]>([
		{ id: 'general', label: m.settings_general() },
		{ id: 'brand', label: m.media_brand() },
		{ id: 'accounts', label: m.accounts_heading() },
		{ id: 'reposts', label: m.settings_reposts() },
		{ id: 'schedule', label: m.settings_schedule() },
		{ id: 'members', label: m.settings_members() }
	]);
	const organizationDestinations = $derived<SettingsDestination[]>([
		{ id: 'plan', label: m.settings_plan() },
		{ id: 'sso', label: m.settings_sso() },
		{ id: 'audit', label: m.settings_audit_title() }
	]);
	const instanceDestinations = $derived<SettingsDestination[]>(
		showInstance
			? [
					{ id: 'instance', label: m.settings_instance() },
					{ id: 'configuration', label: m.settings_configuration() },
					{ id: 'users', label: m.settings_instance_users() },
					{ id: 'instance-audit', label: m.settings_instance_audit_title() }
				]
			: []
	);
	const allDestinations = $derived([
		...personalDestinations,
		...workspaceDestinations,
		...organizationDestinations,
		...instanceDestinations
	]);
	const activeLabel = $derived(
		allDestinations.find((destination) => destination.id === active)?.label ?? m.settings_general()
	);
	const normalizedSearch = $derived(search.trim().toLocaleLowerCase());
	const filteredPersonalDestinations = $derived(
		personalDestinations.filter((destination) => matchesSearch(destination))
	);
	const filteredWorkspaceDestinations = $derived(
		workspaceDestinations.filter((destination) => matchesSearch(destination))
	);
	const filteredOrganizationDestinations = $derived(
		organizationDestinations.filter((destination) => matchesSearch(destination))
	);
	const filteredInstanceDestinations = $derived(
		instanceDestinations.filter((destination) => matchesSearch(destination))
	);
	const hasSearchResults = $derived(
		filteredPersonalDestinations.length +
			filteredWorkspaceDestinations.length +
			filteredOrganizationDestinations.length +
			filteredInstanceDestinations.length >
			0
	);

	function matchesSearch(destination: SettingsDestination) {
		return !normalizedSearch || destination.label.toLocaleLowerCase().includes(normalizedSearch);
	}

	function destinationHref(destination: SettingsDestinationID): string {
		return `/settings?tab=${destination}`;
	}

	function openDestination(destination: SettingsDestinationID) {
		void goto(resolve(destinationHref(destination) as '/'));
	}
</script>

{#snippet destinationLink(destination: SettingsDestination)}
	<a
		href={resolve(destinationHref(destination.id) as '/')}
		data-settings-tab={destination.id}
		class={[
			'min-h-10 shrink-0 rounded-md px-3 py-2 text-left text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none lg:w-full',
			active === destination.id
				? 'bg-accent text-foreground'
				: 'text-muted-foreground hover:bg-accent/60 hover:text-foreground'
		]}
		aria-current={active === destination.id ? 'page' : undefined}
	>
		{destination.label}
	</a>
{/snippet}

<aside class="min-w-0 lg:sticky lg:top-6 lg:self-start" data-testid="settings-navigation">
	<div class="relative mb-3">
		<SearchIcon
			class="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
		/>
		<Input
			bind:value={search}
			class="pl-9"
			placeholder={m.settings_search()}
			aria-label={m.settings_search()}
		/>
	</div>
	<Select.Root
		type="single"
		value={active}
		onValueChange={(value) => value && openDestination(value as SettingsDestinationID)}
	>
		<Select.Trigger class="w-full lg:hidden" aria-label={m.settings_nav_label()}>
			{activeLabel}
		</Select.Trigger>
		<Select.Content>
			{#if filteredPersonalDestinations.length}<Select.Group>
					<Select.GroupHeading>{m.settings_personal()}</Select.GroupHeading>
					{#each filteredPersonalDestinations as destination (destination.id)}
						<Select.Item value={destination.id}>{destination.label}</Select.Item>
					{/each}
				</Select.Group>{/if}
			{#if filteredWorkspaceDestinations.length}<Select.Separator />
				<Select.Group>
					<Select.GroupHeading>{m.settings_workspace()}</Select.GroupHeading>
					{#each filteredWorkspaceDestinations as destination (destination.id)}
						<Select.Item value={destination.id}>{destination.label}</Select.Item>
					{/each}
				</Select.Group>{/if}
			{#if filteredOrganizationDestinations.length}<Select.Separator />
				<Select.Group>
					<Select.GroupHeading>{m.settings_organization()}</Select.GroupHeading>
					{#each filteredOrganizationDestinations as destination (destination.id)}
						<Select.Item value={destination.id}>{destination.label}</Select.Item>
					{/each}
				</Select.Group>{/if}
			{#if filteredInstanceDestinations.length}
				<Select.Separator />
				<Select.Group>
					<Select.GroupHeading>{m.settings_instance()}</Select.GroupHeading>
					{#each filteredInstanceDestinations as destination (destination.id)}
						<Select.Item value={destination.id}>{destination.label}</Select.Item>
					{/each}
				</Select.Group>
			{/if}
		</Select.Content>
	</Select.Root>

	<nav class="hidden max-w-full gap-2 lg:flex lg:flex-col" aria-label={m.settings_nav_label()}>
		<p class="px-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_personal()}
		</p>
		{#each filteredPersonalDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}

		<p class="px-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_workspace()}
		</p>
		{#each filteredWorkspaceDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}

		<p class="px-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_organization()}
		</p>
		{#each filteredOrganizationDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}

		{#if filteredInstanceDestinations.length}
			<p
				class="px-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase"
			>
				{m.settings_instance()}
			</p>
			{#each filteredInstanceDestinations as destination (destination.id)}
				{@render destinationLink(destination)}
			{/each}
		{/if}
		{#if !hasSearchResults}
			<p class="px-3 py-4 text-sm text-muted-foreground">{m.settings_search_empty()}</p>
		{/if}
	</nav>
</aside>
