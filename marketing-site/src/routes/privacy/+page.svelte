<script lang="ts">
	import PageHero from '../_components/PageHero.svelte';
	import { siteUrl } from '../_marketing';

	const effectiveDate = '24 July 2026';
</script>

<svelte:head>
	<title>Privacy Policy - OpenPost</title>
	<meta
		name="description"
		content="How OpenPost collects, uses, shares, protects, exports, and deletes personal data for the hosted service."
	/>
	<link rel="canonical" href={`${siteUrl}/privacy`} />
</svelte:head>

<PageHero
	eyebrow="Legal"
	title="Privacy Policy"
	description="This policy explains what the hosted OpenPost service processes, why it does so, and the choices available to you."
	secondaryHref="/security"
	secondaryLabel="Security details"
/>

<section class="section-pad">
	<article class="prose prose-invert mx-auto max-w-3xl px-4 sm:px-6 lg:px-8">
		<p><strong>Effective date:</strong> {effectiveDate}</p>

		<h2>1. Who is responsible</h2>
		<p>
			The hosted OpenPost service at <a href="https://app.openpost.social"
				>app.openpost.social</a
			> is operated by Rodrigo Dias in Porto, Portugal. For privacy requests, email
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>. OpenPost is the data controller
			for account and service data described in this policy.
		</p>
		<p>
			A self-hosted OpenPost installation is controlled by its operator. This policy does not
			govern an independent self-hosted installation; contact that operator about its practices.
		</p>

		<h2>2. Data we process</h2>
		<ul>
			<li>
				<strong>Account and workspace data:</strong> email address, display name, profile image,
				workspace and organization details, roles, invitations, and settings.
			</li>
			<li>
				<strong>Publishing data:</strong> drafts, scheduled and published content, media,
				provider-specific variants, Studio designs and recovery revisions, templates, brand-kit
				values, prompts, schedules, publication status, and job history.
			</li>
			<li>
				<strong>Brand font records:</strong> custom WOFF2 files, family and style metadata, and
				the account and time associated with the required font-license acknowledgement.
			</li>
			<li>
				<strong>Connected-account data:</strong> social provider, account identifier, username,
				profile metadata, granted permissions, and encrypted access or refresh tokens. OpenPost
				does not ask for your social-network password.
			</li>
			<li>
				<strong>Security data:</strong> password hashes, session identifiers, passkey public-key
				material, TOTP configuration, API token metadata, IP address, user agent, sign-in and token
				activity, and password-reset records. OpenPost never stores a readable account password.
			</li>
			<li>
				<strong>Billing data:</strong> plan, entitlement, subscription, checkout, customer, and
				billing-status identifiers received from Polar. OpenPost does not receive or store full
				payment-card details.
			</li>
			<li>
				<strong>Support and service data:</strong> messages you send, operational logs, errors,
				request timing, usage counters, and abuse-prevention signals.
			</li>
		</ul>

		<h2>3. How we receive data</h2>
		<p>
			We receive data from you when you register, configure a workspace, upload content, connect
			a provider, buy a plan, or contact support. We also receive account and publication data
			from providers you connect, billing status from Polar, and limited technical data when your
			browser or client uses the service.
		</p>
		<p>
			Camera access is requested only after you choose a camera action. A captured photo is uploaded
			to the selected workspace only after you choose to use it. Camera video is not recorded.
		</p>

		<h2>4. Why we use data</h2>
		<ul>
			<li>Provide, secure, and support accounts, workspaces, publishing, and automation.</li>
			<li>Send content to the providers and accounts you select.</li>
			<li>Process subscriptions, enforce plan limits, and keep billing records.</li>
			<li>Detect abuse, investigate failures, and protect users and the service.</li>
			<li>Comply with law, enforce the Terms of Service, and resolve disputes.</li>
			<li>Improve reliability and usability using service-level operational information.</li>
		</ul>
		<p>
			For users in the European Economic Area, these uses rely on performing our contract with
			you, our legitimate interests in operating and securing the service, compliance with legal
			obligations, or consent where consent is required. You can withdraw consent without
			affecting earlier lawful processing.
		</p>

		<h2>5. When data is shared</h2>
		<p>We share data only as needed with:</p>
		<ul>
			<li>
				<strong>Social providers you choose</strong>, such as X, Mastodon servers, Bluesky,
				LinkedIn, Meta services, TikTok, or YouTube, to connect accounts and perform requested
				publishing actions. Their terms and privacy policies then apply.
			</li>
			<li>
				<strong>Infrastructure providers</strong> that host the application, database, media,
				email delivery, network, and backups under service-provider obligations.
			</li>
			<li><strong>Polar</strong> for checkout, subscriptions, billing, and customer portals.</li>
			<li>
				<strong>Authorities or other parties</strong> when reasonably necessary to comply with
				law, protect rights and safety, investigate abuse, or complete a business reorganization.
			</li>
		</ul>
		<p>
			OpenPost does not sell personal data, build advertising profiles, or share personal data for
			cross-context behavioral advertising.
		</p>

		<h2>6. Google and YouTube API data</h2>
		<p>
			If you connect YouTube, OpenPost uses Google API data only to provide the connection and
			video-publishing features you request. That use and transfer comply with the
			<a href="https://developers.google.com/terms/api-services-user-data-policy"
				>Google API Services User Data Policy</a
			>, including its Limited Use requirements. OpenPost does not use Google user data for ads,
			credit decisions, or unrelated profiling.
		</p>
		<p>
			OpenPost uses YouTube API Services. Google's handling of information is described in the
			<a href="https://policies.google.com/privacy">Google Privacy Policy</a>.
		</p>
		<p>
			You can disconnect a YouTube account in OpenPost and revoke access from your
			<a href="https://security.google.com/settings/security/permissions"
				>Google account permissions</a
			>.
		</p>

		<h2>7. Retention and deletion</h2>
		<p>
			We keep account and publishing data while your account is active and as needed to provide
			the service. Single-use reset tokens expire quickly and are invalidated after use. Operational
			and security records are kept only as long as needed for reliability, abuse prevention, legal
			obligations, and dispute handling.
		</p>
		<p>
			You can download an account export or request permanent deletion from account settings.
			Deletion can be delayed when you must first transfer shared ownership, cancel active billing,
			or preserve the last required instance administrator. Primary account and personal workspace
			data are removed when deletion completes. Encrypted database backups may retain a copy for up
			to 14 days before automatic expiry. We may retain minimal records when law requires it or to
			prevent fraud and enforce legal rights.
		</p>

		<h2>8. Cookies and local storage</h2>
		<p>
			The application uses essential session and security cookies. It may use local browser storage
			for the selected workspace, server address, language, sound preference, composer return state,
			and unsynced Studio recovery copies. One-time Studio return state expires after two hours;
			unsynced Studio recovery copies expire seven days after the last edit.
		</p>
		<p>
			Studio background removal runs in your browser with model and runtime files served by the
			OpenPost operator. Source pixels are not sent to a background-removal service. A result is
			uploaded to the selected workspace only when processing succeeds. The marketing site does not
			use advertising trackers. The privacy-enhanced YouTube player is loaded only when you open the
			product demo; YouTube may then process device and playback data.
		</p>

		<h2>9. International transfers</h2>
		<p>
			Your selected providers and some service providers may process data outside Portugal or the
			European Economic Area. Where required, transfers use an adequacy decision, contractual
			safeguards, or another lawful transfer mechanism. Publishing to a provider is also a transfer
			initiated by your explicit choice.
		</p>

		<h2>10. Your rights</h2>
		<p>
			Depending on where you live, you may have rights to access, correct, export, delete, restrict,
			or object to processing, and to withdraw consent. Use account settings for export and deletion
			or email <a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>. We may need to verify your
			identity before completing a request.
		</p>
		<p>
			You may also complain to your local data-protection authority. In Portugal, this is the
			<a href="https://www.cnpd.pt/">Comissão Nacional de Proteção de Dados (CNPD)</a>.
		</p>

		<h2>11. Security</h2>
		<p>
			OpenPost uses measures including encrypted provider tokens, password hashing, secure session
			cookies, scoped and revocable automation tokens, access controls, TOTP, passkeys, rate limits,
			backups, and dependency scanning. No internet service can guarantee absolute security. Report
			a suspected vulnerability to
			<a href="mailto:openpost+security@rgo.pt">openpost+security@rgo.pt</a>.
		</p>

		<h2>12. Children</h2>
		<p>
			The hosted service is not directed to anyone under 18. Do not create an account if you are
			under 18.
		</p>

		<h2>13. Changes and contact</h2>
		<p>
			We may update this policy when the service or legal requirements change. Material changes will
			be announced in the service or by email when appropriate, and the effective date will change.
			Questions and requests can be sent to
			<a href="mailto:openpost@rgo.pt">openpost@rgo.pt</a>.
		</p>
	</article>
</section>
