<script lang="ts">
	import { ChevronDown } from 'lucide-svelte';
	import type { faqs as defaultFaqs } from '../_marketing';

	type Faq = (typeof defaultFaqs)[number];

	interface Props {
		items: readonly Faq[];
	}

	let { items }: Props = $props();
	let openIndex = $state(0);
</script>

<section id="faq" class="section-pad">
	<div class="mx-auto grid max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[0.75fr_1.25fr] lg:px-8">
		<div>
			<p class="section-label">Questions</p>
			<h2 class="mt-4 max-w-2xl text-3xl leading-tight font-semibold text-balance sm:text-5xl">
				What to know before you start.
			</h2>
			<p class="mt-5 max-w-xl text-lg leading-8 text-muted-foreground">
				Straight answers about agent access, managed pricing, self-hosting, provider support, and failures.
			</p>
		</div>

		<div class="overflow-hidden rounded-xl border bg-card">
			{#each items as item, index (item.question)}
				<div class="border-b last:border-b-0">
					<button
						type="button"
						class="flex w-full items-center justify-between gap-4 px-5 py-4 text-left font-semibold"
						aria-expanded={openIndex === index}
						onclick={() => (openIndex = openIndex === index ? -1 : index)}
					>
						<span>{item.question}</span>
						<ChevronDown
							class="size-4 shrink-0 text-muted-foreground transition-transform duration-200 {openIndex ===
							index
								? 'rotate-180'
								: ''}"
						/>
					</button>
					<div class="faq-content {openIndex === index ? 'is-open' : ''}">
						<div>
							<p class="max-w-3xl px-5 pb-5 text-sm leading-7 text-muted-foreground">
								{item.answer}
							</p>
						</div>
					</div>
				</div>
			{/each}
		</div>
	</div>
</section>

<style>
	.faq-content {
		display: grid;
		grid-template-rows: 0fr;
		opacity: 0;
		transition:
			grid-template-rows 220ms ease,
			opacity 180ms ease;
	}

	.faq-content > div {
		overflow: hidden;
	}

	.faq-content.is-open {
		grid-template-rows: 1fr;
		opacity: 1;
	}

	@media (prefers-reduced-motion: reduce) {
		.faq-content {
			transition: none;
		}
	}
</style>
