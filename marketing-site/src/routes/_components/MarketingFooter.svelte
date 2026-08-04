<script lang="ts">
  import Github from "lucide-svelte/icons/github";
  import MessageCircle from "lucide-svelte/icons/message-circle";
  import Logo from "$lib/components/Logo.svelte";
  import {
    developerDocsUrl,
    githubUrl,
    platforms,
    resourceItems,
    selfHostingDocsUrl,
    userDocsUrl,
  } from "../_marketing";

  const discordCommunityUrl = "https://discord.gg/u2QwukmY4W";
  const groups = [
    {
      title: "Product",
      links: [
        { label: "Overview", href: "/#product" },
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

  const footerCells = Array.from({ length: 54 }, (_, index) => ({
    level: index % 9 === 0 ? 4 : index % 5 === 0 ? 3 : index % 3 === 0 ? 2 : 1,
    delay: (index % 11) * -0.17,
    duration: 2.7 + (index % 7) * 0.18,
  }));
</script>

<footer class="site-footer">
  <div class="footer-cells" aria-hidden="true">
    {#each footerCells as cell, index (index)}
      <i
        class={`level-${cell.level}`}
        style:--bounce-delay={`${cell.delay}s`}
        style:--bounce-duration={`${cell.duration}s`}
      ></i>
    {/each}
  </div>

  <div
    class="marketing-shell grid gap-12 py-16 lg:grid-cols-[1.05fr_1.95fr] lg:py-20"
  >
    <div>
      <a
        href="/"
        class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md"
        aria-label="OpenPost home"
      >
        <Logo width={36} height={28} />
        <span class="text-sm font-semibold">OpenPost</span>
      </a>
      <p class="mt-4 max-w-xs text-sm leading-6 text-white/58">
        Create, adapt, schedule, and track social posts from one workspace.
      </p>
      <div class="mt-5 flex flex-wrap gap-x-5">
        <a
          href={githubUrl}
          target="_blank"
          rel="noreferrer"
          class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-white/62 hover:text-white"
        >
          <Github class="size-4" />
          GitHub source
        </a>
        <a
          href={discordCommunityUrl}
          target="_blank"
          rel="noreferrer"
          class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-sm font-medium text-white/62 hover:text-white"
        >
          <MessageCircle class="size-4" />
          Discord
        </a>
      </div>
    </div>

    <div class="grid gap-8 sm:grid-cols-3">
      {#each groups as group (group.title)}
        <div>
          <h2 class="text-sm font-semibold text-white">{group.title}</h2>
          <ul class="mt-3 grid gap-1">
            {#each group.links as link (link.href)}
              <li>
                <a
                  href={link.href}
                  class="focus-ring inline-flex min-h-11 items-center rounded-md text-sm text-white/58 transition-colors hover:text-white"
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

  <div class="border-t border-white/10">
    <div
      class="marketing-shell flex flex-col gap-3 py-5 text-xs text-white/48 sm:flex-row sm:items-center sm:justify-between"
    >
      <span>Copyright 2026 OpenPost Contributors. AGPL-3.0-only.</span>
      <span class="flex gap-5">
        <a
          class="focus-ring inline-flex min-h-11 items-center rounded-md hover:text-white"
          href="/privacy">Privacy</a
        >
        <a
          class="focus-ring inline-flex min-h-11 items-center rounded-md hover:text-white"
          href="/terms">Terms</a
        >
      </span>
    </div>
  </div>
</footer>

<style>
  .site-footer {
    overflow: hidden;
    border-top: 1px solid color-mix(in oklch, var(--primary) 22%, transparent);
    background: oklch(0.13 0.012 50);
    color: white;
  }

  .footer-cells {
    display: grid;
    grid-template-columns: repeat(27, minmax(0, 1fr));
    gap: clamp(0.22rem, 0.7vw, 0.62rem);
    padding: 1.1rem max(1rem, calc((100vw - 78rem) / 2));
    border-bottom: 1px solid rgb(255 255 255 / 0.08);
  }

  .footer-cells i {
    aspect-ratio: 1;
    max-height: 1.7rem;
    border-radius: clamp(0.12rem, 0.25vw, 0.3rem);
    background: rgb(255 255 255 / 0.08);
    animation: footer-bounce var(--bounce-duration) ease-in-out
      var(--bounce-delay) infinite;
  }

  .footer-cells .level-2 {
    background: oklch(0.58 0.09 48 / 0.52);
  }
  .footer-cells .level-3 {
    background: oklch(0.65 0.14 45 / 0.75);
  }
  .footer-cells .level-4 {
    background: oklch(0.7 0.18 43);
  }

  @keyframes footer-bounce {
    0%,
    65%,
    100% {
      transform: translateY(0);
    }
    76% {
      transform: translateY(-0.6rem);
    }
    86% {
      transform: translateY(0.12rem);
    }
  }

  @media (max-width: 39.99rem) {
    .footer-cells {
      grid-template-columns: repeat(18, minmax(0, 1fr));
    }

    .footer-cells i:nth-child(n + 37) {
      display: none;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .footer-cells i {
      animation: none;
    }
  }
</style>
