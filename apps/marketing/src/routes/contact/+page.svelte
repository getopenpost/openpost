<script lang="ts">
	import { ArrowUpRight, Mail, MessageCircle } from '@lucide/svelte';
	import HeroAccent from '../_components/HeroAccent.svelte';
	import { supportMailUrl, supportEmail, discordCommunityUrl, docsUrl } from '../_marketing';
</script>

<section class="contact marketing-shell">
	<header>
		<h1>Let’s <HeroAccent>talk.</HeroAccent></h1>
		<p>A question, an idea, or something not working?<br />We’d like to hear from you.</p>
	</header>
	<div class="contact-options">
		<section class="email">
			<Mail size={28} />
			<h2>Ask us directly.</h2>
			<p>
				For product questions, help with your account, or billing. Tell us what you need and include
				the email you use for OpenPost.
			</p>
			<a href={supportMailUrl} class="focus-ring">{supportEmail}<ArrowUpRight size={20} /></a><small
				>Please leave out passwords and payment-card details.</small
			>
		</section>
		<section class="community">
			<MessageCircle size={28} />
			<h2>Join the conversation.</h2>
			<p>Share what you’re making, swap ideas, and ask the community about using OpenPost.</p>
			<a href={discordCommunityUrl} class="focus-ring"
				>Join us on Discord <ArrowUpRight size={20} /></a
			>
		</section>
	</div>
	<div class="contact-more">
		<div>
			<h2>Looking for a walkthrough?</h2>
			<p>
				The help centre covers your first post, editing images and videos, and planning your
				schedule.
			</p>
			<a href={docsUrl} class="focus-ring">Open the help centre <ArrowUpRight size={16} /></a>
		</div>
		<div>
			<h2>Found a security issue?</h2>
			<p>Send a private report with the affected page and steps to reproduce it.</p>
			<a href="mailto:openpost+security@rgo.pt" class="focus-ring"
				>openpost+security@rgo.pt <ArrowUpRight size={16} /></a
			>
		</div>
	</div>
</section>

<style>
	.contact {
		padding-block: 72px;
	}
	header {
		text-align: center;
	}
	h1 {
		font-size: clamp(48px, 6vw, 80px);
		line-height: 1.1;
		font-weight: 550;
		letter-spacing: -0.04em;
	}
	header p {
		font-size: 18px;
		line-height: 1.7;
		color: var(--muted-foreground);
		margin-top: 28px;
	}
	.contact-options {
		display: grid;
		gap: 24px;
		margin-top: 64px;
	}
	.contact-options section {
		border-radius: 16px;
		padding: clamp(24px, 4vw, 48px);
	}
	.email {
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
	}
	.community {
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
	}
	h2 {
		font-size: 32px;
		line-height: 1.2;
		font-weight: 550;
		letter-spacing: -0.025em;
		margin-top: 28px;
	}
	p {
		margin-top: 20px;
		line-height: 1.75;
		max-width: 58ch;
	}
	a {
		display: inline-flex;
		align-items: center;
		gap: 10px;
		min-height: 44px;
		margin-top: 20px;
		text-decoration: underline;
		text-underline-offset: 5px;
		border-radius: 4px;
		overflow-wrap: anywhere;
	}
	a :global(svg) {
		flex-shrink: 0;
	}
	small {
		display: block;
		margin-top: 12px;
		line-height: 1.6;
	}
	.contact-more {
		display: grid;
		gap: 40px;
		margin-top: 64px;
	}
	.contact-more h2 {
		font-size: 24px;
		margin-top: 0;
	}
	.contact-more p {
		color: var(--muted-foreground);
	}
	.contact-more a {
		font-size: 14px;
	}
	@media (min-width: 800px) {
		.contact-options,
		.contact-more {
			grid-template-columns: 1fr 1fr;
		}
		.contact-more {
			gap: 80px;
		}
	}
</style>
