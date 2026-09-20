<script lang="ts">
	import { onMount } from 'svelte';
	import { ensureKokoroPhonemizer } from './kokoro-phonemizer';

	let result = $state('loading');

	onMount(async () => {
		try {
			await ensureKokoroPhonemizer();
			result = 'ready';
		} catch (error) {
			result = error instanceof Error ? error.message : String(error);
		}
	});
</script>

<output aria-live="polite">{result}</output>
