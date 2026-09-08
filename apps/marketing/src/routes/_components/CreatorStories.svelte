<script lang="ts">
	const examples = [
		{
			name: 'Jonas Keller',
			role: 'Furniture maker',
			text: 'Sunday night, forty minutes, the whole week is scheduled.'
		},
		{
			name: 'Amara Osei',
			role: 'Community lead',
			text: 'Replies used to rot in open tabs. Now they sit right next to the post and the account they came from, so I answer while I still remember the context.'
		},
		{
			name: 'Priya Nair',
			role: 'Agency owner',
			text: 'Three clients, eleven accounts, one calendar.'
		},
		{
			name: 'Tomás Aguilar',
			role: 'Solo founder',
			text: 'The activity view shows me which account failed and the actual error. I fix that one destination and retry it.'
		},
		{
			name: 'Lena Fischer',
			role: 'Social media manager',
			text: 'Captions, alt text, last month’s approved images. All in the library, ready to drop into the next post.'
		},
		{
			name: 'Owen Hartley',
			role: 'Writer',
			text: 'The splitter breaks a piece into a thread that actually fits, and I read every reply before anything goes live.'
		},
		{
			name: 'Sana Qureshi',
			role: 'Developer',
			text: 'Our release bot drafts posts through the API with its own scoped token. It never touches our social passwords, and I can revoke just the token.'
		}
	];
</script>

<section class="stories" aria-labelledby="stories-title">
	<div class="marketing-shell">
		<h2 id="stories-title">First reactions.</h2>
		<div class="quotes">
			<figure>
				<blockquote><p>"It looks fantastic, great job"</p></blockquote>
				<figcaption>
					<a
						class="focus-ring"
						href="https://www.reddit.com/r/foss/comments/1wa2075/comment/p8g2kn4/"
						target="_blank"
						rel="noreferrer">u/GreenSundance <span>on Reddit ↗</span></a
					>
				</figcaption>
			</figure>
			<figure>
				<blockquote><p>"Damn. It looks very good."</p></blockquote>
				<figcaption>
					<a
						class="focus-ring"
						href="https://www.reddit.com/r/foss/comments/1wa2075/comment/p8fnhym/"
						target="_blank"
						rel="noreferrer">u/super2061 <span>on Reddit ↗</span></a
					>
				</figcaption>
			</figure>
		</div>
		<details class="examples">
			<summary>Example workflows</summary>
			<p>Fictional examples of how people might use OpenPost.</p>
			<div class="example-grid">
				{#each examples as example (example.name)}
					<figure>
						<blockquote><p>{example.text}</p></blockquote>
						<figcaption>{example.name} · {example.role}</figcaption>
					</figure>
				{/each}
			</div>
		</details>
	</div>
</section>

<style>
	.stories {
		padding-block: 64px;
		border-block: 1px solid var(--border);
	}
	h2 {
		font-size: clamp(32px, 3.5vw, 48px);
		font-weight: 550;
		letter-spacing: -0.035em;
		line-height: 1.12;
	}
	.quotes {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 48px;
		margin-top: 36px;
	}
	.quotes blockquote {
		font-size: clamp(24px, 2.5vw, 34px);
		line-height: 1.4;
		letter-spacing: -0.025em;
	}
	figcaption {
		margin-top: 16px;
		font-size: 13px;
		line-height: 1.7;
	}
	figcaption a {
		display: inline-flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 8px;
		min-height: 44px;
		border-radius: 4px;
		text-decoration: underline;
		text-underline-offset: 4px;
	}
	figcaption span {
		color: var(--muted-foreground);
	}
	.examples {
		margin-top: 32px;
	}
	summary {
		cursor: pointer;
		width: fit-content;
		min-height: 44px;
		padding-block: 12px;
		font-size: 14px;
		color: var(--muted-foreground);
	}
	summary:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 4px;
		border-radius: 4px;
	}
	.examples > p {
		margin-block: 12px 24px;
		font-size: 14px;
		color: var(--muted-foreground);
	}
	.example-grid {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
		gap: 28px 48px;
	}
	.example-grid blockquote {
		font-size: 14px;
		line-height: 1.7;
	}
	.example-grid figcaption {
		color: var(--muted-foreground);
	}
	@media (max-width: 760px) {
		.stories {
			padding-block: 48px;
		}
		.quotes,
		.example-grid {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
	}
</style>
