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
	@media (max-width: 760px) {
		.stories {
			padding-block: 48px;
		}
		.quotes {
			grid-template-columns: minmax(0, 1fr);
			gap: 28px;
		}
	}
</style>
