<script lang="ts">
  import { Check } from "lucide-svelte";
  import { Button } from "$lib/components/ui/button";
  import { appUrl, managedAccessSummary, plans, siteUrl } from "../_marketing";

  const buyerStages = [
    {
      id: "solo",
      label: "Solo founder",
      description:
        "One person turning company work into content and publishing it consistently.",
      planIds: ["starter", "creator", "pro"],
    },
    {
      id: "team",
      label: "Team",
      description: "A small group sharing accounts and posting work.",
      planIds: ["team"],
    },
    {
      id: "agency",
      label: "Agency",
      description: "More workspaces and accounts for client publishing.",
      planIds: ["agency"],
    },
  ] as const;

  const sharedFeatures = [
    "Text-and-thread and focused media composers",
    "Account-specific versions and settings",
    "Calendar, scheduled posts, and clear status",
    "Reusable media library",
    "HTTP API, CLI, and MCP access",
    "Encrypted social account keys",
  ] as const;

  const comparisonRows = [
    {
      label: "Workspaces",
      value: (plan: (typeof plans)[number]) => plan.workspaces,
    },
    {
      label: "Social accounts",
      value: (plan: (typeof plans)[number]) => plan.accounts,
    },
    {
      label: "Scheduled posts / month",
      value: (plan: (typeof plans)[number]) => plan.posts,
    },
    {
      label: "Media storage",
      value: (plan: (typeof plans)[number]) => plan.storage,
    },
    {
      label: "Included seats",
      value: (plan: (typeof plans)[number]) => plan.seats,
    },
    {
      label: "Team roles",
      value: (plan: (typeof plans)[number]) =>
        plan.id === "team" || plan.id === "agency" ? "Included" : "—",
    },
  ] as const;

  let activeStage = $state<(typeof buyerStages)[number]["id"]>("solo");
  let billingPeriod = $state<"monthly" | "annual">("monthly");
  const selectedStage = $derived(
    buyerStages.find((stage) => stage.id === activeStage) ?? buyerStages[0],
  );
  const stagePlans = $derived(
    plans.filter((plan) => new Set<string>(selectedStage.planIds).has(plan.id)),
  );

  function displayPrice(plan: (typeof plans)[number]) {
    return billingPeriod === "annual" ? plan.annualPrice : plan.price;
  }
</script>

<svelte:head>
  <title>OpenPost pricing</title>
  <meta
    name="description"
    content="Build your solo-founder content system from $15 per month with a 14-day card-required free trial."
  />
  <link rel="canonical" href={`${siteUrl}/pricing`} />
</svelte:head>

<section class="border-b py-14 sm:py-20 lg:py-24">
  <div
    class="marketing-shell grid gap-8 lg:grid-cols-[0.95fr_1.05fr] lg:items-end"
  >
    <div>
      <p class="section-label">Pricing</p>
      <h1
        class="mt-4 max-w-4xl text-4xl leading-[1.02] font-semibold tracking-[-0.035em] text-balance sm:text-6xl"
      >
        Give your company a content team.
      </h1>
    </div>
    <div>
      <p class="marketing-copy">
        Every plan helps you create, adapt, schedule, and track content from one
        place. Higher plans add more workspaces, accounts, posts, storage, or
        seats as the company grows.
      </p>
      <p class="mt-4 text-xs leading-5 text-muted-foreground">
        {managedAccessSummary}
      </p>
    </div>
  </div>
</section>

<section id="plans" class="section-pad scroll-mt-20">
  <div class="marketing-shell">
    <div
      class="mb-8 flex flex-col justify-between gap-4 border-b pb-6 sm:flex-row sm:items-center"
    >
      <div>
        <p class="text-sm font-semibold">14 days free on every plan</p>
        <p class="mt-1 text-sm text-muted-foreground">
          Card required. Cancel before the first charge.
        </p>
      </div>
      <div
        class="inline-flex w-fit rounded-lg border bg-background p-1"
        aria-label="Billing period"
      >
        <Button
          variant={billingPeriod === "monthly" ? "default" : "ghost"}
          size="sm"
          onclick={() => (billingPeriod = "monthly")}>Monthly</Button
        >
        <Button
          variant={billingPeriod === "annual" ? "default" : "ghost"}
          size="sm"
          onclick={() => (billingPeriod = "annual")}
          >Annual <span class="ml-1 text-xs opacity-80">2 months free</span
          ></Button
        >
      </div>
    </div>
    <div class="grid gap-8 lg:grid-cols-[18rem_minmax(0,1fr)]">
      <div>
        <h2 id="buyer-stage-title" class="text-xl font-semibold">
          Who is publishing?
        </h2>
        <div
          class="mt-5 grid gap-2"
          role="group"
          aria-labelledby="buyer-stage-title"
        >
          {#each buyerStages as stage (stage.id)}
            <button
              type="button"
              aria-pressed={activeStage === stage.id}
              class={[
                "focus-ring min-h-16 rounded-xl px-4 py-3 text-left transition-colors",
                activeStage === stage.id
                  ? "bg-foreground text-background"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground",
              ]}
              onclick={() => (activeStage = stage.id)}
            >
              <strong class="block text-sm">{stage.label}</strong>
              <span class="mt-1 block text-xs leading-5 opacity-75"
                >{stage.description}</span
              >
            </button>
          {/each}
        </div>
      </div>

      <div aria-live="polite">
        <div class="flex items-end justify-between gap-4 border-b pb-5">
          <div>
            <p class="text-sm font-medium text-primary">
              {selectedStage.label}
            </p>
            <h2 class="mt-1 text-2xl font-semibold">
              {selectedStage.description}
            </h2>
          </div>
          <span class="hidden text-sm text-muted-foreground sm:block"
            >Billed {billingPeriod}</span
          >
        </div>

        <div
          class={[
            "mt-6 grid gap-px overflow-hidden rounded-xl bg-border",
            stagePlans.length > 1 ? "md:grid-cols-3" : "md:grid-cols-1",
          ]}
        >
          {#each stagePlans as plan (plan.id)}
            <article class="flex min-h-full flex-col bg-card p-5 sm:p-6">
              <div class="flex items-start justify-between gap-3">
                <div>
                  <h3 class="text-lg font-semibold">{plan.name}</h3>
                  <p class="mt-2 text-3xl font-semibold tracking-[-0.03em]">
                    {displayPrice(plan)}<span
                      class="text-sm font-normal tracking-normal text-muted-foreground"
                      >/{billingPeriod === "annual" ? "year" : "month"}</span
                    >
                  </p>
                </div>
                {#if plan.featured}
                  <span
                    class="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground"
                  >
                    Recommended
                  </span>
                {/if}
              </div>
              <p class="mt-4 text-sm leading-6 text-muted-foreground">
                {plan.description}
              </p>
              <ul class="mt-5 grid gap-2">
                {#each plan.limits as limit (limit)}
                  <li
                    class="flex gap-2 text-sm leading-5 text-muted-foreground"
                  >
                    <Check
                      class="mt-0.5 size-4 shrink-0 text-primary"
                      aria-hidden="true"
                    />
                    <span>{limit}</span>
                  </li>
                {/each}
              </ul>
              <Button
                href={`${appUrl}/register?plan=${plan.id}&billing_period=${billingPeriod}`}
                class="mt-6 w-full"
                variant={plan.featured ? "default" : "outline"}
              >
                Start {plan.name}
              </Button>
            </article>
          {/each}
        </div>
      </div>
    </div>

    <div class="mt-14 border-y py-8">
      <h2 class="text-lg font-semibold">Included on every managed plan</h2>
      <ul class="mt-5 grid gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {#each sharedFeatures as feature (feature)}
          <li class="flex gap-3 text-sm leading-6 text-muted-foreground">
            <Check
              class="mt-0.5 size-4 shrink-0 text-primary"
              aria-hidden="true"
            />
            <span>{feature}</span>
          </li>
        {/each}
      </ul>
    </div>
  </div>
</section>

<section
  class="section-pad border-y bg-muted/20"
  aria-labelledby="limits-title"
>
  <div class="marketing-shell">
    <div class="max-w-3xl">
      <p class="section-label">Exact limits</p>
      <h2 id="limits-title" class="marketing-heading mt-4">
        Compare only when you need the detail.
      </h2>
      <p class="marketing-copy mt-5">
        Pro remains a single-user plan with higher limits. Team includes three
        seats; Agency includes five.
      </p>
    </div>

    <div class="mt-10 grid gap-3 lg:hidden">
      {#each plans as plan (plan.id)}
        <details class="rounded-xl border bg-card">
          <summary
            class="focus-ring flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 rounded-xl px-4"
          >
            <span>
              <strong>{plan.name}</strong>
              <span class="ml-2 text-sm text-muted-foreground"
                >{displayPrice(plan)}/{billingPeriod === "annual"
                  ? "year"
                  : "month"}</span
              >
            </span>
            <span class="text-xl text-muted-foreground" aria-hidden="true"
              >+</span
            >
          </summary>
          <dl class="grid gap-3 border-t px-4 py-4">
            {#each comparisonRows as row (row.label)}
              <div class="flex items-baseline justify-between gap-4 text-sm">
                <dt class="text-muted-foreground">{row.label}</dt>
                <dd class="font-medium">{row.value(plan)}</dd>
              </div>
            {/each}
          </dl>
        </details>
      {/each}
    </div>

    <div
      class="mt-10 hidden overflow-hidden rounded-xl border bg-card lg:block"
    >
      <table class="w-full border-collapse text-left">
        <thead class="border-b bg-muted/45">
          <tr>
            <th class="px-5 py-4 text-sm font-semibold" scope="col">Limit</th>
            {#each plans as plan (plan.id)}
              <th class="px-5 py-4 text-sm font-semibold" scope="col"
                >{plan.name}</th
              >
            {/each}
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each comparisonRows as row (row.label)}
            <tr>
              <th class="px-5 py-4 text-sm font-medium" scope="row"
                >{row.label}</th
              >
              {#each plans as plan (plan.id)}
                <td class="px-5 py-4 text-sm text-muted-foreground"
                  >{row.value(plan)}</td
                >
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>
