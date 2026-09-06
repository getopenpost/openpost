<script lang="ts">
	import { scale } from 'svelte/transition';
	import { Button } from '$lib/components/ui/button';
	import { Input } from '$lib/components/ui/input';
	import { m } from '$lib/paraglide/messages';
	import { ThemeIcon } from '$lib/themes/icons';

	interface Props {
		id: string;
		value?: string;
		placeholder?: string;
		onChange: (value: string) => void;
	}

	let { id, value = '', placeholder = m.compose_tags_placeholder(), onChange }: Props = $props();
	let draft = $state('');
	let isComposing = $state(false);
	let armedTag = $state('');
	let status = $state('');
	let inputRef = $state<HTMLInputElement | null>(null);
	const tags = $derived(
		value
			.split(/,|\n/)
			.map((tag) => tag.trim())
			.filter(Boolean)
	);
	const motionDuration = (duration: number) =>
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
			? 0
			: duration;

	function announce(message: string) {
		status = '';
		requestAnimationFrame(() => (status = message));
	}

	function commitDraft(restoreFocus = false) {
		const additions = draft
			.split(/,|\n/)
			.map((tag) => tag.trim())
			.filter(Boolean);
		if (additions.length === 0) {
			draft = '';
			armedTag = '';
			return;
		}
		const seen = tags.map((tag) => tag.toLocaleLowerCase());
		const next = [...tags];
		let added = '';
		let duplicate = '';
		for (const tag of additions) {
			const normalized = tag.toLocaleLowerCase();
			if (seen.includes(normalized)) {
				duplicate = duplicate || tag;
				continue;
			}
			seen.push(normalized);
			next.push(tag);
			added = added || tag;
		}
		if (next.length !== tags.length) {
			onChange(next.join(', '));
			announce(m.interaction_tag_added({ tag: added }));
		} else if (duplicate) {
			announce(m.interaction_tag_duplicate({ tag: duplicate }));
		}
		draft = '';
		armedTag = '';
		if (restoreFocus) inputRef?.focus();
	}

	function removeTag(index: number) {
		const tag = tags[index];
		if (!tag) return;
		onChange(tags.filter((_, tagIndex) => tagIndex !== index).join(', '));
		armedTag = '';
		announce(m.interaction_tag_removed({ tag }));
		requestAnimationFrame(() => inputRef?.focus());
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.isComposing || isComposing || event.repeat) return;
		if (event.key === 'Enter' || event.key === ',') {
			event.preventDefault();
			commitDraft(true);
			return;
		}
		if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
			const lastTag = tags.at(-1);
			if (!lastTag) return;
			if (armedTag === lastTag) {
				removeTag(tags.length - 1);
			} else {
				armedTag = lastTag;
				announce(m.interaction_tag_armed({ tag: lastTag }));
			}
			return;
		}
		armedTag = '';
	}
</script>

<div
	class="mt-1 flex min-h-11 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-background px-2 py-1.5 transition-[border-color,box-shadow] duration-100 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20"
>
	{#each tags as tag, index (tag)}
		<span
			class="tag-chip inline-flex min-h-7 max-w-full items-center gap-1 rounded-lg border border-primary/25 bg-primary/8 px-2 text-xs font-medium break-words"
			class:tag-chip-armed={armedTag === tag}
			in:scale={{ duration: motionDuration(150), start: 0.86 }}
			out:scale={{ duration: motionDuration(120), start: 1 }}
		>
			<span class="min-w-0 break-words">{tag}</span>
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="-mr-1 size-6 min-h-11 min-w-11 rounded-sm text-muted-foreground hover:text-foreground sm:min-h-7 sm:min-w-7"
				aria-label={m.compose_remove_tag({ tag })}
				onclick={() => removeTag(index)}
			>
				<ThemeIcon role="remove" class="size-3" />
			</Button>
		</span>
	{/each}
	<Input
		bind:ref={inputRef}
		{id}
		class="h-11 min-w-28 flex-1 border-0 bg-transparent px-1 shadow-none focus-visible:ring-0 sm:h-7"
		bind:value={draft}
		{placeholder}
		oncompositionstart={() => (isComposing = true)}
		oncompositionend={() => (isComposing = false)}
		oninput={() => (armedTag = '')}
		onkeydown={handleKeydown}
		onblur={() => {
			if (!isComposing) commitDraft();
		}}
	/>
	<div class="sr-only" role="status" aria-live="polite" aria-atomic="true">
		{status}
	</div>
</div>

<style>
	.tag-chip-armed {
		border-color: color-mix(in oklch, var(--destructive) 55%, var(--border));
		background-color: color-mix(in oklch, var(--destructive) 8%, var(--background));
		animation: tag-chip-arm 180ms ease-out;
	}

	@keyframes tag-chip-arm {
		0% {
			transform: scale(1);
		}
		55% {
			transform: scale(1.035);
		}
		100% {
			transform: scale(1);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.tag-chip-armed {
			animation: none;
		}
	}
</style>
