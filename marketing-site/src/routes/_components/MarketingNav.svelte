<script lang="ts">
	import { ArrowRight, Menu, Server, X } from 'lucide-svelte';
	import Logo from '$lib/components/Logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import { managedSignupUrl, navItems, selfHostingDocsUrl } from '../_marketing';

	let mobileOpen = $state(false);
</script>

<header class="sticky top-0 z-40 border-b border-border/70 bg-background/94 backdrop-blur-xl">
	<div class="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3 sm:px-6 lg:px-8">
		<a class="inline-flex items-center gap-2" href="/" aria-label="OpenPost home">
			<Logo width={34} height={26} />
			<span class="text-sm font-semibold tracking-tight">OpenPost</span>
		</a>

		<nav class="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
			{#each navItems as item (item.href)}
				<a
					href={item.href}
					class="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
				>
					{item.label}
				</a>
			{/each}
		</nav>

		<div class="hidden items-center gap-2 lg:flex">
			<Button href={selfHostingDocsUrl} variant="ghost" size="sm">
				<Server data-icon="inline-start" />
				Self-host
			</Button>
			<Button href={managedSignupUrl} size="sm">
				Try managed app
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>

		<Button
			variant="ghost"
			size="icon-sm"
			class="lg:hidden"
			aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'}
			aria-expanded={mobileOpen}
			aria-controls="mobile-navigation"
			onclick={() => (mobileOpen = !mobileOpen)}
		>
			{#if mobileOpen}<X />{:else}<Menu />{/if}
		</Button>
	</div>

	{#if mobileOpen}
		<nav
			id="mobile-navigation"
			class="border-t bg-background px-4 py-4 lg:hidden"
			aria-label="Mobile navigation"
		>
			<div class="grid gap-1">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						class="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground"
						onclick={() => (mobileOpen = false)}
					>
						{item.label}
					</a>
				{/each}
			</div>
			<div class="mt-4 grid grid-cols-2 gap-2">
				<Button href={selfHostingDocsUrl} variant="outline" size="sm">
					<Server data-icon="inline-start" />
					Self-host
				</Button>
				<Button href={managedSignupUrl} size="sm">
					Try managed app
					<ArrowRight data-icon="inline-end" />
				</Button>
			</div>
		</nav>
	{/if}
</header>
