<script lang="ts">
  import { resolve } from "$app/paths";
  import Github from "@lucide/svelte/icons/github";
  import MessageCircle from "@lucide/svelte/icons/message-circle";
  import Volume2 from "@lucide/svelte/icons/volume-2";
  import VolumeX from "@lucide/svelte/icons/volume-x";
  import Logo from "$lib/components/Logo.svelte";
  import PlatformIcon from "$lib/components/platform-icon.svelte";
  import { soundPreferences } from "$lib/stores/sound-preferences.svelte";
  import {
    developerDocsUrl,
    discordCommunityUrl,
    platforms,
    resourceItems,
    selfHostingDocsUrl,
    userDocsUrl,
  } from "../_marketing";

  const groups = [
    {
      title: "Product",
      links: [
        { label: "Overview", href: "/#product" },
        { label: "Features", href: "/features" },
        { label: "Platforms", href: "/platforms" },
        { label: "Pricing", href: "/pricing" },
        { label: "Free tools", href: "/tools" },
        { label: "Compare", href: "/compare" },
      ],
    },
    {
      title: "Resources",
      links: resourceItems
        .filter((item) => !["/platforms", "/compare"].includes(item.href))
        .map((item) => ({ label: item.label, href: item.href })),
    },
    {
      title: "Documentation",
      links: [
        { label: "User docs", href: userDocsUrl },
        { label: "Self-hosting", href: selfHostingDocsUrl },
        { label: "Developer docs", href: developerDocsUrl },
        ...platforms.slice(0, 3).map((platform) => ({
          label: `${platform.name} guide`,
          href: `/platforms/${platform.slug}`,
        })),
      ],
    },
  ];

  function externalHref(source: string) {
    return { href: new URL(source).href } as const;
  }
</script>

<footer class="bg-muted/30 border-t">
  <div
    class="marketing-shell grid gap-12 py-14 lg:grid-cols-[1.15fr_1.85fr] lg:py-16"
  >
    <div>
      <a
        href={resolve("/")}
        class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
        aria-label="OpenPost home"
      >
        <Logo width={36} height={28} decorative />
        <span
          class="font-brand text-sm leading-none font-semibold tracking-[-0.02em]"
          >OpenPost</span
        >
      </a>
      <p class="text-muted-foreground mt-4 max-w-xs text-sm leading-6">
        The content workspace for solo founders. Create once, adapt for every
        platform, stay visible everywhere.
      </p>
      <div class="mt-5 flex flex-wrap gap-x-5">
        <a
          href="https://github.com/rodrgds/openpost"
          target="_blank"
          rel="noreferrer"
          class="focus-ring text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium transition-colors"
        >
          <Github class="size-4" />
          GitHub source
        </a>
        <a
          {...externalHref(discordCommunityUrl)}
          target="_blank"
          rel="noreferrer"
          class="focus-ring text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium transition-colors"
        >
          <MessageCircle class="size-4" />
          Discord
        </a>
      </div>
      <div
        class="mt-6 flex flex-wrap items-center gap-1 text-muted-foreground"
        aria-label="Platform publishing guides"
      >
        {#each platforms as platform (platform.slug)}
          <a
            href={resolve(`/platforms/${platform.slug}`)}
            class="focus-ring inline-flex size-11 items-center justify-center rounded-md text-muted-foreground/75 transition-colors hover:text-primary"
            aria-label={`${platform.name} guide`}
          >
            <PlatformIcon platform={platform.short} class="size-4" />
          </a>
        {/each}
      </div>
    </div>

    <div class="grid gap-8 sm:grid-cols-3">
      {#each groups as group (group.title)}
        <div>
          <h2 class="text-sm font-semibold">{group.title}</h2>
          <ul class="mt-3 grid gap-1">
            {#each group.links as link (link.href)}
              <li>
                {#if link.href.startsWith("https://")}
                  <a
                    {...externalHref(link.href)}
                    class="focus-ring text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center rounded-md text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                {:else}
                  <a
                    href={resolve(link.href as "/")}
                    class="focus-ring text-muted-foreground hover:text-foreground inline-flex min-h-11 items-center rounded-md text-sm transition-colors"
                  >
                    {link.label}
                  </a>
                {/if}
              </li>
            {/each}
          </ul>
        </div>
      {/each}
    </div>
  </div>

  <div class="border-t">
    <div
      class="marketing-shell text-muted-foreground flex flex-col gap-3 py-5 text-xs sm:flex-row sm:items-center sm:justify-between"
    >
      <span>© 2026 OpenPost Contributors · AGPL-3.0-only</span>
      <span class="flex flex-wrap items-center gap-x-5 gap-y-1">
        <span class="hidden sm:inline">Made for companies of one</span>
        <button
          type="button"
          class="focus-ring hover:text-foreground inline-flex min-h-11 items-center gap-1.5 rounded-md transition-colors"
          aria-pressed={soundPreferences.enabled}
          aria-label={soundPreferences.enabled
            ? "Mute interface sounds"
            : "Enable interface sounds"}
          onclick={() => soundPreferences.setEnabled(!soundPreferences.enabled)}
        >
          {#if soundPreferences.enabled}<Volume2
              class="size-3.5"
            />{:else}<VolumeX class="size-3.5" />{/if}
          Sound
        </button>
        <a
          class="focus-ring hover:text-foreground inline-flex min-h-11 items-center rounded-md transition-colors"
          href={resolve("/privacy")}>Privacy</a
        >
        <a
          class="focus-ring hover:text-foreground inline-flex min-h-11 items-center rounded-md transition-colors"
          href={resolve("/terms")}>Terms</a
        >
        <a
          class="focus-ring hover:text-foreground inline-flex min-h-11 items-center rounded-md transition-colors"
          href={resolve("/refunds")}>Refunds</a
        >
        <a
          class="focus-ring hover:text-foreground inline-flex min-h-11 items-center rounded-md transition-colors"
          href={resolve("/trust")}>Trust</a
        >
      </span>
    </div>
  </div>
</footer>
