<script lang="ts">
	import {
		ArrowRight,
		ExternalLink,
		Github,
		Mail,
		MessageCircle,
		ShieldAlert
	} from '@lucide/svelte';
	import { discordCommunityUrl, githubUrl, supportEmail, supportMailUrl } from '../_marketing';

	const contacts = [
		{
			title: 'Account, billing, privacy, or product support',
			detail:
				'Email support with the account email, workspace name, and a short description. Do not send passwords, social tokens, recovery codes, or payment-card details.',
			label: supportEmail,
			href: supportMailUrl,
			icon: Mail,
			external: false
		},
		{
			title: 'Security report',
			detail:
				'Privately report a suspected vulnerability with the affected URL, impact, and safe steps to reproduce it. Do not post security reports in Discord or a public issue.',
			label: 'openpost+security@rgo.pt',
			href: 'mailto:openpost+security@rgo.pt',
			icon: ShieldAlert,
			external: false
		},
		{
			title: 'Setup, workflow, or self-hosting question',
			detail:
				'Ask the public community when the answer can help other users and does not include private account or infrastructure details.',
			label: 'Open the Discord community',
			href: discordCommunityUrl,
			icon: MessageCircle,
			external: true
		},
		{
			title: 'Bug report or contribution',
			detail:
				'Use the public repository for reproducible software bugs, feature discussions, code changes, and documentation fixes.',
			label: 'Open GitHub',
			href: githubUrl,
			icon: Github,
			external: true
		}
	] as const;
</script>

<section class="border-b py-16 sm:py-24">
	<div class="marketing-shell">
		<div class="max-w-4xl">
			<p class="section-label">Contact OpenPost</p>
			<h1 class="marketing-title mt-5">Send the question to the right place.</h1>
			<p class="marketing-copy mt-6">
				Use private email for account, billing, privacy, or security details. Use the community or
				public repository for questions and reports that can help other people.
			</p>
		</div>
	</div>
</section>

<section class="section-pad">
	<div class="marketing-shell">
		<div class="divide-y border-y">
			{#each contacts as contact (contact.title)}
				{@const Icon = contact.icon}
				<article class="grid gap-5 py-7 sm:grid-cols-[3rem_1fr_auto] sm:items-center">
					<div class="flex size-10 items-center justify-center">
						<Icon class="size-5 text-primary" aria-hidden="true" />
					</div>
					<div>
						<h2 class="text-xl font-semibold">{contact.title}</h2>
						<p class="mt-2 max-w-3xl text-sm leading-6 text-muted-foreground">{contact.detail}</p>
					</div>
					<a
						class="inline-flex min-h-11 items-center gap-2 text-sm font-medium text-primary"
						href={contact.href}
						target={contact.external ? '_blank' : undefined}
						rel={contact.external ? 'noreferrer' : undefined}
					>
						{contact.label}
						{#if contact.external}<ExternalLink
								class="size-4"
								aria-hidden="true"
							/>{:else}<ArrowRight class="size-4" aria-hidden="true" />{/if}
					</a>
				</article>
			{/each}
		</div>
	</div>
</section>

<section class="section-pad border-t bg-muted/20">
	<div class="marketing-shell grid gap-10 lg:grid-cols-[0.7fr_1.3fr]">
		<div>
			<p class="section-label">Useful context</p>
			<h2 class="mt-4 text-3xl font-semibold tracking-[-0.03em] text-balance">
				Help us identify the problem without exposing secrets.
			</h2>
		</div>
		<div>
			<ul class="divide-y border-y text-sm leading-6 text-muted-foreground">
				<li class="py-4">State whether you use the Hosted service or a self-hosted instance.</li>
				<li class="py-4">
					Include the page or feature, platform, post type, and approximate time.
				</li>
				<li class="py-4">
					Copy the visible error after removing tokens, account IDs, and private content.
				</li>
				<li class="py-4">For billing, include the account email but never payment-card details.</li>
			</ul>
			<p class="mt-6 text-sm leading-6 text-muted-foreground">
				OpenPost is operated by Rodrigo Dias, a sole trader in Porto, Portugal. The same operator
				identity appears in the privacy policy and terms.
			</p>
		</div>
	</div>
</section>
