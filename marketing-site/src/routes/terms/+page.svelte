<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatPolicyEffectiveDate, legalPolicy } from '@openpost/legal-policy';

	const effectiveDate = formatPolicyEffectiveDate(legalPolicy.terms);
</script>

<header class="border-b py-14 sm:py-20">
	<div class="reading-shell">
		<p class="section-label">Legal</p>
		<h1 class="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
			Terms of Service
		</h1>
		<p class="mt-5 text-lg leading-8 text-muted-foreground">
			Terms for the hosted OpenPost service. The open-source license governs self-hosted software.
		</p>
		<a href={resolve('/pricing')} class="mt-5 inline-flex text-sm font-medium text-primary"
			>Pricing</a
		>
	</div>
</header>

<section class="section-pad">
	<article class="reading-shell prose dark:prose-invert">
		<p><strong>Effective date:</strong> {effectiveDate}</p>
		<p><strong>Policy version:</strong> {legalPolicy.terms.version}</p>

		<h2>1. Agreement and operator</h2>
		<p>
			These Terms of Service form an agreement between you and Rodrigo Dias, a sole trader in Porto,
			Portugal who operates the OpenPost trade name and the hosted OpenPost service at
			<a href="https://app.openpost.social">app.openpost.social</a>. By creating an account or using
			the hosted service, you agree to these terms and acknowledge the
			<a href={resolve('/privacy')}>Privacy Policy</a>. Contact
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
			and MCP tools. Access, review, plan limits, request limits, media rules, and account
			eligibility differ by social network and can change outside OpenPost's control.
		</p>
		<p>
			A feature marked implemented or supported is present in OpenPost. It does not guarantee that
			every social network will approve or enable it for your account. You must check the content
			and accounts before you publish.
		</p>

		<h2>3. Accounts and security</h2>
		<ul>
			<li>Provide accurate account information and keep it current.</li>
			<li>Use a unique password and protect sessions, passkeys, TOTP secrets, and API tokens.</li>
			<li>Grant workspace roles and tool access only to people and clients you trust.</li>
			<li>Notify us promptly at openpost@rgo.pt if you suspect unauthorized access.</li>
			<li>You are responsible for activity performed through your account until you notify us.</li>
		</ul>

		<h2>4. Connected social networks</h2>
		<p>
			You allow OpenPost to access connected social networks and perform the actions you request.
			You must have permission to use each account, page, channel, key, and item of content. Your
			use remains subject to each social network's terms, developer policies, and privacy rules.
		</p>
		<p>
			You can disconnect an account in OpenPost and remove access on the social network. A social
			network may suspend an app, reject content, delay work, change an API, or remove access.
			OpenPost is not responsible for its service, moderation decisions, policies, outages, or data
			handling.
		</p>
		<p>
			By using OpenPost's YouTube integration, you also agree to the
			<a href="https://www.youtube.com/t/terms">YouTube Terms of Service</a>.
		</p>

		<h2>5. Your content</h2>
		<p>
			You keep ownership of content you submit. You give OpenPost a limited, worldwide license to
			host, copy, process, adapt for social network rules, send, and display that content only as
			needed to operate, secure, and support the service and perform your instructions. This license
			ends when the content is deleted, subject to short-lived backups and legal retention.
		</p>
		<p>
			You confirm that your content and instructions do not violate law, intellectual-property,
			privacy, publicity, confidentiality, consumer-protection, advertising, election, or social
			network rules. OpenPost does not review or endorse content before publication.
		</p>

		<h2>6. Acceptable use</h2>
		<p>You must not use OpenPost to:</p>
		<ul>
			<li>break the law, infringe rights, threaten people, or help abuse or exploitation;</li>
			<li>
				send spam, deceptive campaigns, malware, phishing, or coordinated inauthentic activity;
			</li>
			<li>evade social network limits, account restrictions, review rules, or access controls;</li>
			<li>probe, disrupt, overload, scrape, or access the service without authorization;</li>
			<li>share credentials or resell access outside the plan and workspace controls provided;</li>
			<li>use automation in a way that creates unreasonable load or harms other users.</li>
		</ul>
		<p>
			We may slow or block requests, reject or remove content, keep needed records, and suspend
			access when needed to protect users, social networks, or the service, or to comply with law.
			We will give notice when practical and lawful.
		</p>

		<h2>7. Plans, billing, and cancellation</h2>
		<p>
			Paid plans renew for the billing period shown at checkout until cancelled. Prices, included
			usage, seats, storage, and applicable taxes are shown before purchase. Paddle is the Merchant
			of Record for orders processed by Paddle. Paddle processes the order, collects payment and
			taxes, issues the customer document, and handles payment-related customer inquiries, returns,
			and refunds. OpenPost provides the service and product support. Paddle's buyer terms also
			apply to a Paddle order. If checkout identifies another payment provider, that provider
			processes the order under the terms shown at checkout.
		</p>
		<p>
			If checkout includes a free trial, the first charge occurs on the date shown before you start
			unless you cancel first. A payment method may be required to begin the trial.
		</p>
		<p>
			You authorize recurring charges to the payment method held by the payment provider. You can
			manage or cancel a subscription from the billing portal. Cancellation normally takes effect at
			the end of the current paid period. The <a href={resolve('/refunds')}>Refund Policy</a>
			explains refund requests and mandatory consumer rights. Unused plan limits do not roll over. Contact
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a> promptly for product or billing help.
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
			uninterrupted or error-free operation. Scheduled publishing depends on social networks,
			account keys, review status, media processing, and internet services outside our control. Keep
			your own copies of important content and check failures in Activity.
		</p>
		<p>
			We may add, change, or remove features. For a material reduction to a paid plan, we will give
			reasonable notice when practical and offer any remedy required by law.
		</p>

		<h2>9. Suspension, termination, export, and deletion</h2>
		<p>
			You may stop using the service at any time. Account settings provide a data export and
			permanent deletion option. You must resolve shared ownership, active billing, or required
			administrator roles before deletion can finish.
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
			reach, engagement, social network approval, publication at an exact second, storage by a
			social network, or compliance of your content. Nothing in these terms excludes mandatory
			consumer rights.
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
			updated terms; if you do not, stop using the service and cancel your plan. A substantive
			change updates the policy version and requires acceptance in OpenPost. Corrections to
			spelling, formatting, or links that do not change meaning keep the same version.
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
