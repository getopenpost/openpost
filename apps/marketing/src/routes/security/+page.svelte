<script lang="ts">
	import { resolve } from '$app/paths';
	import { LockKeyhole, UserRoundCheck, ShieldCheck, ArrowUpRight } from '@lucide/svelte';
	import { Button } from '$lib/components/ui/button';
	import { formatLegalDate, securityAssurance } from '@openpost/legal-policy';
	import { githubUrl } from '../_marketing';
	import HeroAccent from '../_components/HeroAccent.svelte';

	const protections = [
		{
			title: 'Protect your sign-in',
			icon: UserRoundCheck,
			detail:
				'Add a passkey or two-factor authentication. Review your active sessions and sign out a device you no longer use.'
		},
		{
			title: 'Keep account keys private',
			icon: LockKeyhole,
			detail:
				'OpenPost encrypts the credentials saved for your connected social accounts. Your password is hashed before it is stored.'
		},
		{
			title: 'Choose who has access',
			icon: ShieldCheck,
			detail:
				'Use separate workspaces and member roles. Remove access for people and connected tools when they no longer need it.'
		}
	];
</script>

<section class="security-hero marketing-shell">
	<div>
		<h1 class="marketing-title">Your accounts.<br /><HeroAccent>Your control.</HeroAccent></h1>
		<p class="marketing-copy">
			Your business depends on the accounts you connect. Here’s how OpenPost protects them, and the
			controls you have.
		</p>
		<div class="actions">
			<Button href="https://docs.openpo.st/guides/workspaces" size="lg"
				>Protect your account <ArrowUpRight data-icon="inline-end" /></Button
			><a class="focus-ring" href={resolve('/trust')}>See how we handle your data</a>
		</div>
	</div>
	<aside class="security-note">
		<ShieldCheck size={40} strokeWidth={1.3} />
		<h2>A clear account of our practices.</h2>
		<p>{securityAssurance.assurance_boundary.statement}</p>
		<small>Reviewed {formatLegalDate(securityAssurance.reviewed_on)}.</small>
	</aside>
</section>
<section class="marketing-shell protections" aria-label="Account protections">
	{#each protections as protection (protection.title)}<article>
			<protection.icon size={26} strokeWidth={1.5} />
			<h2>{protection.title}</h2>
			<p>{protection.detail}</p>
		</article>{/each}
</section>
<section class="technical-details marketing-shell">
	<div class="details-heading">
		<h2>How protection works.</h2>
		<p>
			The full details are here when you need them. Each control links to the source code behind it.
		</p>
	</div>
	<div>
		{#each securityAssurance.control_matrix as control (control.id)}
			<details>
				<summary>{control.control}</summary>
				<dl>
					<div>
						<dt>In OpenPost</dt>
						<dd>{control.application}</dd>
					</div>
					<div>
						<dt>On OpenPost Cloud</dt>
						<dd>{control.managed_service}</dd>
					</div>
					<div>
						<dt>Your part</dt>
						<dd>{control.customer_or_provider}</dd>
					</div>
					<div>
						<dt>If you self-host</dt>
						<dd>{control.self_hosted_operator}</dd>
					</div>
				</dl>
				<div class="evidence">
					{#each control.evidence as source (source)}<a
							class="focus-ring"
							href={`${githubUrl}/blob/main/${source}`}
							target="_blank"
							rel="noreferrer">View {source.split('/').at(-1)} <ArrowUpRight size={14} /></a
						>{/each}
				</div>
			</details>
		{/each}
	</div>
</section>
<section class="security-bottom marketing-shell">
	<article>
		<h2>Our public record.</h2>
		<p>{securityAssurance.incident_history.statement}</p>
		<p>{securityAssurance.incident_history.publication_commitment}</p>
		{#each securityAssurance.incident_history.entries as incident (incident.id)}<div
				class="incident"
			>
				<h3>{incident.summary}</h3>
				<p>{formatLegalDate(incident.date)} · {incident.scope}</p>
				<p>Customer action: {incident.customer_action}</p>
				<p>Status: {incident.remediation_status}</p>
			</div>{/each}
	</article>
	<article class="report">
		<h2>Tell us privately.</h2>
		<p>
			Email what happened, how to reproduce it, and the version you’re using. Please keep
			vulnerability reports out of public issues.
		</p>
		<a class="focus-ring" href="mailto:openpost+security@rgo.pt"
			>openpost+security@rgo.pt <ArrowUpRight size={17} /></a
		><a class="focus-ring" href={`${githubUrl}/blob/main/.github/SECURITY.md`}
			>Read the security policy <ArrowUpRight size={17} /></a
		>
	</article>
</section>

<style>
	.security-hero {
		display: grid;
		grid-template-columns: minmax(0, 1.4fr) minmax(0, 0.7fr);
		align-items: center;
		gap: 72px;
		padding-block: 80px 64px;
	}
	h1 {
		margin-block: 20px 28px;
	}
	.actions {
		display: flex;
		align-items: center;
		flex-wrap: wrap;
		gap: 16px 24px;
		margin-top: 28px;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		text-decoration: underline;
		text-underline-offset: 4px;
		font-size: 14px;
	}
	.security-note {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
		padding: 32px;
		border-radius: 16px;
	}
	.security-note h2 {
		font-size: 26px;
		margin-block: 28px 16px;
	}
	.security-note p {
		color: inherit;
		font-size: 14px;
	}
	.security-note small {
		display: block;
		margin-top: 20px;
	}
	h2 {
		font-weight: 550;
		line-height: 1.2;
		letter-spacing: -0.025em;
	}
	p,
	dd {
		color: var(--muted-foreground);
		line-height: 1.7;
	}
	.protections {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 48px;
		padding-block: 32px 64px;
	}
	.protections h2 {
		font-size: 23px;
		margin-block: 24px 12px;
	}
	.technical-details {
		display: grid;
		grid-template-columns: minmax(0, 0.65fr) minmax(0, 1fr);
		gap: 80px;
		padding-block: 64px;
		border-block: 1px solid var(--border);
	}
	.details-heading h2,
	.security-bottom h2 {
		font-size: clamp(28px, 3vw, 38px);
		margin-block: 18px;
	}
	details {
		border-bottom: 1px solid var(--border);
	}
	summary {
		cursor: pointer;
		padding-block: 22px;
		font-weight: 550;
	}
	dl {
		display: grid;
		gap: 16px;
		font-size: 14px;
		padding-bottom: 20px;
	}
	dt {
		font-weight: 550;
		margin-bottom: 4px;
	}
	.evidence {
		display: flex;
		flex-wrap: wrap;
		gap: 0 16px;
		padding-bottom: 20px;
		overflow-wrap: anywhere;
	}
	.evidence a {
		font-size: 12px;
	}
	.security-bottom {
		display: grid;
		grid-template-columns: repeat(2, minmax(0, 1fr));
		gap: 64px;
		padding-block: 64px 16px;
	}
	.security-bottom p + p {
		margin-top: 16px;
	}
	.report {
		padding: 32px;
		background: var(--marketing-lilac);
		border-radius: 16px;
	}
	.report,
	.report p {
		color: var(--marketing-lilac-ink);
	}
	.report a {
		display: flex;
		margin-top: 12px;
		overflow-wrap: anywhere;
	}
	.incident {
		padding-block: 20px;
	}
	@media (max-width: 900px) {
		.security-hero,
		.technical-details {
			grid-template-columns: minmax(0, 1fr);
			gap: 36px;
		}
		.protections {
			gap: 28px;
		}
	}
	@media (max-width: 600px) {
		.security-hero {
			padding-top: 44px;
		}
		.protections,
		.security-bottom {
			grid-template-columns: minmax(0, 1fr);
			gap: 36px;
		}
		.security-note,
		.report {
			padding: 24px;
		}
		.technical-details,
		.security-bottom {
			padding-block: 40px;
		}
	}
</style>
