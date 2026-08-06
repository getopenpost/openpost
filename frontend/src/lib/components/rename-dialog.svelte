<script lang="ts">
	import LoaderIcon from 'lucide-svelte/icons/loader-2';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open?: boolean;
		title: string;
		description: string;
		label: string;
		initialValue: string;
		maxLength?: number;
		onConfirm: (value: string) => void | Promise<void>;
	}

	let {
		open = $bindable(false),
		title,
		description,
		label,
		initialValue,
		maxLength = 255,
		onConfirm
	}: Props = $props();

	let value = $state('');
	let pending = $state(false);
	let error = $state('');

	function handleOpenChange(nextOpen: boolean): void {
		open = nextOpen;
		if (nextOpen) {
			value = initialValue;
			error = '';
		}
	}

	async function submit(): Promise<void> {
		const nextValue = value.trim();
		if (!nextValue || pending) return;
		pending = true;
		error = '';
		try {
			await onConfirm(nextValue);
			open = false;
		} catch (cause) {
			error = cause instanceof Error ? cause.message : m.common_rename_failed();
		} finally {
			pending = false;
		}
	}
</script>

<Dialog.Root {open} onOpenChange={handleOpenChange}>
	<Dialog.Content aria-busy={pending} showCloseButton={false} class="sm:max-w-md">
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{title}</Dialog.Title>
				<Dialog.Description>{description}</Dialog.Description>
			</Dialog.Header>
			<label class="grid gap-1.5 text-sm font-medium">
				<span>{label}</span>
				<Input bind:value maxlength={maxLength} autocomplete="off" />
			</label>
			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
			<Dialog.Footer>
				<Button
					type="button"
					variant="outline"
					class="w-full sm:w-auto"
					disabled={pending}
					onclick={() => handleOpenChange(false)}
				>
					{m.common_cancel()}
				</Button>
				<Button
					type="submit"
					class="w-full sm:w-auto"
					disabled={pending || !value.trim() || value.trim() === initialValue.trim()}
				>
					{#if pending}<LoaderIcon class="size-4 animate-spin" />{/if}
					{m.common_save()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
