<script lang="ts">
	import { AlertTriangle, ArrowRight, CheckCircle2 } from 'lucide-svelte';
	import PlatformIcon from '$lib/components/platform-icon.svelte';
	import { launchProviderMatrix } from '../_marketing';
</script>

<section id="launch-readiness" class="section-pad scroll-mt-20">
	<div class="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
		<div class="grid gap-8 lg:grid-cols-[0.74fr_1.26fr] lg:items-end">
			<div>
				<p class="section-label">Provider readiness</p>
				<h2
					class="mt-4 text-3xl leading-tight font-semibold tracking-tight text-balance sm:text-5xl"
				>
					Build the demo from paths you have just tested.
				</h2>
			</div>
			<p class="max-w-2xl text-lg leading-8 text-muted-foreground lg:justify-self-end">
				Available means the connection and publishing path is implemented. It does not mean every
				provider app, account, quota, or media format has passed a production test.
			</p>
		</div>

		<div class="mt-10 overflow-x-auto rounded-xl border bg-card">
			<table
				class="w-full min-w-[72rem] border-collapse text-left"
				aria-label="Launch provider readiness"
			>
				<thead class="border-b bg-background/70 text-sm">
					<tr>
						<th class="px-5 py-4 font-semibold" scope="col">Provider</th>
						<th class="px-5 py-4 font-semibold" scope="col">Text</th>
						<th class="px-5 py-4 font-semibold" scope="col">Media</th>
						<th class="px-5 py-4 font-semibold" scope="col">Threads or replies</th>
						<th class="px-5 py-4 font-semibold" scope="col">Schedule</th>
						<th class="px-5 py-4 font-semibold" scope="col">Verify before a launch demo</th>
					</tr>
				</thead>
				<tbody class="divide-y">
					{#each launchProviderMatrix as provider (provider.slug)}
						<tr>
							<th class="px-5 py-5 align-top" scope="row">
								<a
									href={`/platforms/${provider.slug}`}
									class="group inline-flex items-center gap-3"
								>
									<PlatformIcon platform={provider.short} class="size-4" />
									<span>
										<span class="block font-semibold">{provider.name}</span>
										<span class="mt-1 block text-xs font-normal text-primary">{provider.state}</span
										>
									</span>
									<ArrowRight
										class="size-3.5 text-muted-foreground transition group-hover:translate-x-0.5"
									/>
								</a>
							</th>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
								>{provider.text}</td
							>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
								>{provider.media}</td
							>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
								>{provider.threads}</td
							>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground">
								<span class="inline-flex items-center gap-2">
									<CheckCircle2 class="size-3.5 text-primary" />
									{provider.schedule}
								</span>
							</td>
							<td class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
								>{provider.verify}</td
							>
						</tr>
					{/each}
				</tbody>
			</table>
		</div>

		<div class="mt-6 border-t pt-6">
			<p class="flex max-w-2xl items-start gap-3 text-sm leading-6 text-muted-foreground">
				<AlertTriangle class="mt-0.5 size-4 shrink-0 text-amber-500" />
				Only include the exact accounts and formats that passed a fresh end-to-end test in launch copy
				or video. A successful OAuth connection alone does not prove publishing readiness.
			</p>
		</div>
	</div>
</section>
