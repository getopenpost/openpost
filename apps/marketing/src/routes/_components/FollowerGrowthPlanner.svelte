<script lang="ts">
	import TrendingUp from '@lucide/svelte/icons/trending-up';
	import { Button } from '$lib/components/ui/button';

	const scenarios = [
		{ id: 'steady', label: 'Steady', rate: 0.03 },
		{ id: 'consistent', label: 'Consistent', rate: 0.06 },
		{ id: 'momentum', label: 'Momentum', rate: 0.1 }
	] as const;
	const months = [
		'Now',
		'Sep',
		'Oct',
		'Nov',
		'Dec',
		'Jan',
		'Feb',
		'Mar',
		'Apr',
		'May',
		'Jun',
		'Jul',
		'Aug'
	];
	const startFollowers = 1200;
	let activeScenario = $state<(typeof scenarios)[number]['id']>('consistent');
	const scenario = $derived(scenarios.find((item) => item.id === activeScenario) ?? scenarios[1]);
	const values = $derived(
		months.map((_, index) => Math.round(startFollowers * Math.pow(1 + scenario.rate, index)))
	);
	const maxValue = $derived(Math.max(...values) * 1.12);
	const points = $derived(
		values
			.map((value, index) => {
				const x = 70 + (index / (values.length - 1)) * 860;
				const y = 330 - (value / maxValue) * 260;
				return `${x},${y}`;
			})
			.join(' ')
	);
	const areaPoints = $derived(`70,330 ${points} 930,330`);
	const endingValue = $derived(values.at(-1) ?? startFollowers);
</script>

<section class="growth-section" aria-labelledby="growth-title">
	<div class="marketing-shell growth-shell">
		<div class="growth-copy">
			<span class="growth-icon"><TrendingUp aria-hidden="true" /></span>
			<p class="section-label">Growth planner</p>
			<h2 id="growth-title">See what consistency can build.</h2>
			<p>
				Choose a monthly growth scenario and see how a steady publishing habit compounds over a
				year.
			</p>
			<div class="scenario-picker" aria-label="Monthly growth scenario">
				{#each scenarios as item (item.id)}
					<Button
						variant={activeScenario === item.id ? 'default' : 'outline'}
						size="sm"
						aria-pressed={activeScenario === item.id}
						onclick={() => (activeScenario = item.id)}
					>
						{item.label} <span>{Math.round(item.rate * 100)}%</span>
					</Button>
				{/each}
			</div>
			<p class="model-note">
				Planning model only. Your results depend on your audience and content.
			</p>
		</div>

		<div class="chart-card">
			<div class="chart-topline">
				<div>
					<span>Follower projection</span>
					<strong>{endingValue.toLocaleString()}</strong>
				</div>
				<span class="growth-pill">+{endingValue - startFollowers} in 12 months</span>
			</div>

			<div class="chart-scroll">
				<svg viewBox="0 0 1000 400" role="img" aria-labelledby="chart-title chart-description">
					<title id="chart-title">Follower growth planning chart</title>
					<desc id="chart-description">
						A planning curve from {startFollowers} to {endingValue} followers over twelve months at a
						{Math.round(scenario.rate * 100)} percent monthly growth rate.
					</desc>
					<defs>
						<linearGradient id="growth-area" x1="0" y1="0" x2="0" y2="1">
							<stop offset="0" stop-color="var(--primary)" stop-opacity="0.34" />
							<stop offset="1" stop-color="var(--primary)" stop-opacity="0" />
						</linearGradient>
					</defs>

					{#each [90, 170, 250, 330] as y (y)}
						<line class="grid-line" x1="70" {y} x2="930" y2={y} />
					{/each}
					<polygon class="growth-area" points={areaPoints} />
					<polyline class="growth-line" {points} />
					{#each values as value, index (`${scenario.id}-${index}`)}
						{@const x = 70 + (index / (values.length - 1)) * 860}
						{@const y = 330 - (value / maxValue) * 260}
						<circle class="growth-point" cx={x} cy={y} r={index === values.length - 1 ? 7 : 4} />
					{/each}
					{#each months as month, index (month)}
						{#if index % 2 === 0}
							<text class="axis-label" x={70 + (index / (months.length - 1)) * 860} y="372">
								{month}
							</text>
						{/if}
					{/each}
				</svg>
			</div>
		</div>
	</div>
</section>

<style>
	.growth-section {
		padding-block: clamp(5rem, 9vw, 8.5rem);
		border-block: 1px solid var(--border);
		background:
			radial-gradient(
				circle at 84% 50%,
				color-mix(in oklch, var(--primary) 10%, transparent),
				transparent 30rem
			),
			color-mix(in oklch, var(--muted) 24%, var(--background));
	}

	.growth-shell {
		display: grid;
		gap: clamp(2.5rem, 6vw, 5rem);
		align-items: center;
	}

	.growth-copy {
		max-width: 34rem;
	}

	.growth-icon {
		display: grid;
		width: 3rem;
		height: 3rem;
		margin-bottom: 1.5rem;
		place-items: center;
		border: 1px solid color-mix(in oklch, var(--primary) 52%, var(--border));
		border-radius: 1rem;
		background: color-mix(in oklch, var(--primary) 12%, var(--card));
		color: var(--primary);
		box-shadow: 0 4px 0 color-mix(in oklch, var(--primary) 45%, var(--border));
	}

	.growth-icon :global(svg) {
		width: 1.25rem;
		height: 1.25rem;
	}

	.growth-copy h2 {
		margin-top: 1rem;
		font-size: clamp(2.5rem, 5vw, 4.4rem);
		font-weight: 720;
		line-height: 0.98;
		letter-spacing: -0.045em;
		text-wrap: balance;
	}

	.growth-copy > p:not(.section-label, .model-note) {
		margin-top: 1.5rem;
		color: var(--muted-foreground);
		font-size: 1rem;
		line-height: 1.75;
	}

	.scenario-picker {
		display: flex;
		flex-wrap: wrap;
		gap: 0.65rem;
		margin-top: 2rem;
	}

	.scenario-picker span {
		margin-left: 0.15rem;
		opacity: 0.66;
	}

	.model-note {
		margin-top: 1rem;
		color: var(--muted-foreground);
		font-size: 0.72rem;
		line-height: 1.5;
	}

	.chart-card {
		min-width: 0;
		overflow: hidden;
		border: 1px solid var(--border);
		border-radius: 1.4rem;
		background: var(--card);
		box-shadow:
			0 7px 0 color-mix(in oklch, var(--primary) 48%, var(--border)),
			0 2rem 5rem -2.5rem color-mix(in oklch, var(--foreground) 36%, transparent);
	}

	.chart-topline {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 1.2rem 1.35rem;
		border-bottom: 1px solid var(--border);
	}

	.chart-topline > div {
		display: flex;
		align-items: baseline;
		gap: 0.75rem;
	}

	.chart-topline span {
		color: var(--muted-foreground);
		font-size: 0.78rem;
	}

	.chart-topline strong {
		font-size: 1.45rem;
		font-variant-numeric: tabular-nums;
	}

	.growth-pill {
		padding: 0.42rem 0.65rem;
		border-radius: 999px;
		background: color-mix(in oklch, var(--primary) 12%, var(--background));
		color: var(--primary) !important;
		font-weight: 650;
	}

	.chart-scroll {
		overflow-x: auto;
		padding: 0.5rem 0.75rem 0.25rem;
	}

	svg {
		display: block;
		width: 100%;
		min-width: 34rem;
	}

	.grid-line {
		stroke: var(--border);
		stroke-width: 1;
		stroke-dasharray: 4 7;
	}

	.growth-area {
		fill: url('#growth-area');
	}

	.growth-line {
		fill: none;
		stroke: var(--primary);
		stroke-width: 6;
		stroke-linecap: round;
		stroke-linejoin: round;
		filter: drop-shadow(0 5px 7px color-mix(in oklch, var(--primary) 26%, transparent));
		stroke-dasharray: 1400;
		animation: draw-growth 700ms cubic-bezier(0.16, 1, 0.3, 1) both;
	}

	.growth-point {
		fill: var(--card);
		stroke: var(--primary);
		stroke-width: 4;
	}

	.axis-label {
		fill: var(--muted-foreground);
		font-size: 20px;
		text-anchor: middle;
	}

	@keyframes draw-growth {
		from {
			stroke-dashoffset: 1400;
		}
		to {
			stroke-dashoffset: 0;
		}
	}

	@media (min-width: 64rem) {
		.growth-shell {
			grid-template-columns: 0.72fr 1.28fr;
		}
	}

	@media (max-width: 39.99rem) {
		.chart-topline {
			align-items: flex-start;
			flex-direction: column;
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.growth-line {
			animation: none;
			stroke-dasharray: none;
		}
	}
</style>
