<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { ArrowRight, Menu, Moon, Sun, X } from "@lucide/svelte";
  import { mode, toggleMode } from "mode-watcher";
  import Logo from "$lib/components/Logo.svelte";
  import PlatformIcon from "$lib/components/platform-icon.svelte";
  import { Button } from "$lib/components/ui/button";
  import * as NavigationMenu from "$lib/components/ui/navigation-menu";
  import {
    appUrl,
    discordCommunityUrl,
    docsUrl,
    managedSignupUrl,
    navItems,
    platforms,
    resourceItems,
  } from "../_marketing";

  let mobileOpen = $state(false);
  const currentPath = $derived(page.url.pathname);
  const navigationResourceItems = [
    { label: "User docs", href: docsUrl },
    ...resourceItems.filter((item) => item.href !== "/platforms"),
    { label: "Discord community", href: discordCommunityUrl },
  ] as const;

  function isActive(href: string): boolean {
    if (href.startsWith("http")) return false;
    if (href === "/#product") return currentPath === "/";
    return currentPath === href || currentPath.startsWith(`${href}/`);
  }

  function resourcesActive(): boolean {
    return navigationResourceItems.some((item) => isActive(item.href));
  }

  function navigationHref(href: string) {
    return { href: href.startsWith("/") ? resolve(href as "/") : href };
  }
</script>

<header class="marketing-nav sticky top-0 z-40">
  <div class="marketing-shell flex min-h-16 items-center justify-between gap-4">
    <a
      class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
      href={resolve("/")}
      aria-label="OpenPost home"
    >
      <Logo width={36} height={28} decorative />
      <span
        class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
        >OpenPost</span
      >
    </a>

    <NavigationMenu.Root
      viewport={false}
      class="absolute left-1/2 hidden -translate-x-1/2 lg:flex"
      aria-label="Primary navigation"
    >
      <NavigationMenu.List>
        {#each navItems as item (item.href)}
          {#if item.href === "/platforms"}
            <NavigationMenu.Item>
              <NavigationMenu.Trigger
                aria-current={isActive(item.href) ? "page" : undefined}
                class="focus-ring h-11 min-h-11 rounded-md px-3 text-sm text-muted-foreground hover:bg-muted/70 hover:text-foreground data-open:bg-muted data-open:text-foreground"
              >
                {item.label}
              </NavigationMenu.Trigger>
              <NavigationMenu.Content
                class="platform-menu left-1/2 -translate-x-1/2 p-0"
              >
                <div
                  class="flex items-center justify-between gap-5 border-b px-4 py-3.5"
                >
                  <div>
                    <p class="text-sm font-semibold text-foreground">
                      Publishing destinations
                    </p>
                    <p class="mt-0.5 text-xs text-muted-foreground">
                      Formats, setup needs, limits, and live-test notes.
                    </p>
                  </div>
                  <div class="flex shrink-0 items-center gap-4">
                    <NavigationMenu.Link
                      href="/platforms"
                      active={isActive("/platforms")}
                      class="focus-ring min-h-9 gap-1.5 rounded-md px-2.5 text-xs font-semibold text-foreground"
                    >
                      View all
                      <ArrowRight class="size-3.5" aria-hidden="true" />
                    </NavigationMenu.Link>
                  </div>
                </div>

                <ul class="grid gap-1 p-2 md:grid-cols-2">
                  {#each platforms as platform (platform.slug)}
                    <li>
                      <NavigationMenu.Link
                        href={`/platforms/${platform.slug}`}
                        active={isActive(`/platforms/${platform.slug}`)}
                        aria-current={isActive(`/platforms/${platform.slug}`)
                          ? "page"
                          : undefined}
                        class="group/platform-link focus-ring min-h-14 w-full gap-3 rounded-lg px-3 py-2.5"
                      >
                        <span
                          class="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-background text-foreground"
                        >
                          <PlatformIcon
                            platform={platform.slug}
                            class="size-[1.15rem]"
                          />
                        </span>
                        <span class="min-w-0 flex-1">
                          <span
                            class="block text-sm font-semibold text-foreground"
                            >{platform.name}</span
                          >
                          <span
                            class="mt-0.5 block truncate text-xs text-muted-foreground"
                            >{platform.tag}</span
                          >
                        </span>
                        <ArrowRight
                          class="size-3.5 -translate-x-1 text-muted-foreground opacity-0 transition group-hover/platform-link:translate-x-0 group-hover/platform-link:opacity-100 group-focus-visible/platform-link:translate-x-0 group-focus-visible/platform-link:opacity-100"
                          aria-hidden="true"
                        />
                      </NavigationMenu.Link>
                    </li>
                  {/each}
                </ul>
              </NavigationMenu.Content>
            </NavigationMenu.Item>
          {:else}
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
          {/if}
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
          {#if item.href !== "/platforms"}
            <a
              href={resolve(item.href as "/")}
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
          {/if}
        {/each}

        <div class="mt-3 flex min-h-11 items-center justify-between px-3">
          <p class="text-xs font-semibold text-muted-foreground">Platforms</p>
          <a
            href={resolve("/platforms")}
            class="focus-ring inline-flex min-h-9 items-center gap-1 rounded-md px-2 text-xs font-semibold"
            onclick={() => (mobileOpen = false)}
          >
            View all <ArrowRight class="size-3.5" aria-hidden="true" />
          </a>
        </div>
        <div class="grid grid-cols-2 gap-1">
          {#each platforms as platform (platform.slug)}
            <a
              href={resolve(`/platforms/${platform.slug}`)}
              aria-current={isActive(`/platforms/${platform.slug}`)
                ? "page"
                : undefined}
              class={[
                "focus-ring flex min-h-11 min-w-0 items-center gap-2 rounded-md px-3 text-sm",
                isActive(`/platforms/${platform.slug}`)
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground",
              ]}
              onclick={() => (mobileOpen = false)}
            >
              <PlatformIcon platform={platform.slug} class="size-4 shrink-0" />
              <span class="truncate">{platform.name}</span>
            </a>
          {/each}
        </div>

        <p class="mt-4 px-3 text-xs font-semibold text-muted-foreground">
          Resources
        </p>
        {#each navigationResourceItems as item (item.href)}
          <a
            {...navigationHref(item.href)}
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

  /* The shadcn Content ships md:w-auto; the destinations panel needs a real width. */
  :global(.platform-menu.platform-menu) {
    width: min(46rem, calc(100vw - 2rem));
  }
</style>
