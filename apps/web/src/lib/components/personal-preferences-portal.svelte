<script lang="ts">
	import { captureClientException } from '@openpost/telemetry';
	import { ui } from '$lib/stores/ui.svelte';

	let PersonalPreferencesDialog = $state<
		typeof import('./personal-preferences-dialog.svelte').default | null
	>(null);
	$effect(() => {
		if (!ui.isPreferencesOpen || PersonalPreferencesDialog) return;
		let current = true;
		void import('./personal-preferences-dialog.svelte')
			.then((module) => {
				if (current) PersonalPreferencesDialog = module.default;
			})
			.catch((error) =>
				captureClientException(error, { error_boundary: 'personal_preferences_startup' })
			);
		return () => {
			current = false;
		};
	});
</script>

{#if PersonalPreferencesDialog}
	<PersonalPreferencesDialog />
{/if}
