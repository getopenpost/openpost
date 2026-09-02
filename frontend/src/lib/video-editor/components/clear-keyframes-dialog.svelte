<script lang="ts">
	import AppSelect from '$lib/components/app-select.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as Dialog from '$lib/components/ui/dialog';
	import { m } from '$lib/paraglide/messages';
	import type { KeyframeClearProperty } from '$lib/video-editor/timeline/actions/keyframes';
	import {
		clearKeyframesForItems,
		type ClearKeyframesResult
	} from '$lib/video-editor/timeline/actions/keyframes';
	import DiamondMinusIcon from '@lucide/svelte/icons/diamond-minus';

	export interface ClearKeyframeDialogOption {
		value: KeyframeClearProperty;
		label: string;
		keyframeCount: number;
	}

	let {
		open = $bindable(false),
		itemIds,
		options,
		lockedItemCount = 0,
		oncleared
	}: {
		open?: boolean;
		itemIds: string[];
		options: ClearKeyframeDialogOption[];
		lockedItemCount?: number;
		oncleared: (result: ClearKeyframesResult) => void;
	} = $props();

	const ALL = '__all__';
	let scope = $state<string>(ALL);
	let wasOpen = false;
	const totalKeyframes = $derived(
		options.reduce((total, option) => total + option.keyframeCount, 0)
	);
	const selectedKeyframes = $derived(
		scope === ALL
			? totalKeyframes
			: (options.find((option) => option.value === scope)?.keyframeCount ?? 0)
	);
	const scopeOptions = $derived([
		{ value: ALL, label: m.video_editor_clear_keyframes_scope_all() },
		...options.map((option) => ({ value: option.value, label: option.label }))
	]);

	$effect(() => {
		if (open && !wasOpen) scope = ALL;
		wasOpen = open;
	});

	function confirm(): void {
		const selectedOption =
			scope === ALL ? undefined : options.find((option) => option.value === scope);
		if (scope !== ALL && !selectedOption) return;
		const property = selectedOption?.value;
		const result = clearKeyframesForItems(itemIds, property);
		open = false;
		oncleared(result);
	}
</script>

<Dialog.Root bind:open>
	<Dialog.Content
		class="video-editor-theme w-[calc(100%_-_1rem)] max-w-[440px] border-border bg-popover text-popover-foreground sm:max-w-[440px]"
	>
		<Dialog.Header>
			<Dialog.Title class="flex items-center gap-2 text-base">
				<DiamondMinusIcon class="size-4 text-destructive" aria-hidden="true" />
				{m.video_editor_clear_keyframes_title()}
			</Dialog.Title>
			<Dialog.Description class="text-xs leading-relaxed text-[var(--video-editor-muted)]">
				{m.video_editor_clear_keyframes_description({ count: itemIds.length })}
			</Dialog.Description>
		</Dialog.Header>

		<div class="mt-4 space-y-3">
			<label class="block space-y-1.5 text-xs font-medium" for="clear-keyframes-scope">
				<span>{m.video_editor_clear_keyframes_scope()}</span>
				<AppSelect
					id="clear-keyframes-scope"
					class="h-[44px] w-full"
					value={scope}
					options={scopeOptions}
					ariaLabel={m.video_editor_clear_keyframes_scope()}
					onValueChange={(value) => (scope = value)}
				/>
			</label>
			<div class="rounded-md border border-border bg-muted px-3 py-2.5 text-xs">
				<p class="font-medium">
					{m.video_editor_clear_keyframes_affected({ count: selectedKeyframes })}
				</p>
				<p class="mt-1 text-[var(--video-editor-muted)]">
					{m.video_editor_clear_keyframes_undo_hint()}
				</p>
				{#if lockedItemCount > 0}
					<p class="mt-1 text-warning-foreground">
						{m.video_editor_clear_keyframes_locked({ count: lockedItemCount })}
					</p>
				{/if}
			</div>
		</div>

		<Dialog.Footer class="mt-5">
			<Button
				type="button"
				variant="ghost"
				class="h-[44px] min-h-[44px]"
				onclick={() => (open = false)}
			>
				{m.common_cancel()}
			</Button>
			<Button
				type="button"
				variant="default"
				class="h-[44px] min-h-[44px]"
				disabled={selectedKeyframes === 0}
				onclick={confirm}
			>
				{m.video_editor_clear_keyframes_confirm({ count: selectedKeyframes })}
			</Button>
		</Dialog.Footer>
	</Dialog.Content>
</Dialog.Root>
