<script lang="ts">
	import { m } from '$lib/paraglide/messages';
	import { Button } from '$lib/components/ui/button';
	import type { Locale } from '$lib/paraglide/runtime';
	import type { ThemeScheme, ThemeSchemeManifest } from '$lib/themes';
	import {
		sameThemeReference,
		themeReferenceKey,
		type ThemeReference
	} from './theme-library-model';
	import { themeSchemeLabel } from './theme-editor-presenter';
	import type { ThemeLibraryItem } from './theme-library-types';

	interface Props {
		items: ThemeLibraryItem[];
		selectedReference: ThemeReference;
		previewReference: ThemeReference;
		organizationDefaultReference: ThemeReference;
		scheme: ThemeScheme;
		locale: Locale;
		busy?: boolean;
		onPreview: (reference: ThemeReference) => void;
		onApply: (reference: ThemeReference) => void;
		canApply: (reference: ThemeReference) => boolean;
	}

	let {
		items,
		selectedReference,
		previewReference,
		organizationDefaultReference,
		scheme,
		locale,
		busy = false,
		onPreview,
		onApply,
		canApply
	}: Props = $props();

	function thumbnail(item: ThemeLibraryItem): ThemeSchemeManifest | undefined {
		return (
			item.manifest.schemes[scheme] ?? item.manifest.schemes[item.manifest.supportedSchemes[0]]
		);
	}
</script>

<div class="space-y-4">
	<div>
		<h3 class="font-semibold">{m.theme_library_builtins({}, { locale })}</h3>
		<p class="mt-1 text-sm text-muted-foreground">
			{m.theme_library_builtins_description({}, { locale })}
		</p>
	</div>
	<div
		class="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
		role="group"
		aria-label={m.theme_library_builtins({}, { locale })}
	>
		{#each items as item (themeReferenceKey(item.reference))}
			{@const preview = thumbnail(item)}
			{@const applicable = canApply(item.reference)}
			{@const actionLabel = applicable
				? m.theme_library_apply({}, { locale })
				: sameThemeReference(item.reference, selectedReference)
					? m.theme_library_applied({}, { locale })
					: m.theme_library_apply({}, { locale })}
			<article
				data-theme-library-card={item.manifest.id}
				class="group overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card transition-[border-color,box-shadow,transform] hover:border-ring/60 has-[[aria-pressed=true]]:border-ring has-[[aria-pressed=true]]:ring-2 has-[[aria-pressed=true]]:ring-ring/20"
			>
				<button
					type="button"
					aria-label={`${m.theme_library_test({}, { locale })} ${item.manifest.name}`}
					aria-pressed={sameThemeReference(item.reference, previewReference)}
					disabled={busy}
					onclick={() => onPreview(item.reference)}
					class="block w-full text-left focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default"
				>
					<div class="h-20 p-3" style:background={preview?.colors.canvas ?? 'var(--background)'}>
						<div
							class="flex h-full overflow-hidden rounded-md border"
							style:background={preview?.colors.surface ?? 'var(--card)'}
							style:border-color={preview?.colors.border ?? 'var(--border)'}
						>
							<div
								class="w-1/4"
								style:background={preview?.colors.sidebar ?? 'var(--sidebar)'}
							></div>
							<div class="flex flex-1 flex-col justify-between p-2">
								<div
									class="h-1.5 w-3/5 rounded-full"
									style:background={preview?.colors.ink ?? 'var(--foreground)'}
								></div>
								<div
									class="h-4 w-1/2 rounded"
									style:background={preview?.colors.actionFocal ?? 'var(--primary)'}
								></div>
							</div>
						</div>
					</div>
					<div class="flex items-start justify-between gap-2 px-3 pt-2.5">
						<div class="min-w-0">
							<p class="truncate text-sm font-semibold">{item.manifest.name}</p>
							<p class="mt-0.5 text-xs text-muted-foreground">
								{item.manifest.supportedSchemes
									.map((value) => themeSchemeLabel(value, locale))
									.join(' + ')}
							</p>
						</div>
						{#if sameThemeReference(item.reference, selectedReference)}
							<span class="text-xs font-medium text-success-foreground"
								>{m.theme_library_applied({}, { locale })}</span
							>
						{:else if sameThemeReference(item.reference, organizationDefaultReference)}
							<span class="text-xs font-medium text-muted-foreground"
								>{m.theme_library_default({}, { locale })}</span
							>
						{/if}
					</div>
				</button>
				<div class="grid grid-cols-2 gap-2 p-3">
					<Button
						size="sm"
						intent="ordinary"
						onclick={() => onPreview(item.reference)}
						disabled={busy}
					>
						{m.theme_library_test({}, { locale })}
					</Button>
					<Button
						size="sm"
						intent="focal"
						aria-label={`${actionLabel} ${item.manifest.name}`}
						onclick={() => onApply(item.reference)}
						disabled={busy || !applicable}
					>
						{actionLabel}
					</Button>
				</div>
			</article>
		{/each}
	</div>
</div>
