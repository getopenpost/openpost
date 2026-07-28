<script lang="ts">
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
		UserRoundCheck
	} from 'lucide-svelte';
	import { Button } from '$lib/components/ui/button';
	import { githubUrl, siteUrl } from '../_marketing';

	const controls = [
		{
			title: 'Connected account credentials',
			detail:
				'Access tokens, refresh tokens, TOTP secrets, and stored provider-app secrets use AES-256-GCM authenticated encryption at rest.',
			icon: LockKeyhole,
			href: `${githubUrl}/blob/main/backend/internal/services/crypto/encrypt.go`
		},
		{
			title: 'Passwords and sign-in',
			detail:
				'Passwords are hashed with bcrypt. Users can add TOTP or passkeys and review or revoke active browser sessions.',
			icon: UserRoundCheck,
			href: `${githubUrl}/blob/main/backend/internal/services/auth/auth.go`
		},
		{
			title: 'Browser sessions',
			detail:
				'Signed sessions expire after seven days, are tracked server-side, and use HttpOnly cookies with Secure and SameSite=Lax protections on HTTPS.',
			icon: ShieldCheck,
			href: `${githubUrl}/blob/main/backend/internal/services/sessions/service.go`
		},
		{
			title: 'Automation credentials',
			detail:
				'API, CLI, and MCP tokens are stored as hashes, can be revoked, and can be bound to one workspace. MCP clients can use enforced mcp:read or mutation-capable mcp:full access.',
			icon: KeyRound,
			href: `${githubUrl}/blob/main/backend/internal/services/apitokens/service.go`
		},
		{
			title: 'Read and mutation boundary',
			detail:
				'mcp:read rejects cached, direct, and delegated mutations. mcp:full can route guaranteed reads through query_operation and approved state changes or external actions through execute_operation.',
			icon: GitBranch,
			href: `${githubUrl}/blob/main/backend/internal/api/handlers/mcp.go`
		}
	] as const;

	const boundaries = [
		{
			owner: 'OpenPost application',
			responsibility:
				'Authentication, role and workspace checks, credential encryption, token revocation, provider validation, and durable job state.'
		},
		{
			owner: 'Hosting operator',
			responsibility:
				'TLS, strong environment secrets, encryption-key custody, database and media access, backups, restore tests, provider app credentials, and timely updates.'
		},
		{
			owner: 'Social networks',
			responsibility:
				'OAuth consent, account permissions, API quotas, content review, media processing, platform availability, and the final published post.'
		}
	] as const;
</script>

<svelte:head>
	<title>Security controls and responsibilities - OpenPost</title>
	<meta
		name="description"
		content="How OpenPost keeps provider credentials away from agents, scopes and revokes automation access, separates read and mutation operations, and protects sessions."
	/>
	<link rel="canonical" href={`${siteUrl}/security`} />
</svelte:head>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="grid gap-12 lg:grid-cols-[1fr_22rem] lg:items-end">
			<div class="max-w-4xl">
				<p class="section-label">Security</p>
				<h1 class="marketing-title mt-5">Keep social credentials inside the publishing system.</h1>
				<p class="marketing-copy mt-6">
					People, agents, and API clients use revocable OpenPost access. Provider credentials stay
					encrypted inside OpenPost. Self-hosters remain responsible for the host, keys, backups,
					and provider apps.
				</p>
				<div class="mt-8 flex flex-wrap gap-3">
					<Button href={`${githubUrl}/blob/main/SECURITY.md`} size="lg">
						Read the security policy
						<ExternalLink data-icon="inline-end" />
					</Button>
					<Button href="mailto:openpost+security@rgo.pt" variant="outline" size="lg"
						>Report a vulnerability</Button
					>
				</div>
			</div>
			<aside class="border-l pl-6">
				<Radar class="size-5 text-primary" />
				<h2 class="mt-4 font-semibold">Security claims are source-backed</h2>
				<p class="mt-2 text-sm leading-6 text-muted-foreground">
					Each control below links to its implementation. OpenPost does not claim SOC 2, ISO 27001,
					or an independent penetration test.
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
			<p class="mt-5 text-lg leading-8 text-muted-foreground">
				A database leak, a stolen browser, and an exposed automation key are different risks.
				OpenPost gives each one a separate control and revocation path.
			</p>
		</div>
		<div class="mt-10 divide-y border-y">
			{#each controls as control (control.title)}
				{@const Icon = control.icon}
				<article class="grid gap-5 p-6 sm:grid-cols-[3rem_1fr_auto] sm:items-center">
					<div class="flex size-10 items-center justify-center">
						<Icon class="size-5 text-primary" />
					</div>
					<div>
						<h3 class="font-semibold">{control.title}</h3>
						<p class="mt-2 text-sm leading-6 text-muted-foreground">
							{control.detail}
						</p>
					</div>
					<a
						href={control.href}
						target="_blank"
						rel="noreferrer"
						class="inline-flex items-center gap-2 text-sm font-medium text-primary"
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
				Know what the boundary protects—and what permission still allows.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				OpenPost separates credentials and operation classes. It does not pretend that a token with
				mutation access is read-only.
			</p>
		</div>
		<div class="divide-y border-y">
			<div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
				<Bot class="size-5 text-primary" />
				<div>
					<h3 class="font-semibold">The client receives an OpenPost token</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						It does not receive the X, Meta, LinkedIn, Mastodon, Bluesky, TikTok, or Google
						credential stored for a connected account.
					</p>
				</div>
			</div>
			<div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
				<KeyRound class="size-5 text-primary" />
				<div>
					<h3 class="font-semibold">Start inspection with mcp:read</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						The read-only scope can search the catalog, use read-only tools and prompts, and query
						workspace state. It cannot call mutations through cached, direct, or delegated paths.
					</p>
				</div>
			</div>
			<div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
				<GitBranch class="size-5 text-primary" />
				<div>
					<h3 class="font-semibold">mcp:full remains real mutation permission</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						A full-scope client can create, change, schedule, or publish through execute_operation
						after its own approval flow. Grant it only to clients you trust.
					</p>
				</div>
			</div>
			<div class="grid gap-4 p-5 sm:grid-cols-[2.5rem_1fr]">
				<ShieldCheck class="size-5 text-primary" />
				<div>
					<h3 class="font-semibold">Human review is a workflow choice</h3>
					<p class="mt-2 text-sm leading-6 text-muted-foreground">
						Review drafts in the web app before scheduling. OpenPost does not currently claim a
						universal approval gate for every mutation-capable integration.
					</p>
				</div>
			</div>
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell">
		<div class="grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
			<div>
				<p class="section-label">Trust boundaries</p>
				<h2 class="mt-4 text-3xl font-semibold text-balance">Know who controls each layer.</h2>
				<p class="mt-4 text-sm leading-6 text-muted-foreground">
					Open source lets you inspect the application. It does not secure a host, provider account,
					or backup by itself.
				</p>
			</div>
			<div class="divide-y border-y">
				{#each boundaries as boundary (boundary.owner)}
					<div class="grid gap-3 p-5 sm:grid-cols-[10rem_1fr]">
						<h3 class="font-semibold">{boundary.owner}</h3>
						<p class="text-sm leading-6 text-muted-foreground">
							{boundary.responsibility}
						</p>
					</div>
				{/each}
			</div>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid divide-y border-y lg:grid-cols-3 lg:divide-x lg:divide-y-0">
		<article class="py-7 lg:px-7 lg:first:pl-0">
			<Server class="size-5 text-primary" />
			<h2 class="mt-5 text-xl font-semibold">Self-host securely</h2>
			<ul class="mt-5 space-y-3 text-sm leading-6 text-muted-foreground">
				<li class="flex gap-2">
					<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />Use TLS and keep the
					application port behind a reverse proxy.
				</li>
				<li class="flex gap-2">
					<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />Store strong JWT and
					encryption secrets outside the image and repository.
				</li>
				<li class="flex gap-2">
					<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />Back up the database, media,
					and required secrets; test the restore.
				</li>
				<li class="flex gap-2">
					<CheckCircle2 class="mt-1 size-3.5 shrink-0 text-primary" />Install current releases and
					dependency fixes.
				</li>
			</ul>
		</article>
		<article class="py-7 lg:px-7">
			<FileWarning class="size-5 text-primary" />
			<h2 class="mt-5 text-xl font-semibold">Report privately</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Do not open a public issue for a vulnerability. Email the maintainer with the affected
				version, reproduction steps, impact, and any suggested fix.
			</p>
			<a
				href="mailto:openpost+security@rgo.pt"
				class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary"
			>
				openpost+security@rgo.pt <ArrowRight class="size-4" />
			</a>
		</article>
		<article class="py-7 lg:px-7 lg:last:pr-0">
			<ShieldCheck class="size-5 text-primary" />
			<h2 class="mt-5 text-xl font-semibold">Scanned before release</h2>
			<p class="mt-3 text-sm leading-6 text-muted-foreground">
				Release preflight runs Go vulnerability analysis and a production JavaScript dependency
				audit. A passing scan reduces known dependency risk; it is not a security certification.
			</p>
			<a
				href={`${githubUrl}/blob/main/scripts/security-check.sh`}
				target="_blank"
				rel="noreferrer"
				class="mt-5 inline-flex items-center gap-2 text-sm font-medium text-primary"
			>
				Inspect the release check <ExternalLink class="size-3.5" />
			</a>
		</article>
	</div>
</section>
