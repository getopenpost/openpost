<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolve } from '$app/paths';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import type { SettingsDestinationID } from '$lib/settings-navigation';

	interface SettingsDestination {
		id: SettingsDestinationID;
		label: string;
	}

	interface Props {
		active: SettingsDestinationID;
	}

	let { active }: Props = $props();

	const personalDestinations = $derived<SettingsDestination[]>([
		{ id: 'profile', label: m.settings_profile() },
		{ id: 'security', label: m.settings_security() },
		{ id: 'developer', label: m.settings_developer() }
	]);
	const workspaceDestinations = $derived<SettingsDestination[]>([
		{ id: 'general', label: m.settings_general() },
		{ id: 'brand', label: m.media_brand() },
		{ id: 'schedule', label: m.settings_schedule() },
		{ id: 'media', label: m.settings_media() },
		{ id: 'accounts', label: m.accounts_heading() }
	]);
	const teamDestinations = $derived<SettingsDestination[]>([
		{ id: 'members', label: m.settings_members() },
		{ id: 'plan', label: m.settings_plan() }
	]);
	const allDestinations = $derived([
		...personalDestinations,
		...workspaceDestinations,
		...teamDestinations
	]);
	const activeLabel = $derived(
		allDestinations.find((destination) => destination.id === active)?.label ?? m.settings_general()
	);

	function destinationHref(destination: SettingsDestinationID): string {
		if (destination === 'accounts') return '/accounts';
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

<aside class="min-w-0 lg:sticky lg:top-6" data-testid="settings-navigation">
	<Select.Root
		type="single"
		value={active}
		onValueChange={(value) => value && openDestination(value as SettingsDestinationID)}
	>
		<Select.Trigger class="w-full lg:hidden" aria-label={m.settings_nav_label()}>
			{activeLabel}
		</Select.Trigger>
		<Select.Content>
			<Select.Group>
				<Select.GroupHeading>{m.settings_personal()}</Select.GroupHeading>
				{#each personalDestinations as destination (destination.id)}
					<Select.Item value={destination.id}>{destination.label}</Select.Item>
				{/each}
			</Select.Group>
			<Select.Separator />
			<Select.Group>
				<Select.GroupHeading>{m.settings_workspace()}</Select.GroupHeading>
				{#each workspaceDestinations as destination (destination.id)}
					<Select.Item value={destination.id}>{destination.label}</Select.Item>
				{/each}
			</Select.Group>
			<Select.Separator />
			<Select.Group>
				<Select.GroupHeading>{m.settings_team_billing()}</Select.GroupHeading>
				{#each teamDestinations as destination (destination.id)}
					<Select.Item value={destination.id}>{destination.label}</Select.Item>
				{/each}
			</Select.Group>
		</Select.Content>
	</Select.Root>

	<nav class="hidden max-w-full gap-2 lg:flex lg:flex-col" aria-label={m.settings_nav_label()}>
		<p class="px-2 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_personal()}
		</p>
		{#each personalDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}

		<p class="px-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_workspace()}
		</p>
		{#each workspaceDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}

		<p class="px-2 pt-4 text-[11px] font-medium tracking-[0.12em] text-muted-foreground uppercase">
			{m.settings_team_billing()}
		</p>
		{#each teamDestinations as destination (destination.id)}
			{@render destinationLink(destination)}
		{/each}
	</nav>
</aside>
