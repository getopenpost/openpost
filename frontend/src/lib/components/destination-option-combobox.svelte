<script lang="ts">
	import { tick } from 'svelte';
	import ChevronsUpDownIcon from '@lucide/svelte/icons/chevrons-up-down';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import { Button } from '$lib/components/ui/button';
	import * as Command from '$lib/components/ui/command';
	import * as Popover from '$lib/components/ui/popover';
	import { cn } from '$lib/utils';

	interface Option {
		value: string;
		label: string;
	}

	let {
		id,
		value,
		label,
		placeholder,
		searchPlaceholder,
		emptyLabel,
		loadingLabel,
		options,
		loading = false,
		disabled = false,
		class: className,
		onValueChange,
		onSearch,
		hasMore = false,
		loadMoreLabel = '',
		onLoadMore,
		error = '',
		retryLabel = '',
		onRetry
	}: {
		id: string;
		value: string;
		label: string;
		placeholder: string;
		searchPlaceholder: string;
		emptyLabel: string;
		loadingLabel: string;
		options: Option[];
		loading?: boolean;
		disabled?: boolean;
		class?: string;
		onValueChange: (value: string) => void;
		onSearch?: (search: string) => void;
		hasMore?: boolean;
		loadMoreLabel?: string;
		onLoadMore?: () => void;
		error?: string;
		retryLabel?: string;
		onRetry?: () => void;
	} = $props();

	let open = $state(false);
	let search = $state('');
	let triggerRef = $state<HTMLButtonElement>(null!);
	let selectedLabel = $derived(options.find((option) => option.value === value)?.label);

	function setOpen(next: boolean): void {
		open = next;
		if (!next && search) {
			search = '';
			onSearch?.('');
		}
	}

	function updateSearch(next: string): void {
		search = next;
		onSearch?.(next);
	}

	function selectOption(next: string): void {
		onValueChange(next);
		setOpen(false);
		void tick().then(() => triggerRef.focus());
	}
</script>

<Popover.Root {open} onOpenChange={setOpen}>
	<Popover.Trigger bind:ref={triggerRef}>
		{#snippet child({ props })}
			<Button
				{...props}
				{id}
				variant="outline"
				role="combobox"
				aria-label={label}
				aria-expanded={open}
				aria-controls={`${id}-options`}
				{disabled}
				class={cn('h-11 w-full justify-between px-3 font-normal', className)}
			>
				<span class={cn('truncate', !selectedLabel && 'text-muted-foreground')}>
					{selectedLabel || placeholder}
				</span>
				<ChevronsUpDownIcon class="ml-2 size-4 shrink-0 opacity-50" />
			</Button>
		{/snippet}
	</Popover.Trigger>
	<Popover.Content
		align="start"
		class="w-(--bits-popover-anchor-width) min-w-56 p-0"
		aria-busy={loading}
	>
		<Command.Root>
			<Command.Input
				value={search}
				placeholder={searchPlaceholder}
				oninput={(event) => updateSearch(event.currentTarget.value)}
			/>
			<Command.List id={`${id}-options`}>
				{#if loading}
					<div
						class="flex min-h-16 items-center justify-center gap-2 px-3 text-xs text-muted-foreground"
					>
						<LoaderIcon class="size-3.5 animate-spin" />
						{loadingLabel}
					</div>
				{:else}
					<Command.Empty>{emptyLabel}</Command.Empty>
					<Command.Group>
						{#each options as option (option.value)}
							<Command.Item
								value={`${option.label} ${option.value}`}
								data-checked={option.value === value}
								onSelect={() => selectOption(option.value)}
							>
								<span class="truncate">{option.label}</span>
							</Command.Item>
						{/each}
					</Command.Group>
					{#if error}
						<div class="border-t p-2 text-xs text-destructive" role="alert">
							<p class="mb-2">{error}</p>
							{#if onRetry}
								<Button variant="outline" size="sm" class="w-full" onclick={onRetry}>
									{retryLabel}
								</Button>
							{/if}
						</div>
					{:else if hasMore && onLoadMore}
						<div class="border-t p-2">
							<Button variant="ghost" size="sm" class="w-full" onclick={onLoadMore}>
								{loadMoreLabel}
							</Button>
						</div>
					{/if}
				{/if}
			</Command.List>
		</Command.Root>
	</Popover.Content>
</Popover.Root>
