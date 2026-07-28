<script lang="ts">
	import { page } from '$app/state';
	import { ArrowRight, ChevronDown, Menu, Moon, Server, Sun, X } from 'lucide-svelte';
	import { mode, toggleMode } from 'mode-watcher';
	import Logo from '$lib/components/Logo.svelte';
	import { Button } from '$lib/components/ui/button';
	import * as DropdownMenu from '$lib/components/ui/dropdown-menu';
	import {
		docsUrl,
		managedSignupUrl,
		navItems,
		resourceItems,
		selfHostingDocsUrl
	} from '../_marketing';

	let mobileOpen = $state(false);
	const currentPath = $derived(page.url.pathname);

	function isActive(href: string): boolean {
		if (href.startsWith('http')) return false;
		if (href === '/#product') return currentPath === '/';
		return currentPath === href || currentPath.startsWith(`${href}/`);
	}

	function resourcesActive(): boolean {
		return resourceItems.some((item) => isActive(item.href));
	}
</script>

<header class="sticky top-0 z-40 border-b bg-background/96">
	<div class="marketing-shell flex min-h-16 items-center justify-between gap-4">
		<a
			class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
			href="/"
			aria-label="OpenPost home"
		>
			<Logo width={36} height={28} />
			<span class="text-sm font-semibold tracking-tight">OpenPost</span>
		</a>

		<nav class="hidden items-center gap-1 lg:flex" aria-label="Primary navigation">
			{#each navItems as item (item.href)}
				<a
					href={item.href}
					aria-current={isActive(item.href) ? 'page' : undefined}
					class={[
						'focus-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium transition-colors',
						isActive(item.href)
							? 'bg-muted text-foreground'
							: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
					]}
				>
					{item.label}
				</a>
			{/each}

			<DropdownMenu.Root>
				<DropdownMenu.Trigger>
					{#snippet child({ props })}
						<button
							{...props}
							type="button"
							aria-current={resourcesActive() ? 'page' : undefined}
							class={[
								'focus-ring inline-flex min-h-11 items-center gap-1 rounded-md px-3 text-sm font-medium transition-colors',
								resourcesActive()
									? 'bg-muted text-foreground'
									: 'text-muted-foreground hover:bg-muted/70 hover:text-foreground'
							]}
						>
							Resources
							<ChevronDown class="size-3.5" aria-hidden="true" />
						</button>
					{/snippet}
				</DropdownMenu.Trigger>
				<DropdownMenu.Content class="w-52" align="start">
					{#each resourceItems as item (item.href)}
						<DropdownMenu.Item>
							{#snippet child({ props })}
								<a
									{...props}
									href={item.href}
									class={[props.class, 'flex min-h-11 w-full items-center px-2']}
								>
									{item.label}
								</a>
							{/snippet}
						</DropdownMenu.Item>
					{/each}
				</DropdownMenu.Content>
			</DropdownMenu.Root>

			<a
				href={docsUrl}
				class="focus-ring inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted/70 hover:text-foreground"
			>
				Docs
			</a>
		</nav>

		<div class="hidden items-center gap-1.5 lg:flex">
			<Button
				type="button"
				variant="ghost"
				size="icon"
				class="size-11"
				aria-label={mode.current === 'dark' ? 'Use light theme' : 'Use dark theme'}
				onclick={toggleMode}
			>
				{#if mode.current === 'dark'}<Sun />{:else}<Moon />{/if}
			</Button>
			<Button href={selfHostingDocsUrl} variant="ghost" size="sm">
				<Server data-icon="inline-start" />
				Self-host
			</Button>
			<Button href={managedSignupUrl} size="sm">
				Try OpenPost
				<ArrowRight data-icon="inline-end" />
			</Button>
		</div>

		<Button
			variant="ghost"
			size="icon"
			class="size-11 lg:hidden"
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
			class="border-t bg-background lg:hidden"
			aria-label="Mobile navigation"
		>
			<div class="marketing-shell grid gap-1 py-4">
				{#each navItems as item (item.href)}
					<a
						href={item.href}
						aria-current={isActive(item.href) ? 'page' : undefined}
						class={[
							'focus-ring flex min-h-11 items-center rounded-md px-3 text-sm font-medium',
							isActive(item.href) ? 'bg-muted text-foreground' : 'text-muted-foreground'
						]}
						onclick={() => (mobileOpen = false)}
					>
						{item.label}
					</a>
				{/each}
				<p class="mt-3 px-3 text-xs font-semibold text-muted-foreground">Resources</p>
				{#each resourceItems as item (item.href)}
					<a
						href={item.href}
						class="focus-ring flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground"
						onclick={() => (mobileOpen = false)}
					>
						{item.label}
					</a>
				{/each}
				<a
					href={docsUrl}
					class="focus-ring flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground"
				>
					Docs
				</a>
				<div class="mt-4 grid grid-cols-[auto_1fr_1fr] gap-2 border-t pt-4">
					<Button
						type="button"
						variant="outline"
						size="icon"
						class="size-11"
						aria-label={mode.current === 'dark' ? 'Use light theme' : 'Use dark theme'}
						onclick={toggleMode}
					>
						{#if mode.current === 'dark'}<Sun />{:else}<Moon />{/if}
					</Button>
					<Button href={selfHostingDocsUrl} variant="outline" size="sm">Self-host</Button>
					<Button href={managedSignupUrl} size="sm">Try OpenPost</Button>
				</div>
			</div>
		</nav>
	{/if}
</header>
