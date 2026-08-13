<script lang="ts">
  import { resolve } from "$app/paths";
  import {
    ArrowRight,
    Bot,
    CheckCircle2,
    ExternalLink,
    FileWarning,
    GitBranch,
    KeyRound,
    LockKeyhole,
    Radar,
    Server,
    ShieldCheck,
    UserRoundCheck,
  } from "@lucide/svelte";
  import { Button } from "$lib/components/ui/button";
  import { formatLegalDate, securityAssurance } from "@openpost/legal-policy";
  import { githubUrl, siteUrl } from "../_marketing";

  const assuranceReviewedOn = formatLegalDate(securityAssurance.reviewed_on);

  const controls = [
    {
      title: "Social account keys",
      detail:
        "OpenPost encrypts access tokens, refresh tokens, TOTP secrets, and saved social app secrets with AES-256-GCM.",
      icon: LockKeyhole,
      href: `${githubUrl}/blob/main/backend/internal/services/crypto/encrypt.go`,
    },
    {
      title: "Passwords and sign-in",
      detail:
        "Passwords are hashed with bcrypt. Users can add TOTP or passkeys and review or revoke active browser sessions.",
      icon: UserRoundCheck,
      href: `${githubUrl}/blob/main/backend/internal/services/auth/auth.go`,
    },
    {
      title: "Browser sessions",
      detail:
        "Signed sessions expire after seven days, are tracked server-side, and use HttpOnly cookies with Secure and SameSite=Lax protections on HTTPS.",
      icon: ShieldCheck,
      href: `${githubUrl}/blob/main/backend/internal/services/sessions/service.go`,
    },
    {
      title: "API and tool access",
      detail:
        "OpenPost stores API, CLI, and MCP tokens as hashes. You can remove them or limit them to one workspace. MCP tools can use read-only mcp:read or full mcp:full access.",
      icon: KeyRound,
      href: `${githubUrl}/blob/main/backend/internal/services/apitokens/service.go`,
    },
    {
      title: "Read and write access",
      detail:
        "mcp:read blocks all changes. mcp:full uses query_operation for reads and execute_operation for changes or calls to outside services.",
      icon: GitBranch,
      href: `${githubUrl}/blob/main/backend/internal/api/handlers/mcp.go`,
    },
  ] as const;

  function externalLink(source: string) {
    return {
      href: new URL(source).href,
      target: "_blank",
      rel: "noreferrer",
    } as const;
  }
</script>

<svelte:head>
  <title>Security controls and responsibilities - OpenPost</title>
  <meta
    name="description"
    content="How OpenPost encrypts social account keys, limits API and AI access, and protects sign-in sessions."
  />
  <link rel="canonical" href={`${siteUrl}/security`} />
</svelte:head>

<section class="border-b py-16 sm:py-24">
  <div class="marketing-shell">
    <div class="grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
      <div class="max-w-4xl">
        <p class="section-label">Security</p>
        <h1 class="marketing-title mt-5">
          Keep social credentials inside the publishing system.
        </h1>
        <p class="marketing-copy mt-6">
          People, AI tools, and API clients use OpenPost access that you can
          remove. Social account keys stay encrypted inside OpenPost. If you
          self-host, you must secure the server, keys, backups, and social apps.
        </p>
        <div class="mt-8 flex flex-wrap gap-3">
          <Button href={`${githubUrl}/blob/main/SECURITY.md`} size="lg">
            Read the security policy
            <ExternalLink data-icon="inline-end" />
          </Button>
          <Button
            href="mailto:openpost+security@rgo.pt"
            variant="outline"
            size="lg">Report a vulnerability</Button
          >
          <Button href={resolve("/trust")} variant="outline" size="lg">
            Review managed-service access
            <ArrowRight data-icon="inline-end" />
          </Button>
        </div>
      </div>
      <aside class="border-l pl-6">
        <Radar class="text-primary size-5" />
        <h2 class="mt-4 font-semibold">Published assurance boundary</h2>
        <p class="text-muted-foreground mt-2 text-sm leading-6">
          {securityAssurance.assurance_boundary.statement}
        </p>
        <p class="text-muted-foreground mt-3 text-xs leading-5">
          Reviewed {assuranceReviewedOn}. Each product control below links to
          implementation evidence.
        </p>
      </aside>
    </div>
  </div>
</section>

<section class="section-pad">
  <div class="marketing-shell">
    <div class="max-w-3xl">
      <p class="section-label">Controls in the product</p>
      <h2 class="marketing-heading mt-4">
        Credentials, sessions, and access are protected separately.
      </h2>
      <p class="text-muted-foreground mt-5 text-lg leading-8">
        A database leak, a stolen browser, and a leaked API key are different
        risks. OpenPost gives you a separate way to limit each one.
      </p>
    </div>
    <div class="mt-10 divide-y border-y">
      {#each controls as control (control.title)}
        {@const Icon = control.icon}
        <article
          class="grid gap-5 p-6 sm:grid-cols-[3rem_1fr_auto] sm:items-center"
        >
          <div class="flex size-10 items-center justify-center">
            <Icon class="text-primary size-5" />
          </div>
          <div>
            <h3 class="font-semibold">{control.title}</h3>
            <p class="text-muted-foreground mt-2 text-sm leading-6">
              {control.detail}
            </p>
          </div>
          <a
            {...externalLink(control.href)}
            class="text-primary inline-flex items-center gap-2 text-sm font-medium"
          >
            Inspect code <ExternalLink class="size-3.5" />
          </a>
        </article>
      {/each}
    </div>
  </div>
</section>

<section class="section-pad border-b">
  <div class="marketing-shell grid gap-12 lg:grid-cols-[0.68fr_1.32fr]">
    <div>
      <p class="section-label">Automation access</p>
      <h2 class="mt-4 text-3xl font-semibold text-balance">
        Know what each access level allows.
      </h2>
      <p class="text-muted-foreground mt-4 text-sm leading-6">
        OpenPost keeps social account keys apart from tool access. A full-access
        token can still make changes.
      </p>
    </div>
    <div class="divide-y border-y">
      <div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
        <Bot class="text-primary size-5" />
        <div>
          <h3 class="font-semibold">The client receives an OpenPost token</h3>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            It does not receive the X, Meta, LinkedIn, Mastodon, Bluesky,
            TikTok, or Google credential stored for a connected account.
          </p>
        </div>
      </div>
      <div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
        <KeyRound class="text-primary size-5" />
        <div>
          <h3 class="font-semibold">Start with read-only mcp:read</h3>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            It can find tools and read workspace data. It cannot make changes.
          </p>
        </div>
      </div>
      <div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
        <GitBranch class="text-primary size-5" />
        <div>
          <h3 class="font-semibold">mcp:full can make changes</h3>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            A tool with full access can create, change, schedule, or publish
            through execute_operation. Give it only to tools you trust.
          </p>
        </div>
      </div>
      <div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
        <ShieldCheck class="text-primary size-5" />
        <div>
          <h3 class="font-semibold">You choose when to review</h3>
          <p class="text-muted-foreground mt-2 text-sm leading-6">
            Review drafts in the web app before scheduling. OpenPost does not
            add a separate approval step for every tool that can make changes.
          </p>
        </div>
      </div>
    </div>
  </div>
</section>

<section class="section-pad bg-muted/20 border-y">
  <div class="marketing-shell">
    <div class="max-w-3xl">
      <p class="section-label">Control and responsibility matrix</p>
      <h2 class="mt-4 text-3xl font-semibold text-balance">
        Managed and self-hosted deployments divide work differently.
      </h2>
      <p class="text-muted-foreground mt-4 text-sm leading-6">
        The application provides product controls. The managed operator runs the
        hosted environment. A self-hosted operator replaces that managed
        boundary. Customers and selected providers still control their own
        accounts, devices, and services. Current managed locations, providers,
        and human access are listed in the <a
          class="focus-ring text-primary rounded-sm font-medium underline underline-offset-4"
          href={resolve("/trust")}>trust register</a
        >. This matrix was reviewed {assuranceReviewedOn}.
      </p>
    </div>
    <div
      class="bg-background mt-10 overflow-x-auto rounded-xl border"
      role="region"
      aria-label="Security control and responsibility matrix"
    >
      <table class="min-w-[96rem] border-collapse text-left text-sm">
        <caption class="sr-only">
          Security controls and responsibilities for managed and self-hosted
          OpenPost deployments
        </caption>
        <thead class="bg-muted/50">
          <tr>
            <th class="w-64 border-b p-4 font-semibold" scope="col">Control</th>
            <th class="w-80 border-b p-4 font-semibold" scope="col"
              >Application</th
            >
            <th class="w-80 border-b p-4 font-semibold" scope="col"
              >Managed service</th
            >
            <th class="w-80 border-b p-4 font-semibold" scope="col"
              >Self-hosted operator</th
            >
            <th class="w-80 border-b p-4 font-semibold" scope="col"
              >Customer or provider</th
            >
          </tr>
        </thead>
        <tbody class="divide-y">
          {#each securityAssurance.control_matrix as control (control.id)}
            <tr class="align-top">
              <th class="p-4 font-semibold" scope="row">
                {control.control}
                <span class="mt-3 block space-y-2">
                  {#each control.evidence as source (source)}
                    <a
                      {...externalLink(`${githubUrl}/blob/main/${source}`)}
                      class="focus-ring text-primary block rounded-sm text-xs leading-5 font-medium underline underline-offset-4"
                      >Inspect {source.split("/").at(-1)}</a
                    >
                  {/each}
                </span>
              </th>
              <td class="text-muted-foreground p-4 leading-6"
                >{control.application}</td
              >
              <td class="text-muted-foreground p-4 leading-6"
                >{control.managed_service}</td
              >
              <td class="text-muted-foreground p-4 leading-6"
                >{control.self_hosted_operator}</td
              >
              <td class="text-muted-foreground p-4 leading-6"
                >{control.customer_or_provider}</td
              >
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</section>

<section class="section-pad border-b">
  <div class="marketing-shell grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
    <div>
      <p class="section-label">Incident history</p>
      <h2 class="mt-4 text-3xl font-semibold text-balance">
        Read an empty register carefully.
      </h2>
    </div>
    <div class="border-y py-6">
      <p class="leading-7">
        {securityAssurance.incident_history.statement}
      </p>
      <p class="text-muted-foreground mt-4 text-sm leading-6">
        {securityAssurance.incident_history.publication_commitment}
      </p>
      {#if securityAssurance.incident_history.entries.length > 0}
        <div class="mt-6 divide-y border-y">
          {#each securityAssurance.incident_history.entries as incident (incident.id)}
            <article class="py-5">
              <h3 class="font-semibold">{incident.summary}</h3>
              <p class="text-muted-foreground mt-2 text-sm leading-6">
                {formatLegalDate(incident.date)} · {incident.scope}
              </p>
              <p class="text-muted-foreground mt-2 text-sm leading-6">
                <strong class="text-foreground font-medium"
                  >Customer action:</strong
                >
                {incident.customer_action}
              </p>
              <p class="text-muted-foreground mt-2 text-sm leading-6">
                <strong class="text-foreground font-medium">Status:</strong>
                {incident.remediation_status}
              </p>
            </article>
          {/each}
        </div>
      {/if}
    </div>
  </div>
</section>

<section class="section-pad">
  <div
    class="marketing-shell grid divide-y border-y lg:grid-cols-3 lg:divide-x lg:divide-y-0"
  >
    <article class="py-7 lg:px-7 lg:first:pl-0">
      <Server class="text-primary size-5" />
      <h2 class="mt-5 text-xl font-semibold">Self-host securely</h2>
      <ul class="text-muted-foreground mt-5 space-y-3 text-sm leading-6">
        <li class="flex gap-2">
          <CheckCircle2 class="text-primary mt-1 size-3.5 shrink-0" />Use TLS
          and keep the application port behind a reverse proxy.
        </li>
        <li class="flex gap-2">
          <CheckCircle2 class="text-primary mt-1 size-3.5 shrink-0" />Store
          strong JWT and encryption secrets outside the image and repository.
        </li>
        <li class="flex gap-2">
          <CheckCircle2 class="text-primary mt-1 size-3.5 shrink-0" />Back up
          the database, media, and required secrets; test the restore.
        </li>
        <li class="flex gap-2">
          <CheckCircle2 class="text-primary mt-1 size-3.5 shrink-0" />Install
          current releases and dependency fixes.
        </li>
      </ul>
    </article>
    <article class="py-7 lg:px-7">
      <FileWarning class="text-primary size-5" />
      <h2 class="mt-5 text-xl font-semibold">Report privately</h2>
      <p class="text-muted-foreground mt-3 text-sm leading-6">
        Do not open a public issue for a vulnerability. Email the maintainer
        with the affected version, reproduction steps, impact, and any suggested
        fix.
      </p>
      <a
        href="mailto:openpost+security@rgo.pt"
        class="text-primary mt-5 inline-flex items-center gap-2 text-sm font-medium"
      >
        openpost+security@rgo.pt <ArrowRight class="size-4" />
      </a>
    </article>
    <article class="py-7 lg:px-7 lg:last:pr-0">
      <ShieldCheck class="text-primary size-5" />
      <h2 class="mt-5 text-xl font-semibold">Scanned before release</h2>
      <p class="text-muted-foreground mt-3 text-sm leading-6">
        Before release, OpenPost checks Go and JavaScript packages for known
        security issues. A passing check lowers known risk, but it is not a
        security certification.
      </p>
      <a
        {...externalLink(`${githubUrl}/blob/main/scripts/security-check.sh`)}
        class="text-primary mt-5 inline-flex items-center gap-2 text-sm font-medium"
      >
        Inspect the release check <ExternalLink class="size-3.5" />
      </a>
    </article>
  </div>
</section>
