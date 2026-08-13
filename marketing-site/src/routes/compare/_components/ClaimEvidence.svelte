<script lang="ts">
  import ExternalLink from "@lucide/svelte/icons/external-link";
  import type { ClaimEvidence } from "../../_comparison-evidence";

  interface Props {
    evidence: ClaimEvidence;
    area: string;
  }

  let { evidence, area }: Props = $props();

  function formatDate(value: string) {
    return new Intl.DateTimeFormat("en", {
      day: "numeric",
      month: "short",
      year: "numeric",
      timeZone: "UTC",
    }).format(new Date(`${value}T00:00:00Z`));
  }

  function externalHref(href: string) {
    return { href: new URL(href).href } as const;
  }
</script>

<aside class="claim-evidence" aria-label={`${evidence.owner} evidence for ${area}`}>
  <div class="evidence-line">
    <span class:interpretation={evidence.basis === "Interpretation"} class="basis">{evidence.basis}</span>
    <span>Owner: {evidence.owner}</span>
  </div>
  <div class="source-line">
    {#each evidence.sources as source, index (source.href)}
      {#if index > 0}<span aria-hidden="true">·</span>{/if}
      <a {...externalHref(source.href)} target="_blank" rel="noreferrer">
        {source.label}<ExternalLink aria-hidden="true" />
      </a>
    {/each}
  </div>
  <p class="review-line">
    Reviewed <time datetime={evidence.reviewedOn}>{formatDate(evidence.reviewedOn)}</time>
    <span aria-hidden="true">·</span>
    Recheck by <time datetime={evidence.reviewDueOn}>{formatDate(evidence.reviewDueOn)}</time>
  </p>
  <p class="qualifier">{evidence.qualifier}</p>
</aside>

<style>
  .claim-evidence {
    display: grid;
    gap: 0.45rem;
    margin-top: 0.85rem;
    padding-top: 0.75rem;
    border-top: 1px solid color-mix(in oklch, var(--border) 78%, transparent);
    color: var(--muted-foreground);
    font-size: 0.66rem;
    line-height: 1.45;
  }

  .evidence-line,
  .source-line,
  .review-line {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.25rem 0.45rem;
  }

  .basis {
    padding: 0.14rem 0.35rem;
    border-radius: 0.35rem;
    background: color-mix(in oklch, var(--primary) 12%, transparent);
    color: var(--primary);
    font-weight: 700;
  }

  .basis.interpretation {
    background: color-mix(in oklch, var(--muted) 70%, transparent);
    color: var(--foreground);
  }

  .source-line a {
    display: inline-flex;
    min-height: 2.75rem;
    align-items: center;
    gap: 0.25rem;
    border-radius: 0.4rem;
    color: var(--foreground);
    font-weight: 620;
    text-decoration: underline;
    text-decoration-color: color-mix(in oklch, currentColor 35%, transparent);
    text-underline-offset: 0.18rem;
  }

  .source-line a :global(svg) {
    width: 0.7rem;
    height: 0.7rem;
  }

  .review-line {
    font-variant-numeric: tabular-nums;
  }

  .qualifier {
    max-width: 58ch;
  }
</style>
