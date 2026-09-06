<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Input } from '$lib/components/ui/input';
	import * as Select from '$lib/components/ui/select';
	import { m } from '$lib/paraglide/messages';
	import { themeCodePointLength } from './theme-editor-model';
	import { themeReferenceKey, type ThemeReference } from './theme-library-model';
	import type { ThemeLibraryItem } from './theme-library-types';

	interface Props {
		open: boolean;
		name: string;
		source: ThemeReference;
		sourceItem: ThemeLibraryItem;
		items: ThemeLibraryItem[];
		busy?: boolean;
		error?: string;
		valid?: boolean;
		onSubmit: () => void;
	}

	let {
		open = $bindable(),
		name = $bindable(),
		source = $bindable(),
		sourceItem,
		items,
		busy = false,
		error = '',
		valid = false,
		onSubmit
	}: Props = $props();
</script>

<Dialog.Root bind:open>
	<Dialog.Content aria-busy={busy} showCloseButton={false} class="sm:max-w-md">
		<form
			class="space-y-4"
			onsubmit={(event) => {
				event.preventDefault();
				onSubmit();
			}}
		>
			<Dialog.Header>
				<Dialog.Title>{m.theme_library_create_title()}</Dialog.Title>
				<Dialog.Description>{m.theme_library_create_description()}</Dialog.Description>
			</Dialog.Header>
			<label class="grid gap-1.5 text-sm font-medium" for="theme-create-name">
				{m.theme_library_theme_name()}
				<Input
					id="theme-create-name"
					bind:value={name}
					autocomplete="off"
					disabled={busy}
					autofocus
				/>
				<span class="text-xs font-normal text-muted-foreground tabular-nums">
					{themeCodePointLength(name.trim())}/80
				</span>
			</label>
			<label class="grid gap-1.5 text-sm font-medium" for="theme-create-source">
				{m.theme_library_starting_point()}
				<Select.Root
					value={themeReferenceKey(source)}
					onValueChange={(value) => {
						const item = items.find(
							(candidate) => themeReferenceKey(candidate.reference) === value
						);
						if (item) source = item.reference;
					}}
				>
					<Select.Trigger
						id="theme-create-source"
						class="w-full"
						aria-label={m.theme_library_starting_point()}
					>
						{sourceItem.manifest.name}
					</Select.Trigger>
					<Select.Content>
						{#each items as item (themeReferenceKey(item.reference))}
							<Select.Item value={themeReferenceKey(item.reference)}>
								{item.manifest.name}{item.state === 'draft' ? ` ${m.theme_library_draft()}` : ''}
							</Select.Item>
						{/each}
					</Select.Content>
				</Select.Root>
			</label>
			{#if error}<p class="text-sm text-destructive" role="alert">{error}</p>{/if}
			<Dialog.Footer>
				<Button type="button" intent="quiet" disabled={busy} onclick={() => (open = false)}
					>{m.common_cancel()}</Button
				>
				<Button type="submit" intent="focal" disabled={busy || !valid}>
					{busy ? m.theme_library_creating() : m.theme_library_create_draft()}
				</Button>
			</Dialog.Footer>
		</form>
	</Dialog.Content>
</Dialog.Root>
