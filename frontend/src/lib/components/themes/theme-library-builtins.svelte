<script lang="ts">
	import { m } from '$lib/paraglide/messages';
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
	}

	let {
		items,
		selectedReference,
		previewReference,
		organizationDefaultReference,
		scheme,
		locale,
		busy = false,
		onPreview
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
			<button
				type="button"
				aria-pressed={sameThemeReference(item.reference, previewReference)}
				disabled={busy}
				onclick={() => onPreview(item.reference)}
				class="group min-h-32 overflow-hidden rounded-[var(--theme-radius-lg,var(--radius))] border border-border bg-card text-left transition-[border-color,box-shadow,transform] hover:border-ring/60 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:cursor-default aria-pressed:border-ring aria-pressed:ring-2 aria-pressed:ring-ring/20"
			>
				<div class="h-20 p-3" style:background={preview?.colors.canvas ?? 'var(--background)'}>
					<div
						class="flex h-full overflow-hidden rounded-md border"
						style:background={preview?.colors.surface ?? 'var(--card)'}
						style:border-color={preview?.colors.border ?? 'var(--border)'}
					>
						<div class="w-1/4" style:background={preview?.colors.sidebar ?? 'var(--sidebar)'}></div>
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
				<div class="flex items-start justify-between gap-2 px-3 py-2.5">
					<div class="min-w-0">
						<p class="truncate text-sm font-semibold">{item.manifest.name}</p>
						<p class="mt-0.5 text-xs text-muted-foreground">
							{item.manifest.supportedSchemes
								.map((value) => themeSchemeLabel(value, locale))
								.join(' + ')}
						</p>
					</div>
					{#if sameThemeReference(item.reference, selectedReference)}
						<span class="text-xs font-medium text-success"
							>{m.theme_library_applied({}, { locale })}</span
						>
					{:else if sameThemeReference(item.reference, organizationDefaultReference)}
						<span class="text-xs font-medium text-muted-foreground"
							>{m.theme_library_default({}, { locale })}</span
						>
					{/if}
				</div>
			</button>
		{/each}
	</div>
</div>
