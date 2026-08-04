<script lang="ts">
  import { page } from "$app/state";
  import { ArrowRight, Menu, Moon, Sun, X } from "lucide-svelte";
  import { mode, toggleMode } from "mode-watcher";
  import Logo from "$lib/components/Logo.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as NavigationMenu from "$lib/components/ui/navigation-menu";
  import {
    appUrl,
    docsUrl,
    managedSignupUrl,
    navItems,
    resourceItems,
  } from "../_marketing";

  let mobileOpen = $state(false);
  const currentPath = $derived(page.url.pathname);
  const navigationResourceItems = [
    { label: "User docs", href: docsUrl },
    ...resourceItems.filter((item) => item.href !== "/platforms"),
    { label: "Discord community", href: "https://discord.gg/u2QwukmY4W" },
  ] as const;

  function isActive(href: string): boolean {
    if (href.startsWith("http")) return false;
    if (href === "/#product") return currentPath === "/";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  function resourcesActive(): boolean {
    return navigationResourceItems.some((item) => isActive(item.href));
  }
</script>

<header class="marketing-nav sticky top-0 z-40">
  <div class="marketing-shell flex min-h-16 items-center justify-between gap-4">
    <a
      class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
      href="/"
      aria-label="OpenPost home"
    >
      <Logo width={36} height={28} />
      <span class="text-sm font-semibold tracking-tight">OpenPost</span>
    </a>

    <NavigationMenu.Root
      viewport={false}
      class="absolute left-1/2 hidden -translate-x-1/2 lg:flex"
      aria-label="Primary navigation"
    >
      <NavigationMenu.List>
        {#each navItems as item (item.href)}
          <NavigationMenu.Item>
            <NavigationMenu.Link
              href={item.href}
              active={isActive(item.href)}
              aria-current={isActive(item.href) ? "page" : undefined}
              class="focus-ring min-h-11 rounded-md px-3 text-sm font-medium text-muted-foreground hover:bg-muted/70 hover:text-foreground data-[active=true]:text-foreground"
            >
              {item.label}
            </NavigationMenu.Link>
          </NavigationMenu.Item>
        {/each}

        <NavigationMenu.Item>
          <NavigationMenu.Trigger
            aria-current={resourcesActive() ? "page" : undefined}
            class="focus-ring h-11 min-h-11 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground data-open:bg-muted data-open:text-foreground"
          >
            Resources
          </NavigationMenu.Trigger>
          <NavigationMenu.Content class="w-56">
            <ul class="grid gap-1">
              {#each navigationResourceItems as item (item.href)}
                <li>
                  <NavigationMenu.Link
                    href={item.href}
                    active={isActive(item.href)}
                    aria-current={isActive(item.href) ? "page" : undefined}
                    class="focus-ring min-h-11 w-full rounded-md px-3 text-sm text-muted-foreground hover:text-foreground data-[active=true]:text-foreground"
                  >
                    {item.label}
                  </NavigationMenu.Link>
                </li>
              {/each}
            </ul>
          </NavigationMenu.Content>
        </NavigationMenu.Item>
      </NavigationMenu.List>
    </NavigationMenu.Root>

    <div class="hidden items-center gap-1.5 lg:flex">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        class="size-11"
        aria-label={mode.current === "dark"
          ? "Use light theme"
          : "Use dark theme"}
        onclick={toggleMode}
      >
        {#if mode.current === "dark"}<Sun />{:else}<Moon />{/if}
      </Button>
      <Button href={`${appUrl}/login`} variant="ghost" size="sm">Sign in</Button
      >
      <Button href={managedSignupUrl} size="sm">
        Start free trial
        <ArrowRight data-icon="inline-end" />
      </Button>
    </div>

    <Button
      variant="ghost"
      size="icon"
      class="size-11 lg:hidden"
      aria-label={mobileOpen ? "Close navigation" : "Open navigation"}
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
      class="max-h-[calc(100dvh-4rem)] overflow-y-auto border-t bg-background lg:hidden"
      aria-label="Mobile navigation"
    >
      <div class="marketing-shell grid gap-1 py-4">
        {#each navItems as item (item.href)}
          <a
            href={item.href}
            aria-current={isActive(item.href) ? "page" : undefined}
            class={[
              "focus-ring flex min-h-11 items-center rounded-md px-3 text-sm font-medium",
              isActive(item.href)
                ? "bg-muted text-foreground"
                : "text-muted-foreground",
            ]}
            onclick={() => (mobileOpen = false)}
          >
            {item.label}
          </a>
        {/each}
        <p class="mt-3 px-3 text-xs font-semibold text-muted-foreground">
          Resources
        </p>
        {#each navigationResourceItems as item (item.href)}
          <a
            href={item.href}
            class="focus-ring flex min-h-11 items-center rounded-md px-3 text-sm text-muted-foreground"
            onclick={() => (mobileOpen = false)}
          >
            {item.label}
          </a>
        {/each}
        <div class="mt-4 grid grid-cols-[auto_1fr] gap-2 border-t pt-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            class="size-11"
            aria-label={mode.current === "dark"
              ? "Use light theme"
              : "Use dark theme"}
            onclick={toggleMode}
          >
            {#if mode.current === "dark"}<Sun />{:else}<Moon />{/if}
          </Button>
          <Button href={managedSignupUrl} size="sm">Start free trial</Button>
        </div>
      </div>
    </nav>
  {/if}
</header>

<style>
  .marketing-nav {
    border-bottom: 1px solid color-mix(in oklch, var(--border) 70%, transparent);
    background: color-mix(in oklch, var(--background) 88%, transparent);
    backdrop-filter: blur(18px) saturate(140%);
  }
</style>
