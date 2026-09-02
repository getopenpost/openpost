<script lang="ts">
	import type { ComponentProps, Snippet } from 'svelte';
	import type { IconComponent } from '$lib/component-types';
	import PageHeader from '$lib/components/page-header.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';

	type PageLoadingProps = ComponentProps<typeof PageLoading>;

	interface Props {
		/** Page title displayed in the header */
		title: string;
		/** Optional icon component to display before title */
		icon?: IconComponent;
		/** Optional plain-text description below the title */
		description?: string;
		/** Optional header actions (buttons, etc.) */
		actions?: Snippet;
		/** Whether to show loading state */
		loading?: boolean;
		/** Optional loading message */
		loadingMessage?: string;
		/** Content-shaped loading placeholder */
		loadingLayout?: PageLoadingProps['layout'];
		/** Optional recipe used by loading layouts with multiple content shapes */
		loadingVariant?: PageLoadingProps['variant'];
		/** Number of repeated placeholder items */
		loadingItems?: number;
		/** Number of controls represented in the loading header */
		loadingActionCount?: number;
		/** Render only the content when the page is embedded in another shell */
		embedded?: boolean;
		/** Page content */
		children: Snippet;
	}

	let {
		title,
		icon: Icon,
		description,
		actions,
		loading = false,
		loadingMessage = 'Loading...',
		loadingLayout = 'list',
		loadingVariant = 'profile',
		loadingItems = 4,
		loadingActionCount = 2,
		embedded = false,
		children
	}: Props = $props();
</script>

{#if embedded}
	<div data-slot="page-content" data-theme-type="body" class="min-w-0" aria-busy={loading}>
		{#if loading}
			<PageLoading
				layout={loadingLayout}
				variant={loadingVariant}
				label={loadingMessage}
				items={loadingItems}
			/>
		{:else}
			{@render children()}
		{/if}
	</div>
{:else}
	<div data-slot="page-container" data-theme-content style="container-type: inline-size;">
		<PageHeader {title} icon={Icon} {description} {actions} {loading} {loadingActionCount} />

		<div data-slot="page-content" data-theme-type="body" class="min-w-0" aria-busy={loading}>
			{#if loading}
				<PageLoading
					layout={loadingLayout}
					variant={loadingVariant}
					label={loadingMessage}
					items={loadingItems}
				/>
			{:else}
				{@render children()}
			{/if}
		</div>
	</div>
{/if}
