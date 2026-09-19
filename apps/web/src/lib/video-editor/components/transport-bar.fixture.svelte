<script lang="ts">
	import TransportBar from './transport-bar.svelte';

	let { width }: { width: number } = $props();
</script>

<div class="@container/program" style:width={`${width}px`}>
	<TransportBar projectId="transport-test" />
</div>
