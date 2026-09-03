<script lang="ts">
	import {
		provideSettingsInitialLoadBoundary,
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT,
		type SettingsInitialLoadPlan
	} from './settings-initial-load.svelte';

	let { plan, pending }: { plan: SettingsInitialLoadPlan; pending: boolean } = $props();
	const boundary = provideSettingsInitialLoadBoundary(() => plan);
	const reportInitialLoad = registerSettingsInitialLoad(SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule);
	$effect(() => reportInitialLoad(pending));
	$effect.pre(() => boundary.activate(plan));
</script>

<output
	data-testid="settings-initial-loading"
	data-loading={boundary.loading}
	data-pending={pending}
>
	{boundary.loading ? 'loading' : 'ready'}
</output>
