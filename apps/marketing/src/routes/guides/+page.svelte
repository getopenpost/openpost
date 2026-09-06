<script lang="ts">
	import { resolve } from '$app/paths';
	import { marketingGuides } from '@openpost/social-images';
</script>

<section class="section-pad">
	<div class="marketing-shell">
		<p class="section-label">Buying guides</p>
		<h1 class="marketing-title mt-5 max-w-4xl">Choose a social media workflow that fits.</h1>
		<p class="marketing-copy mt-6 max-w-2xl">
			Start with the question you need answered. These guides explain what to compare, where
			OpenPost fits, and what to test before committing.
		</p>
		<p class="mt-5 text-sm text-muted-foreground">
			Written by OpenPost. Sources and product limits included.
		</p>
		<div class="mt-12 max-w-4xl border-t">
			{#each marketingGuides as guide (guide.slug)}
				<a
					href={resolve('/guides/[slug]', { slug: guide.slug })}
					class="focus-ring block rounded-md border-b py-7 hover:text-primary"
				>
					<h2 class="text-xl font-semibold tracking-tight sm:text-2xl">
						{guide.question}
					</h2>
					<p class="mt-3 max-w-3xl text-base leading-7 text-muted-foreground">
						{guide.answer}
					</p>
					<span class="mt-4 inline-block text-sm font-medium text-primary">Read guide →</span>
				</a>
			{/each}
		</div>
	</div>
</section>
