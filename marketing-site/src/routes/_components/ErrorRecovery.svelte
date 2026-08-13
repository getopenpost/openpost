<script lang="ts">
  import { resolve } from "$app/paths";
  import { ArrowLeft, ArrowRight, ExternalLink, LifeBuoy } from "@lucide/svelte";
  import { marketingErrorRecovery } from "../_error-recovery";

  interface Props {
    status?: number;
    label?: string;
    title?: string;
    description?: string;
  }

  let {
    status = marketingErrorRecovery.status,
    label = marketingErrorRecovery.label,
    title = marketingErrorRecovery.title,
    description = marketingErrorRecovery.description,
  }: Props = $props();

  function isExternal(href: string) {
    return href.startsWith("https://");
  }

  function linkAttributes(href: string) {
    return { href: href.startsWith("/") ? resolve(href as "/") : href };
  }
</script>

<section class="error-recovery" aria-labelledby="error-recovery-title">
  <div class="error-shell">
    <a class="focus-ring brand" href={resolve("/")} aria-label="OpenPost home">
      <img src="/logo.svg" alt="" width="36" height="28" />
      <span>OpenPost</span>
    </a>

    <div class="error-grid">
      <div class="error-copy">
        <p class="error-code">{status} · {label}</p>
        <h1 id="error-recovery-title">{title}</h1>
        <p>{description}</p>
        <a class="focus-ring primary-link" {...linkAttributes(marketingErrorRecovery.primary.href)}>
          <ArrowLeft aria-hidden="true" />
          {marketingErrorRecovery.primary.label}
        </a>
      </div>

      <div class="recovery-panel">
        <p class="panel-label">Continue from a maintained page</p>
        <nav aria-label="Page recovery">
          <ul>
            {#each marketingErrorRecovery.routes as route (route.href)}
              <li>
                <a
                  class="focus-ring route-link"
                  {...linkAttributes(route.href)}
                  target={isExternal(route.href) ? "_blank" : undefined}
                  rel={isExternal(route.href) ? "noreferrer" : undefined}
                >
                  <span>
                    <strong>{route.label}</strong>
                    <small>{route.description}</small>
                  </span>
                  {#if isExternal(route.href)}<ExternalLink aria-hidden="true" />{:else}<ArrowRight
                      aria-hidden="true"
                    />{/if}
                </a>
              </li>
            {/each}
          </ul>
        </nav>
        <div class="support-row">
          <LifeBuoy aria-hidden="true" />
          <span>Need help?</span>
          {#each marketingErrorRecovery.support as link (link.href)}
            <a class="focus-ring" {...linkAttributes(link.href)} target={isExternal(link.href) ? "_blank" : undefined} rel={isExternal(link.href) ? "noreferrer" : undefined}>
              {link.label}
            </a>
          {/each}
        </div>
      </div>
    </div>
  </div>
</section>

<style>
  .error-recovery {
    position: relative;
    display: grid;
    min-height: calc(100dvh - 4rem);
    align-items: center;
    overflow: hidden;
    padding-block: 3rem;
    background:
      radial-gradient(circle at 82% 22%, color-mix(in oklch, var(--primary) 14%, transparent), transparent 24rem),
      var(--background);
  }

  .error-recovery::after {
    position: absolute;
    right: -5rem;
    bottom: -7rem;
    width: 18rem;
    height: 18rem;
    border: 1px solid color-mix(in oklch, var(--primary) 32%, var(--border));
    border-radius: 4rem;
    transform: rotate(17deg);
    content: "";
  }

  .error-shell {
    position: relative;
    z-index: 1;
    width: min(100% - 2rem, 72rem);
    margin-inline: auto;
  }

  .brand {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.55rem;
    border-radius: 0.5rem;
    font-family: var(--font-brand, sans-serif);
    font-size: 0.9rem;
    font-weight: 650;
  }

  .brand img {
    width: 2.25rem;
    height: 1.75rem;
  }

  .error-grid {
    display: grid;
    gap: 3rem;
    margin-top: clamp(3rem, 7vw, 6rem);
  }

  .error-code,
  .panel-label {
    color: var(--primary);
    font-size: 0.72rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  .error-copy h1 {
    max-width: 11ch;
    margin-top: 1rem;
    font-size: clamp(2.8rem, 7vw, 5.8rem);
    font-weight: 660;
    line-height: 0.96;
    letter-spacing: -0.04em;
    text-wrap: balance;
  }

  .error-copy > p:nth-of-type(2) {
    max-width: 58ch;
    margin-top: 1.4rem;
    color: var(--muted-foreground);
    line-height: 1.7;
  }

  .primary-link {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.5rem;
    margin-top: 1.8rem;
    border-radius: 0.6rem;
    color: var(--primary);
    font-size: 0.86rem;
    font-weight: 650;
  }

  .primary-link :global(svg) {
    width: 1rem;
    height: 1rem;
  }

  .recovery-panel {
    padding: clamp(1.2rem, 3vw, 2rem);
    border: 1px solid var(--border);
    border-radius: 1rem;
    background: color-mix(in oklch, var(--card) 94%, var(--background));
  }

  .recovery-panel nav {
    margin-top: 0.8rem;
  }

  .recovery-panel li + li {
    border-top: 1px solid var(--border);
  }

  .route-link {
    display: grid;
    min-height: 5.25rem;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: center;
    gap: 1rem;
    border-radius: 0.5rem;
  }

  .route-link strong,
  .route-link small {
    display: block;
  }

  .route-link strong {
    font-size: 0.9rem;
  }

  .route-link small {
    margin-top: 0.25rem;
    color: var(--muted-foreground);
    font-size: 0.75rem;
    line-height: 1.45;
  }

  .route-link > :global(svg) {
    width: 1rem;
    height: 1rem;
    color: var(--muted-foreground);
  }

  .support-row {
    display: flex;
    flex-wrap: wrap;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.4rem 0.8rem;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
    color: var(--muted-foreground);
    font-size: 0.74rem;
  }

  .support-row > :global(svg) {
    width: 0.95rem;
    height: 0.95rem;
    color: var(--primary);
  }

  .support-row a {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    border-radius: 0.5rem;
    color: var(--foreground);
    font-weight: 600;
  }

  @media (min-width: 52rem) {
    .error-grid {
      grid-template-columns: minmax(0, 1fr) minmax(22rem, 0.78fr);
      align-items: end;
      gap: clamp(3rem, 8vw, 8rem);
    }
  }

  @media (max-width: 39.99rem) {
    .error-recovery {
      align-items: start;
      padding-top: 1.5rem;
    }

    .error-grid {
      margin-top: 2.5rem;
    }

    .support-row {
      display: grid;
      grid-template-columns: auto 1fr;
    }

    .support-row a {
      grid-column: 2;
    }
  }
</style>
