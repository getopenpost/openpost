<script lang="ts">
	import {
		provideSettingsInitialLoadBoundary,
		registerSettingsInitialLoad,
		SETTINGS_INITIAL_LOAD_PARTICIPANT,
		type SettingsInitialLoadPlan
	} from './settings-initial-load.svelte';

	let { plan }: { plan: SettingsInitialLoadPlan } = $props();
	const boundary = provideSettingsInitialLoadBoundary(() => plan);
	$effect.pre(() => boundary.activate(plan));

	// Mirrors the settings tabs: a load effect that starts with a stale scope marker
	// and completes asynchronously, reporting initial-load state to the boundary.
	let workspaceID = $state('ws-1');
	let loadError = $state('');
	let loading = $state(false);
	let ready = $state(false);
	let loadedWorkspaceID = '';

	const reportInitialLoad = registerSettingsInitialLoad(SETTINGS_INITIAL_LOAD_PARTICIPANT.schedule);

	$effect(() => {
		// The load-state reads must stay unconditional (hoisted out of the conditional)
		// so they remain tracked even when the scope term short-circuits.
		const waitingForLoad = loading && !ready;
		reportInitialLoad(
			Boolean(workspaceID && !loadError && (loadedWorkspaceID !== workspaceID || waitingForLoad))
		);
	});

	$effect(() => {
		if (!workspaceID) return;
		loadedWorkspaceID = workspaceID;
		loading = true;
		const timer = setTimeout(() => {
			loading = false;
			ready = true;
		}, 25);
		return () => clearTimeout(timer);
	});
</script>

<output data-testid="settings-participant-loading" data-loading={boundary.loading}>
	{boundary.loading ? 'loading' : 'ready'}
</output>
