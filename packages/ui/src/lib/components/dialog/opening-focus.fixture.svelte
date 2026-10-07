<script lang="ts">
	import * as Dialog from './index';
	let { onOpenAutoFocus }: { onOpenAutoFocus: (event: Event) => void } = $props();
</script>

<Dialog.Root open>
	<Dialog.Content trapFocus={false} {onOpenAutoFocus}>
		<Dialog.Title>Nonmodal details</Dialog.Title>
		<Dialog.Description>Focus can remain outside these details.</Dialog.Description>
		<button>First action</button>
	</Dialog.Content>
</Dialog.Root>
