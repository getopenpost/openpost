<script lang="ts">
	import { siteUrl } from '../_marketing';

	const effectiveDate = '22 July 2026';
</script>

<svelte:head>
	<title>Terms of Service - OpenPost</title>
	<meta
		name="description"
		content="Terms for accounts, subscriptions, connected providers, publishing, and acceptable use of the hosted OpenPost service."
	/>
	<link rel="canonical" href={`${siteUrl}/terms`} />
</svelte:head>

<header class="border-b py-14 sm:py-20">
	<div class="reading-shell">
		<p class="section-label">Legal</p>
		<h1 class="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
			Terms of Service
		</h1>
		<p class="mt-5 text-lg leading-8 text-muted-foreground">
			Terms for the hosted OpenPost service. The open-source license governs self-hosted software.
		</p>
		<a href="/pricing" class="mt-5 inline-flex text-sm font-medium text-primary">Pricing</a>
	</div>
</header>

<section class="section-pad">
	<article class="reading-shell prose dark:prose-invert">
		<p><strong>Effective date:</strong> {effectiveDate}</p>

		<h2>1. Agreement and operator</h2>
		<p>
			These Terms of Service form an agreement between you and Rodrigo Dias, Porto, Portugal,
			operator of the hosted OpenPost service at
			<a href="https://app.openpost.social">app.openpost.social</a>. By creating an account or using
			the hosted service, you agree to these terms and acknowledge the
			<a href="/privacy">Privacy Policy</a>. Contact
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a> with legal or account questions.
		</p>
		<p>
			You must be at least 18 and able to enter a binding agreement. If you use OpenPost for an
			organization, you confirm that you can bind that organization.
		</p>

		<h2>2. The service</h2>
		<p>
			OpenPost provides tools to draft, store, preview, schedule, automate, and publish content to
			connected social accounts. Features can include workspaces, teams, media storage, a CLI, API,
			and MCP tools. Provider availability, permissions, review, quotas, rate limits, media rules,
			and account eligibility differ by provider and can change outside OpenPost's control.
		</p>
		<p>
			A feature marked implemented or supported means OpenPost contains the relevant workflow. It
			does not guarantee that every provider will approve or enable that feature for your account.
			You are responsible for checking content and destinations before publishing.
		</p>

		<h2>3. Accounts and security</h2>
		<ul>
			<li>Provide accurate account information and keep it current.</li>
			<li>Use a unique password and protect sessions, passkeys, TOTP secrets, and API tokens.</li>
			<li>Grant workspace roles and automation scopes only to people and clients you trust.</li>
			<li>Notify us promptly at openpost@rgo.pt if you suspect unauthorized access.</li>
			<li>You are responsible for activity performed through your account until you notify us.</li>
		</ul>

		<h2>4. Connected providers</h2>
		<p>
			You authorize OpenPost to access connected providers and perform the actions you request. You
			must have permission to use each account, page, channel, credential, and item of content. Your
			use remains subject to each provider's terms, developer policies, and privacy rules.
		</p>
		<p>
			You can disconnect an account in OpenPost and may also revoke access at the provider. A
			provider may suspend an integration, reject content, delay processing, change an API, or
			revoke access. OpenPost is not responsible for a provider's service, moderation decision,
			policy, outage, or data handling.
		</p>
		<p>
			By using OpenPost's YouTube integration, you also agree to the
			<a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
		</p>

		<h2>5. Your content</h2>
		<p>
			You keep ownership of content you submit. You give OpenPost a limited, worldwide license to
			host, copy, process, adapt for provider requirements, transmit, and display that content only
			as needed to operate, secure, and support the service and perform your instructions. This
			license ends when the content is deleted, subject to short-lived backups and legal retention.
		</p>
		<p>
			You confirm that your content and instructions do not violate law, intellectual-property,
			privacy, publicity, confidentiality, consumer-protection, advertising, election, or provider
			rules. OpenPost does not review or endorse content before publication.
		</p>

		<h2>6. Acceptable use</h2>
		<p>You must not use OpenPost to:</p>
		<ul>
			<li>break the law, infringe rights, threaten people, or facilitate abuse or exploitation;</li>
			<li>
				send spam, deceptive campaigns, malware, phishing, or coordinated inauthentic activity;
			</li>
			<li>evade provider limits, account restrictions, review requirements, or access controls;</li>
			<li>probe, disrupt, overload, scrape, or access the service without authorization;</li>
			<li>share credentials or resell access outside the plan and workspace controls provided;</li>
			<li>use automation in a way that creates unreasonable load or harms other users.</li>
		</ul>
		<p>
			We may rate-limit, reject, remove, or preserve content and suspend access when reasonably
			necessary to protect users, providers, the service, or comply with law. We will give notice
			when practical and lawful.
		</p>

		<h2>7. Plans, billing, and cancellation</h2>
		<p>
			Paid plans renew for the billing period shown at checkout until cancelled. Prices, included
			usage, seats, storage, and taxes are shown before purchase. Polar processes checkout and
			billing. You authorize recurring charges to the payment method managed there.
		</p>
		<p>
			You can manage or cancel a subscription from the billing portal. Cancellation normally takes
			effect at the end of the current paid period. Unless law requires otherwise, amounts already
			paid are non-refundable and unused quotas do not roll over. Statutory consumer withdrawal,
			refund, and warranty rights are not limited by these terms. Contact openpost@rgo.pt promptly
			for billing errors.
		</p>
		<p>
			We may change future prices or plan limits with reasonable advance notice. If payment fails,
			we may retry it and limit paid features after notice. We will not intentionally delete account
			data solely because a renewal payment failed without giving a reasonable opportunity to export
			it.
		</p>

		<h2>8. Service changes and availability</h2>
		<p>
			We work to keep the service available and publishing jobs visible, but do not promise
			uninterrupted or error-free operation. Scheduled publishing depends on networks, providers,
			credentials, review state, media processing, and internet services outside our control. Keep
			independent copies of important content and review failures and queue status.
		</p>
		<p>
			We may add, change, or remove features. For a material reduction to a paid plan, we will give
			reasonable notice when practical and offer any remedy required by law.
		</p>

		<h2>9. Suspension, termination, export, and deletion</h2>
		<p>
			You may stop using the service at any time. Account settings provide a data export and
			permanent deletion workflow. Shared ownership, active billing, or required administrator roles
			must be resolved before deletion can complete.
		</p>
		<p>
			We may suspend or terminate access for a material breach, security threat, legal requirement,
			fraud, abuse, or prolonged non-payment. When appropriate, we will explain the reason and allow
			time to cure or export data. We may terminate the hosted service with reasonable notice and an
			export opportunity, except where immediate action is required.
		</p>

		<h2>10. Open-source software</h2>
		<p>
			The OpenPost source code is available under the license in its repository. That license
			governs your copying, modification, and self-hosting of the software. These terms govern only
			the hosted service and related accounts, subscriptions, and support.
		</p>

		<h2>11. Disclaimers</h2>
		<p>
			To the extent permitted by law, the service is provided as available and without implied
			warranties beyond those that cannot legally be excluded. OpenPost does not guarantee audience
			reach, engagement, provider approval, publication at an exact second, preservation by a social
			provider, or compliance of your content. Nothing in these terms excludes mandatory consumer
			rights.
		</p>

		<h2>12. Liability</h2>
		<p>
			OpenPost is not liable for indirect, incidental, special, consequential, or lost-profit
			damages where such exclusions are lawful. For claims arising from the hosted service, total
			liability is limited to the amount you paid for the service during the 12 months before the
			event giving rise to the claim. This limit does not apply to fraud, wilful misconduct, death
			or personal injury caused by negligence, data-protection liability that cannot be limited, or
			any other liability that law does not allow us to exclude or limit.
		</p>

		<h2>13. Governing law and disputes</h2>
		<p>
			Portuguese law governs these terms, without overriding mandatory protections that apply in
			your country of residence. Courts in Portugal have jurisdiction, except where consumer law
			allows you to bring a claim elsewhere. Before filing a claim, contact openpost@rgo.pt so we
			can try to resolve it. European consumers may also use an applicable consumer
			dispute-resolution body.
		</p>

		<h2>14. Changes and general terms</h2>
		<p>
			We may update these terms for legal, security, or service changes. We will provide reasonable
			notice of material changes. Continued use after the stated effective date means you accept the
			updated terms; if you do not, stop using the service and cancel your plan.
		</p>
		<p>
			If one provision is unenforceable, the others remain effective. A failure to enforce a
			provision is not a waiver. You may not transfer this agreement without our consent; we may
			transfer it as part of a lawful business reorganization while preserving your rights. These
			terms, the Privacy Policy, and checkout terms form the agreement for the hosted service.
		</p>

		<h2>15. Contact</h2>
		<p>
			Questions, legal notices, billing issues, and account requests can be sent to
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>.
		</p>
	</article>
</section>
