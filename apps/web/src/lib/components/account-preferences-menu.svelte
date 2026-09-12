<script lang="ts">
	import { canInstallApp, installApp } from '$lib/pwa/install';
	import { showToast } from '$lib/toast';
	import { goto } from '$app/navigation';
	import { get } from 'svelte/store';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { m } from '$lib/paraglide/messages';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import { ThemeIcon } from '$lib/themes/icons';
	import { ui } from '$lib/stores/ui.svelte';
	let { onNavigate }: { onNavigate?: () => void } = $props();

	async function handleLogout() {
		const route = `${window.location.pathname}${window.location.search}`;
		onNavigate?.();
		if (
			!(await auth.logout()) ||
			get(auth).user ||
			`${window.location.pathname}${window.location.search}` !== route
		)
			return;
		await goto(resolveAppPath('/login'));
	}
</script>

<DropdownMenu.Label class="grid gap-0.5">
	<span class="truncate">{$auth.user?.display_name}</span>
	<span class="truncate font-normal text-muted-foreground">{$auth.user?.email}</span>
</DropdownMenu.Label>
<DropdownMenu.Separator />
<DropdownMenu.Item
	class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11"
	onclick={() => {
		onNavigate?.();
		goto(resolveAppPath('/settings?tab=profile'));
	}}
>
	<ThemeIcon role="settings" class="size-4 text-muted-foreground" />{m.sidebar_settings()}
</DropdownMenu.Item>
<DropdownMenu.Item
	class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11"
	onclick={() => {
		onNavigate?.();
		ui.isPreferencesOpen = true;
	}}
>
	<ThemeIcon role="controls" class="size-4 text-muted-foreground" />{m.personal_preferences()}
</DropdownMenu.Item>
<DropdownMenu.Separator />
<DropdownMenu.Item
	class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11"
	onclick={() => {
		onNavigate?.();
		ui.openFeedback();
	}}
>
	<ThemeIcon role="feedback" class="size-4 text-muted-foreground" />{m.personal_help_feedback()}
</DropdownMenu.Item>
{#if $canInstallApp}
	<DropdownMenu.Item
		class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11"
		onclick={() => {
			onNavigate?.();
			void installApp().catch(() => showToast(m.pwa_install_failed(), 'error'));
		}}
	>
		<ThemeIcon role="download" class="size-4 text-muted-foreground" />{m.pwa_install_action()}
	</DropdownMenu.Item>
{/if}
<DropdownMenu.Separator />
<DropdownMenu.Item class="min-h-9 gap-3 [@media(pointer:coarse)]:min-h-11" onclick={handleLogout}>
	<ThemeIcon role="logout" class="size-4 text-muted-foreground" />{m.sidebar_log_out()}
</DropdownMenu.Item>
