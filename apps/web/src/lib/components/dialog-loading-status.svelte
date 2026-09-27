<script lang="ts">
	import { ProtectedIcon } from '$lib/themes/icons';
	import { m } from '$lib/paraglide/messages';
</script>

<!--
	Shared loading placeholder for delete dialogs. The live status exposes the
	loading label to assistive technology instead of silently ignoring it on a
	role-less container.
-->
<div
	class="flex min-h-32 items-center justify-center"
	role="status"
	aria-label={m.common_loading()}
>
	<ProtectedIcon icon="loading" class="size-5 animate-spin" />
</div>
