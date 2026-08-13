<script lang="ts">
	import EyeIcon from '@lucide/svelte/icons/eye';
	import EyeOffIcon from '@lucide/svelte/icons/eye-off';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import { m } from '$lib/paraglide/messages';

	type Props = {
		id: string;
		label: string;
		value?: string;
		autocomplete: 'current-password' | 'new-password';
		placeholder?: string;
		describedby?: string;
		minlength?: number;
		maxlength?: number;
		required?: boolean;
		disabled?: boolean;
	};

	let {
		id,
		label,
		value = $bindable(''),
		autocomplete,
		placeholder,
		describedby,
		minlength,
		maxlength,
		required = false,
		disabled = false
	}: Props = $props();

	let visible = $state(false);
</script>

<div class="space-y-2">
	<Label for={id}>{label}</Label>
	<div class="relative">
		<Input
			type={visible ? 'text' : 'password'}
			{id}
			bind:value
			{required}
			{disabled}
			{autocomplete}
			{placeholder}
			{minlength}
			{maxlength}
			aria-describedby={describedby}
			class="pr-12"
		/>
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			class="absolute top-1/2 right-0 -translate-y-1/2 text-muted-foreground hover:text-foreground"
			aria-label={visible ? m.auth_password_hide() : m.auth_password_show()}
			aria-pressed={visible}
			onclick={() => (visible = !visible)}
			{disabled}
		>
			{#if visible}
				<EyeOffIcon aria-hidden="true" />
			{:else}
				<EyeIcon aria-hidden="true" />
			{/if}
		</Button>
	</div>
</div>
