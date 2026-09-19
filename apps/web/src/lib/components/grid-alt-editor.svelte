<script lang="ts">
	import { Textarea } from '$lib/components/ui/textarea';
	import { m } from '$lib/paraglide/messages';

	interface Props {
		open: boolean;
		mediaId: string;
		altTexts: Map<string, string>;
		captioningIds: Set<string>;
		onAltText: (mediaId: string, alt: string) => void;
		onDone: () => void;
	}

	let { open, mediaId, altTexts, captioningIds, onAltText, onDone }: Props = $props();
</script>

{#if open}
	<div class="absolute inset-x-0 bottom-0 bg-black/70 p-2 backdrop-blur-sm">
		<Textarea
			value={altTexts.get(mediaId) || ''}
			unstyled
			oninput={(e) => onAltText(mediaId, (e.target as HTMLTextAreaElement).value)}
			placeholder={m.compose_alt_text_placeholder()}
			rows={2}
			class="w-full resize-none rounded bg-white/10 px-2 py-2 text-base text-white placeholder:text-white/60 focus:ring-2 focus:ring-white/70 focus:outline-none md:py-1 md:text-xs"
			aria-label={m.media_alt_text()}
		/>
		{#if captioningIds.has(mediaId)}
			<p class="mt-1 text-xs text-white/80" aria-live="polite">
				{m.compose_alt_text_generating()}
			</p>
		{/if}
		<div class="mt-1 flex justify-end gap-1">
			<button type="button" class="text-xs text-white/70 hover:text-white" onclick={onDone}
				>{m.common_done()}</button
			>
		</div>
	</div>
{/if}
