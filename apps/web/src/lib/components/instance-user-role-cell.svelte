<script lang="ts">
	import { Badge } from '$lib/components/ui/badge';
	import { m } from '$lib/paraglide/messages';

	let { isAdmin }: { isAdmin: boolean } = $props();
</script>

<Badge
	class={isAdmin
		? 'border-primary/20 bg-primary/10 text-primary'
		: 'bg-muted text-muted-foreground'}
>
	{isAdmin ? m.settings_instance_user_admin() : m.settings_instance_user_member()}
</Badge>
