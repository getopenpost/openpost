<script lang="ts">
	import Github from 'lucide-svelte/icons/github';
	import Logo from '$lib/components/Logo.svelte';
	import {
		developerDocsUrl,
		githubUrl,
		platforms,
		resourceItems,
		selfHostingDocsUrl,
		userDocsUrl
	} from '../_marketing';

	const groups = [
		{
			title: 'Explore',
			links: [
				{ label: 'Product', href: '/#product' },
				{ label: 'Pricing', href: '/pricing' },
				{ label: 'Free tools', href: '/tools' },
				{ label: 'Platforms', href: '/platforms' },
				{ label: 'Compare', href: '/compare' }
			]
		},
		{
			title: 'Learn',
			links: [
				{ label: 'User docs', href: userDocsUrl },
				{ label: 'Self-hosting', href: selfHostingDocsUrl },
				{ label: 'Developer docs', href: developerDocsUrl },
				...resourceItems
					.filter((item) => !['/platforms', '/compare'].includes(item.href))
					.map((item) => ({ label: item.label, href: item.href }))
			]
		},
		{
			title: 'Platform guides',
			links: platforms.slice(0, 5).map((platform) => ({
				label: platform.name,
				href: `/platforms/${platform.slug}`
			}))
		}
	];
</script>

<footer class="border-t bg-muted/25">
	<div class="marketing-shell grid gap-12 py-14 lg:grid-cols-[1.05fr_1.95fr]">
		<div>
			<a
				href="/"
				class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
				aria-label="OpenPost home"
			>
				<Logo width={36} height={28} />
				<span class="text-sm font-semibold">OpenPost</span>
			</a>
			<p class="mt-4 max-w-sm text-sm leading-6 text-muted-foreground">
				Create one publication, tailor every destination, and see what will publish before it leaves
				the queue.
			</p>
			<a
				href={githubUrl}
				target="_blank"
				rel="noreferrer"
				class="focus-ring mt-5 inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground"
			>
				<Github class="size-4" />
				GitHub source
			</a>
		</div>

		<div class="grid gap-8 sm:grid-cols-3">
			{#each groups as group (group.title)}
				<div>
					<h2 class="text-sm font-semibold">{group.title}</h2>
					<ul class="mt-3 grid gap-1">
						{#each group.links as link (link.href)}
							<li>
								<a
									href={link.href}
									class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-muted-foreground transition-colors hover:text-foreground"
								>
									{link.label}
								</a>
							</li>
						{/each}
					</ul>
				</div>
			{/each}
		</div>
	</div>
	<div class="border-t">
		<div
			class="marketing-shell flex flex-col gap-3 py-5 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between"
		>
			<span>Copyright 2026 OpenPost Contributors. AGPL-3.0-only.</span>
			<span class="flex gap-5">
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md hover:text-foreground"
					href="/privacy">Privacy</a
				>
				<a
					class="focus-ring inline-flex min-h-11 items-center rounded-md hover:text-foreground"
					href="/terms">Terms</a
				>
			</span>
		</div>
	</div>
</footer>
