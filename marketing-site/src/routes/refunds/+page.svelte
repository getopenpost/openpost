<script lang="ts">
	import { resolve } from '$app/paths';
	import { formatPolicyEffectiveDate, legalPolicy } from '@openpost/legal-policy';

	const effectiveDate = formatPolicyEffectiveDate(legalPolicy.refunds);
</script>

<header class="border-b py-14 sm:py-20">
	<div class="reading-shell">
		<p class="section-label">Legal</p>
		<h1 class="mt-4 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
			Refund Policy
		</h1>
		<p class="mt-5 text-lg leading-8 text-muted-foreground">
			How cancellations, refund requests, billing errors, and consumer rights work for the hosted
			OpenPost service.
		</p>
		<a href={resolve('/pricing')} class="mt-5 inline-flex text-sm font-medium text-primary"
			>Pricing</a
		>
	</div>
</header>

<section class="section-pad">
	<article class="reading-shell prose dark:prose-invert">
		<p><strong>Effective date:</strong> {effectiveDate}</p>
		<p><strong>Policy version:</strong> {legalPolicy.refunds.version}</p>
		<p>
			This Refund Policy is incorporated into the Terms of Service. OpenPost does not record a
			separate acceptance for this document.
		</p>

		<h2>1. Who processes refunds</h2>
		<p>
			OpenPost is operated by Rodrigo Dias, a sole trader in Porto, Portugal. Paddle is the Merchant
			of Record for orders processed by Paddle. Paddle processes the payment, applicable taxes,
			returns, and approved refunds. If your receipt names another payment provider, request the
			refund through that provider. For help, email
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>.
		</p>

		<h2>2. Free trials and cancellation</h2>
		<p>
			A free trial can require a payment method. The checkout states the trial end date and the
			amount that will be charged after the trial. Cancel in the billing portal before that date to
			avoid the first charge.
		</p>
		<p>
			Paid subscriptions renew until cancelled. Cancellation normally takes effect at the end of the
			current billing period, and access continues until then. Cancelling does not automatically
			refund an earlier charge.
		</p>

		<h2>3. When to request a refund</h2>
		<p>
			Please request help promptly if you were charged more than once, charged after a timely
			cancellation, charged the wrong amount, unable to access a paid service because of an OpenPost
			fault, or if the purchase was unauthorized. Include the account email, transaction or receipt
			number, charge date, and a short description. Do not send full card details.
		</p>
		<p>
			We assess requests using the purchase record, service use, the reason for the request, this
			policy, the payment provider's rules, and applicable law. Except where law requires a refund
			or we agree otherwise, completed billing periods and partially used periods are not refundable
			or prorated.
		</p>

		<h2>4. Consumer withdrawal and other mandatory rights</h2>
		<p>
			Nothing in this policy limits consumer rights that cannot be waived. If the law where you live
			gives you a withdrawal, cancellation, warranty, or refund right, that right applies. In some
			countries, a right to withdraw from a digital service can change after you ask for immediate
			performance and expressly consent to the service starting during the withdrawal period.
		</p>
		<p>
			Consumers in the European Union, European Economic Area, Switzerland, or the United Kingdom
			may have a 14-day withdrawal right, subject to the law that applies to the purchase and any
			valid request for immediate service. Submit the request as soon as possible so Paddle can
			assess it correctly.
		</p>

		<h2>5. How to submit a request</h2>
		<ol>
			<li>
				For a Paddle order, use
				<a href="https://paddle.net">paddle.net</a> or the support link on your Paddle receipt.
			</li>
			<li>
				You can also email
				<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>. We will provide product details to
				Paddle when needed.
			</li>
			<li>For an order processed elsewhere, use the provider named on the receipt.</li>
		</ol>

		<h2>6. Approved refunds</h2>
		<p>
			Approved refunds are returned through the original payment method where possible. The payment
			provider and your bank control the final posting time. Currency conversion or bank charges may
			cause the amount shown on a statement to differ from the original charge.
		</p>

		<h2>7. Chargebacks</h2>
		<p>
			Contact Paddle or OpenPost before starting a chargeback so we can review the charge and
			correct an error quickly. This request does not remove any right you have to dispute an
			unauthorized or incorrect payment with your bank.
		</p>

		<h2>8. Changes</h2>
		<p>
			We may update this policy for service, provider, or legal changes. The policy version and
			effective date above identify the current text. Material changes apply prospectively unless
			law requires otherwise and, when they change the agreement, are handled through the Terms
			acceptance flow. Corrections that do not change meaning keep the same version.
		</p>
	</article>
</section>
