<script lang="ts">
	import { Button } from '$lib/components/ui/button';
	import { managedSignupUrl, selfHostingDocsUrl } from '../_marketing';

	interface Props {
		eyebrow: string;
		title: string;
		description: string;
		primaryHref?: string;
		primaryLabel?: string;
		secondaryHref?: string;
		secondaryLabel?: string;
	}

	let {
		eyebrow,
		title,
		description,
		primaryHref = managedSignupUrl,
		primaryLabel = 'Try the managed app',
		secondaryHref = selfHostingDocsUrl,
		secondaryLabel = 'Self-host OpenPost'
	}: Props = $props();
</script>

<section class="border-b py-14 sm:py-16 lg:py-20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="max-w-4xl">
			<p class="section-label">{eyebrow}</p>
			<h1 class="mt-5 max-w-4xl text-4xl leading-[1.04] font-semibold tracking-tight text-balance sm:text-6xl">
				{title}
			</h1>
			<p class="mt-6 max-w-3xl text-lg leading-8 text-pretty text-muted-foreground sm:text-xl">{description}</p>
			<div class="mt-8 flex flex-wrap gap-3">
				<Button href={primaryHref} size="lg">{primaryLabel}</Button>
				<Button href={secondaryHref} variant="outline" size="lg">{secondaryLabel}</Button>
			</div>
		</div>
	</div>
</section>
