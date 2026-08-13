<script lang="ts">
	import { resolve } from '$app/paths';
	import { managedService } from '@openpost/legal-policy';
	import { ExternalLink, Mail, ShieldCheck } from '@lucide/svelte';

	type Provider = (typeof managedService.providers)[number];
	type HumanAccessKey = keyof typeof managedService.human_access;

	const roleLabels: Record<Provider['role'], string> = {
		subprocessor: 'Subprocessor',
		independent_controller_and_processor: 'Controller and processor',
		independent_service_provider: 'Independent service provider',
		user_requested_source: 'User-requested source'
	};
	const useLabels: Record<Provider['use'], string> = {
		required: 'Required service',
		purchase_triggered: 'Used for purchases',
		feature_triggered: 'Used when the feature runs',
		feedback_triggered: 'Used when feedback is sent'
	};
	const humanAccessLabels: Record<HumanAccessKey, string> = {
		scope: 'Who can access production',
		authentication: 'Authentication',
		routine_access: 'Routine access',
		support_access: 'Support access',
		approval: 'Approval',
		logging: 'Logging',
		emergency: 'Emergency access',
		review_and_revocation: 'Review and revocation'
	};
	const humanAccessEntries = Object.entries(managedService.human_access) as [
		HumanAccessKey,
		string
	][];

	const primaryStore = managedService.stores.find(({ id }) => id === 'primary-host');
	const mediaStore = managedService.stores.find(({ id }) => id === 'media-objects');

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat('en-GB', {
			day: 'numeric',
			month: 'long',
			year: 'numeric',
			timeZone: 'UTC'
		}).format(new Date(`${value}T00:00:00Z`));
	}

	function sourceLabel(source: string): string {
		return `${new URL(source).hostname.replace(/^www\./u, '')} source`;
	}

	function externalLink(source: string) {
		return {
			href: new URL(source).href,
			target: '_blank',
			rel: 'noreferrer'
		} as const;
	}
</script>

<header class="border-b py-14 sm:py-20">
	<div class="marketing-shell grid gap-8 lg:grid-cols-[1fr_18rem] lg:items-end">
		<div class="max-w-4xl">
			<p class="section-label">Managed service trust register</p>
			<h1 class="mt-4 max-w-4xl text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
				Where managed OpenPost data is stored and processed.
			</h1>
			<p class="mt-5 max-w-3xl text-lg leading-8 text-muted-foreground">
				This dated register names the infrastructure, optional services, user-directed recipients,
				and human access boundary for app.openpost.social. It does not make a certification claim.
			</p>
		</div>
		<dl class="border-y py-4 text-sm">
			<div class="flex items-baseline justify-between gap-4 py-2">
				<dt class="text-muted-foreground">Reviewed</dt>
				<dd class="font-medium">{formatDate(managedService.reviewed_on)}</dd>
			</div>
			<div class="flex items-baseline justify-between gap-4 py-2">
				<dt class="text-muted-foreground">Review due</dt>
				<dd class="font-medium">{formatDate(managedService.next_review_on)}</dd>
			</div>
		</dl>
	</div>
</header>

<section class="border-b" aria-label="Managed service at a glance">
	<div class="marketing-shell grid divide-y sm:grid-cols-3 sm:divide-x sm:divide-y-0">
		<div class="py-6 sm:px-6 sm:first:pl-0">
			<p class="text-sm font-semibold">Primary service data</p>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				{primaryStore?.location}
			</p>
		</div>
		<div class="py-6 sm:px-6">
			<p class="text-sm font-semibold">Media objects</p>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				{mediaStore?.location}
			</p>
		</div>
		<div class="py-6 sm:px-6 sm:last:pr-0">
			<p class="text-sm font-semibold">Human access</p>
			<p class="mt-2 text-sm leading-6 text-muted-foreground">
				One named operator; key-only SSH and sudo; no two-person approval.
			</p>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[18rem_1fr]">
		<div>
			<p class="section-label">Data locations</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-tight text-balance">
				Each storage boundary has a different retention rule.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				Browser-local editor data is included so the boundary is explicit even before anything
				reaches the managed service.
			</p>
		</div>
		<div class="divide-y border-y">
			{#each managedService.stores as store (store.id)}
				<article class="grid gap-5 py-6 md:grid-cols-[12rem_1fr]">
					<div>
						<h3 class="font-semibold">{store.name}</h3>
						<p class="mt-2 text-sm leading-6 text-muted-foreground">
							{store.provider}
						</p>
						<p class="mt-2 text-sm font-medium">{store.location}</p>
					</div>
					<dl class="grid gap-4 text-sm leading-6 sm:grid-cols-3">
						<div>
							<dt class="font-semibold">Data</dt>
							<dd class="mt-1 text-muted-foreground">{store.data}</dd>
						</div>
						<div>
							<dt class="font-semibold">Retention</dt>
							<dd class="mt-1 text-muted-foreground">{store.retention}</dd>
						</div>
						<div>
							<dt class="font-semibold">Protection</dt>
							<dd class="mt-1 text-muted-foreground">{store.protection}</dd>
						</div>
					</dl>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell">
		<div class="max-w-3xl">
			<p class="section-label">Service-provider register</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-tight text-balance">
				Required services and feature-triggered recipients are named separately.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				“Feature-triggered” means no request is sent until that feature is used. A provider's role
				describes this OpenPost data path; it does not replace the provider's own terms.
			</p>
		</div>

		<div class="mt-10 divide-y border-y">
			{#each managedService.providers as provider (provider.id)}
				<article id={provider.id} class="grid scroll-mt-24 gap-5 py-7 lg:grid-cols-[14rem_1fr_1fr]">
					<div>
						<h3 class="font-semibold">{provider.name}</h3>
						<p class="mt-2 text-xs font-medium text-primary">
							{useLabels[provider.use]}
						</p>
						<p class="mt-1 text-xs text-muted-foreground">
							{roleLabels[provider.role]}
						</p>
					</div>
					<dl class="grid gap-4 text-sm leading-6">
						<div>
							<dt class="font-semibold">Purpose</dt>
							<dd class="mt-1 text-muted-foreground">{provider.purpose}</dd>
						</div>
						<div>
							<dt class="font-semibold">Data</dt>
							<dd class="mt-1 text-muted-foreground">{provider.data}</dd>
						</div>
					</dl>
					<dl class="grid gap-4 text-sm leading-6">
						<div>
							<dt class="font-semibold">Location</dt>
							<dd class="mt-1 text-muted-foreground">{provider.location}</dd>
						</div>
						<div>
							<dt class="font-semibold">Transfer facts</dt>
							<dd class="mt-1 text-muted-foreground">{provider.transfer}</dd>
						</div>
						<div class="flex flex-wrap gap-x-4 gap-y-1">
							{#each provider.source_urls as source (source)}
								<a
									{...externalLink(source)}
									class="focus-ring inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-medium text-primary"
								>
									{sourceLabel(source)}
									<ExternalLink class="size-3" aria-hidden="true" />
								</a>
							{/each}
						</div>
					</dl>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[18rem_1fr]">
		<div>
			<p class="section-label">User-directed recipients</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-tight text-balance">
				Publishing and sign-in send data only to the service the user selects.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				These networks are not general OpenPost subprocessors. Their own terms apply when a user
				connects an account, signs in, or sends content.
			</p>
		</div>
		<div class="divide-y border-y">
			{#each managedService.directed_recipients as recipient (recipient.name)}
				<article class="grid gap-4 py-6 md:grid-cols-[12rem_1fr_1fr]">
					<h3 class="font-semibold">{recipient.name}</h3>
					<div class="text-sm leading-6">
						<p>{recipient.purpose}</p>
						<p class="mt-2 text-muted-foreground">{recipient.data}</p>
					</div>
					<div class="text-sm leading-6">
						<p class="text-muted-foreground">{recipient.location}</p>
						<a
							{...externalLink(recipient.source_url)}
							class="focus-ring mt-2 inline-flex min-h-11 items-center gap-1 rounded-md text-xs font-medium text-primary"
						>
							{sourceLabel(recipient.source_url)}
							<ExternalLink class="size-3" aria-hidden="true" />
						</a>
					</div>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-y bg-muted/20">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[18rem_1fr]">
		<div>
			<ShieldCheck class="size-5 text-primary" aria-hidden="true" />
			<p class="section-label mt-5">Human production access</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-tight text-balance">
				The access boundary includes its limits.
			</h2>
			<p class="mt-4 text-sm leading-6 text-muted-foreground">
				OpenPost states where a stronger control does not exist instead of implying an approval or
				audit system that has not been implemented.
			</p>
		</div>
		<dl class="divide-y border-y">
			{#each humanAccessEntries as [key, value] (key)}
				<div class="grid gap-2 py-5 sm:grid-cols-[12rem_1fr]">
					<dt class="font-semibold">{humanAccessLabels[key]}</dt>
					<dd class="text-sm leading-6 text-muted-foreground">{value}</dd>
				</div>
			{/each}
		</dl>
	</div>
</section>

<section class="section-pad">
	<div class="reading-shell border-y py-8">
		<p class="section-label">Changes and questions</p>
		<h2 class="mt-4 text-2xl font-semibold tracking-tight">
			Review the current register before relying on it.
		</h2>
		<p class="mt-4 leading-7 text-muted-foreground">
			{managedService.change_notice} The next scheduled fact review is
			{formatDate(managedService.next_review_on)}.
		</p>
		<div class="mt-6 flex flex-wrap gap-x-6 gap-y-2 text-sm font-medium">
			<a
				href={`mailto:${managedService.contact}`}
				class="focus-ring inline-flex min-h-11 items-center gap-2 rounded-md text-primary"
			>
				<Mail class="size-4" aria-hidden="true" />
				Ask a privacy question
			</a>
			<a
				href={resolve('/privacy')}
				class="focus-ring inline-flex min-h-11 items-center rounded-md text-primary"
				>Read the Privacy Policy</a
			>
			<a
				href={resolve('/security')}
				class="focus-ring inline-flex min-h-11 items-center rounded-md text-primary"
				>Review security controls</a
			>
		</div>
	</div>
</section>
