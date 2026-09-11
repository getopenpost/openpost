<script lang="ts">
	import type { Snippet } from 'svelte';
	import * as Sidebar from './ui/sidebar';
	import SidebarLeft from './sidebar-left.svelte';
	import MobileBottomNav from './mobile-bottom-nav.svelte';
	import BillingRecoveryNotice from './billing-recovery-notice.svelte';
	import DayPostsModal from './day-posts-modal.svelte';
	import FeedbackDialog from './feedback-dialog.svelte';
	import PersonalPreferencesDialog from './personal-preferences-dialog.svelte';
	import { workspaceCtx } from '$lib/stores/workspace.svelte';
	import { m } from '$lib/paraglide/messages';

	let { children }: { children: Snippet } = $props();
</script>

<a
	href="#main-content"
	class="fixed top-2 left-2 z-[100] -translate-y-16 rounded-md bg-background px-3 py-2 text-sm font-medium shadow-lg transition-transform focus:translate-y-0 focus:ring-2 focus:ring-ring focus:outline-none"
>
	{m.common_skip_to_content()}
</a>
<Sidebar.Provider style="padding-top: env(safe-area-inset-top);">
	<SidebarLeft />
	<Sidebar.Inset
		id="main-content"
		tabindex={-1}
		class="pb-[var(--mobile-bottom-nav-clearance)] md:pb-0"
	>
		<BillingRecoveryNotice workspaceID={workspaceCtx.currentWorkspace?.id ?? ''} />
		<div class="flex min-h-0 flex-1 flex-col overflow-auto">
			{@render children()}
		</div>
		<MobileBottomNav />
		<DayPostsModal />
		<FeedbackDialog />
		<PersonalPreferencesDialog />
	</Sidebar.Inset>
</Sidebar.Provider>
