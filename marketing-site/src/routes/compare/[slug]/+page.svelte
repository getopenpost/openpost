<script lang="ts">
  import { resolve } from "$app/paths";
  import { page } from "$app/state";
  import { error } from "@sveltejs/kit";
  import {
    ArrowLeft,
    ArrowRight,
    CheckCircle2,
    ExternalLink,
    Scale,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import ClaimEvidence from "../_components/ClaimEvidence.svelte";
  import {
    comparisons,
    getComparison,
    managedSignupUrl,
    selfHostingDocsUrl,
    siteUrl,
  } from "../../_marketing";

  const slug = $derived(page.params.slug ?? "");
  const comparison = $derived.by(() => {
    const found = getComparison(slug);
    if (!found) error(404, "Comparison not found");
    return found;
  });
  const otherComparisons = $derived(
    comparisons.filter((item) => item.slug !== comparison.slug).slice(0, 3),
  );

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

<svelte:head>
  <title>OpenPost vs {comparison.name}: an honest comparison</title>
  <meta
    name="description"
    content={`${comparison.verdict} Facts reviewed ${comparison.reviewedAt}.`}
  />
  <link rel="canonical" href={`${siteUrl}/compare/${comparison.slug}`} />
</svelte:head>

<section class="border-b py-16 sm:py-24">
  <div class="marketing-shell">
    <a
      href={resolve("/compare")}
      class="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft class="size-4" />
      All comparisons
    </a>
    <div class="mt-10 grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
      <div class="max-w-4xl">
        <p class="section-label">{comparison.category}</p>
        <h1 class="marketing-title mt-5">
          OpenPost vs {comparison.name}
        </h1>
        <p class="marketing-copy mt-6">{comparison.openPostAngle}</p>
        <div class="mt-8 flex flex-wrap gap-3">
          <Button href={managedSignupUrl} size="lg">Try the managed app</Button>
          <Button href={selfHostingDocsUrl} variant="outline" size="lg"
            >Self-host OpenPost</Button
          >
        </div>
      </div>
      <aside class="border-l pl-6">
        <Scale class="size-5 text-primary" />
        <p class="mt-4 text-sm font-semibold">Bottom line</p>
        <p class="mt-2 text-sm leading-6 text-muted-foreground">
          {comparison.verdict}
        </p>
        <p class="mt-5 border-t pt-4 font-mono text-xs text-muted-foreground">
          Reviewed {formatDate(comparison.reviewedAt)} · Recheck by {formatDate(comparison.reviewDueAt)}
        </p>
      </aside>
    </div>
  </div>
</section>

<section class="section-pad">
  <div class="marketing-shell grid gap-10 lg:grid-cols-2">
    <article class="border-t pt-6">
      <p class="section-label">Choose OpenPost when</p>
      <h2 class="mt-4 text-2xl font-semibold">
        You want clear access rules and post status.
      </h2>
      <ul class="mt-6 space-y-4">
        {#each comparison.chooseOpenPost as item (item)}
          <li class="flex gap-3 text-sm leading-6 text-muted-foreground">
            <CheckCircle2 class="mt-0.5 size-4 shrink-0 text-primary" />
            <span>{item}</span>
          </li>
        {/each}
      </ul>
    </article>
    <article class="border-t pt-6">
      <p class="section-label">Choose {comparison.name} when</p>
      <h2 class="mt-4 text-2xl font-semibold">{comparison.bestFor}</h2>
      <ul class="mt-6 space-y-4">
        {#each comparison.chooseThem as item (item)}
          <li class="flex gap-3 text-sm leading-6 text-muted-foreground">
            <ArrowRight class="mt-0.5 size-4 shrink-0" />
            <span>{item}</span>
          </li>
        {/each}
      </ul>
    </article>
  </div>
</section>

<section class="section-pad border-y bg-muted/20">
  <div class="marketing-shell">
    <div class="max-w-3xl">
      <p class="section-label">Side by side</p>
      <h2 class="marketing-heading mt-4">
        Compare the parts that matter to your choice.
      </h2>
    </div>
    <div class="mt-10 divide-y border-y lg:hidden">
      {#each comparison.rows as row (row.area)}
        <article class="py-6">
          <h3 class="font-semibold">{row.area}</h3>
          <div class="mt-5 grid gap-5 sm:grid-cols-2">
            <div>
              <p class="text-xs font-semibold text-primary">OpenPost</p>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                {row.openpost}
              </p>
              <ClaimEvidence evidence={row.evidence.openpost} area={row.area} />
            </div>
            <div>
              <p class="text-xs font-semibold text-primary">
                {comparison.name}
              </p>
              <p class="mt-2 text-sm leading-6 text-muted-foreground">
                {row.competitor}
              </p>
              <ClaimEvidence evidence={row.evidence.competitor} area={row.area} />
            </div>
          </div>
        </article>
      {/each}
    </div>
    <div
      class="mt-10 hidden overflow-hidden rounded-xl border bg-card lg:block"
    >
      <table class="w-full border-collapse text-left">
        <thead class="border-b bg-background/70 text-sm">
          <tr>
            <th class="px-5 py-4 font-semibold" scope="col">Area</th>
            <th class="px-5 py-4 font-semibold" scope="col">OpenPost</th>
            <th class="px-5 py-4 font-semibold" scope="col"
              >{comparison.name}</th
            >
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each comparison.rows as row (row.area)}
            <tr>
              <th class="px-5 py-5 align-top font-medium" scope="row"
                >{row.area}</th
              >
              <td
                class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
              >
                {row.openpost}
                <ClaimEvidence evidence={row.evidence.openpost} area={row.area} />
              </td
              >
              <td
                class="px-5 py-5 align-top text-sm leading-6 text-muted-foreground"
              >
                {row.competitor}
                <ClaimEvidence evidence={row.evidence.competitor} area={row.area} />
              </td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="section-pad">
  <div class="marketing-shell grid gap-10 lg:grid-cols-[0.75fr_1.25fr]">
    <div>
      <p class="section-label">Pricing model</p>
      <h2 class="mt-4 text-3xl font-semibold text-balance">
        See what changes the price.
      </h2>
    </div>
    <div>
      <p class="text-lg leading-8 text-muted-foreground">
        {comparison.pricing}
      </p>
      <div class="mt-8 flex flex-wrap gap-3">
        <Button href="/pricing">OpenPost plans</Button>
        {#each comparison.sources.slice(0, 1) as source (source.href)}
          <Button
            href={source.href}
            target="_blank"
            rel="noreferrer"
            variant="outline"
          >
            {comparison.name} source
            <ExternalLink data-icon="inline-end" />
          </Button>
        {/each}
      </div>
    </div>
  </div>
</section>

<section class="section-pad border-y bg-muted/20">
  <div class="marketing-shell grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
    <div>
      <p class="section-label">Sources</p>
      <h2 class="mt-4 text-3xl font-semibold text-balance">
        Check the current product pages.
      </h2>
      <p class="mt-4 text-sm leading-6 text-muted-foreground">
        No affiliate links. Competitor facts were reviewed on {formatDate(comparison.reviewedAt)}
        and must be checked again by {formatDate(comparison.reviewDueAt)}. {comparison.evidenceQualifier}
      </p>
    </div>
    <ul class="divide-y border-y">
      {#each comparison.sources as source (source.href)}
        <li>
          <a
            {...externalHref(source.href)}
            target="_blank"
            rel="noreferrer"
            class="group flex items-center justify-between gap-4 p-5 hover:bg-muted/25"
          >
            <span class="font-medium">{source.label}</span>
            <ExternalLink
              class="size-4 text-muted-foreground group-hover:text-foreground"
            />
          </a>
        </li>
      {/each}
    </ul>
  </div>
</section>

<section class="section-pad">
  <div class="marketing-shell">
    <div class="flex flex-col justify-between gap-6 sm:flex-row sm:items-end">
      <div>
        <p class="section-label">Keep comparing</p>
        <h2 class="mt-4 text-3xl font-semibold text-balance">
          Other tools worth checking
        </h2>
      </div>
      <a
        href={resolve("/compare")}
        class="inline-flex items-center gap-2 text-sm font-medium text-primary"
      >
        All comparisons <ArrowRight class="size-4" />
      </a>
    </div>
    <div
      class="mt-8 divide-y border-y md:grid md:grid-cols-3 md:divide-x md:divide-y-0"
    >
      {#each otherComparisons as item (item.slug)}
        <a
          href={resolve(`/compare/${item.slug}`)}
          class="p-5 transition hover:bg-muted/25"
        >
          <p class="text-xs text-primary">{item.category}</p>
          <h3 class="mt-2 font-semibold">OpenPost vs {item.name}</h3>
          <p class="mt-3 text-sm leading-6 text-muted-foreground">
            {item.bestFor}
          </p>
        </a>
      {/each}
    </div>
  </div>
</section>
