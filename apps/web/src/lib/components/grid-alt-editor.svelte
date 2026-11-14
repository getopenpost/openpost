<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';
	import { ProtectedIcon } from '$lib/themes/icons';

	interface Props {
		open?: boolean;
		value: string;
		mediaId: string;
		captioning?: boolean;
		captionFailed?: boolean;
		canEdit?: boolean;
		saving?: boolean;
		savedValue?: string | null;
		variant?: 'inline' | 'panel';
		onChange: (value: string) => void;
		onCommit?: () => void;
		onRetryCaption?: () => void;
		onDone?: () => void;
	}

	let {
		open = true,
		value,
		mediaId,
		captioning = false,
		captionFailed = false,
		canEdit = true,
		saving = false,
		savedValue = null,
		variant = 'inline',
		onChange,
		onCommit,
		onRetryCaption,
		onDone
	}: Props = $props();

	const dirty = $derived(value.trim() !== (savedValue ?? ''));
	const fieldId = $derived(`alt-text-${mediaId}`);
</script>

{#if variant === 'inline' && open}
	<div class="absolute inset-x-0 bottom-0 bg-black/70 p-2 backdrop-blur-sm">
		<Textarea
			{value}
			unstyled
			oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
			placeholder={m.compose_alt_text_placeholder()}
			rows={2}
			class="w-full resize-none rounded bg-white/10 px-2 py-2 text-base text-white placeholder:text-white/60 focus:ring-2 focus:ring-white/70 focus:outline-none md:py-1 md:text-xs"
			aria-label={m.media_alt_text()}
		/>
		{#if captioning}
			<p class="mt-1 text-xs text-white/80" aria-live="polite">
				{m.compose_alt_text_generating()}
			</p>
		{:else if captionFailed && onRetryCaption}
			<div
				class="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-white/80"
				aria-live="polite"
			>
				<span>{m.compose_alt_text_generation_failed()}</span>
				<button
					type="button"
					class="min-h-11 px-1 underline underline-offset-2 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:min-h-7"
					onclick={onRetryCaption}>{m.common_retry()}</button
				>
			</div>
		{/if}
		{#if onDone}
			<div class="mt-1 flex justify-end gap-1">
				<button
					type="button"
					class="min-h-11 px-3 text-sm text-white/80 hover:text-white focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none md:min-h-7 md:text-xs [@media(pointer:coarse)]:min-h-11"
					onclick={onDone}>{m.common_done()}</button
				>
			</div>
		{/if}
	</div>
{:else if variant === 'panel'}
	<div class="space-y-2">
		<label for={fieldId} class="block text-sm font-medium">
			{m.media_alt_text()}
		</label>
		<Textarea
			id={fieldId}
			class="min-h-24 p-3 font-normal"
			{value}
			oninput={(e) => onChange((e.target as HTMLTextAreaElement).value)}
			placeholder={m.media_alt_placeholder()}
			disabled={!canEdit || saving}
		/>
		{#if captioning}
			<p class="text-xs text-muted-foreground" aria-live="polite">
				{m.compose_alt_text_generating()}
			</p>
		{:else if captionFailed && onRetryCaption}
			<div class="flex flex-wrap items-center gap-2 text-xs text-destructive" aria-live="polite">
				<span>{m.compose_alt_text_generation_failed()}</span>
				<Button size="sm" variant="link" onclick={onRetryCaption}>{m.common_retry()}</Button>
			</div>
		{/if}
		{#if onCommit && canEdit && dirty}
			<Button size="sm" variant="outline" onclick={onCommit} disabled={saving}>
				{#if saving}<ProtectedIcon
						icon="loading"
						class="animate-spin motion-reduce:animate-none"
					/>{/if}
				{m.media_save_alt()}
			</Button>
		{/if}
	</div>
{/if}
