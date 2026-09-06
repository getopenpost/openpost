<script lang="ts">
	import ArrowUpRight from '@lucide/svelte/icons/arrow-up-right';
	import Check from '@lucide/svelte/icons/check';
	import CalendarDays from '@lucide/svelte/icons/calendar-days';
	import Image from '@lucide/svelte/icons/image';
	import Sparkles from '@lucide/svelte/icons/sparkles';
	import PostizSocialLogo from './PostizSocialLogo.svelte';

	let destination = $state<'linkedin' | 'bluesky' | 'instagram'>('linkedin');
	const destinations = [
		{
			id: 'linkedin',
			name: 'LinkedIn',
			text: 'We built a quieter way to plan your day. Today, we’re opening early access to Fieldnotes. Here’s what we learned along the way.'
		},
		{
			id: 'bluesky',
			name: 'Bluesky',
			text: 'A small thing we’ve been working on: Fieldnotes. Less organizing your to-dos. More doing the things you care about. Early access is open.'
		},
		{
			id: 'instagram',
			name: 'Instagram',
			text: 'Room for your next good idea. Meet Fieldnotes, our new space for a calmer working day. Early access is open. Link in bio.'
		}
	] as const;
	const selected = $derived(destinations.find((item) => item.id === destination)!);
</script>

<div class="publication-story" aria-label="Illustrative publication workflow">
	<div class="idea-sheet">
		<div class="sheet-top">
			<span class="sheet-dot"></span> The idea <span class="sheet-tag">Draft</span>
		</div>
		<p class="idea-title">We made something.<br />Let’s tell people.</p>
		<p class="idea-note">Fieldnotes is ready for early access. A calmer space to plan your day.</p>
		<div class="attachment"><Image size={15} /> launch-artwork.png <Check size={14} /></div>
		<div class="idea-bottom"><Sparkles size={15} /> Your words. A little help.</div>
	</div>

	<div class="publication-sheet">
		<div class="sheet-top">
			<img src="/assets/brand/logo.svg" alt="" width="19" height="19" /><strong
				>One publication</strong
			><span class="sheet-tag">3 destinations</span>
		</div>
		<div class="destination-picker" role="group" aria-label="Preview a destination">
			{#each destinations as item (item.id)}
				<button
					type="button"
					aria-pressed={destination === item.id}
					onclick={() => (destination = item.id)}
					><PostizSocialLogo platform={item.id} />{item.name}</button
				>
			{/each}
		</div>
		<div class="post-content" aria-live="polite" aria-atomic="true">
			<div class="author">
				<span class="avatar">f.</span>
				<div><strong>Fieldnotes</strong><span>{selected.name} rendition</span></div>
				<ArrowUpRight size={17} />
			</div>
			{#key destination}<p class="post-copy">{selected.text}</p>{/key}
			<div class="launch-art" aria-label="Example launch artwork for Fieldnotes">
				<span>fieldnotes</span><strong>A little space.<br />A clearer mind.</strong>
				<div class="paper-sculpture" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></div>
				<small>Make room for what matters.</small>
			</div>
		</div>
		<div class="publication-bottom">
			<span><Check size={14} /> Changes saved</span><span
				><CalendarDays size={14} /> Schedule publication</span
			>
		</div>
	</div>

	<div class="schedule-sheet">
		<div class="sheet-top"><CalendarDays size={16} /> Your week, sorted.</div>
		<div class="week">
			<span>Mon<b>14</b></span><span>Tue<b>15</b></span><span class="today">Wed<b>16</b></span><span
				>Thu<b>17</b></span
			><span>Fri<b>18</b></span>
		</div>
		<div class="scheduled-post">
			<PostizSocialLogo platform="linkedin" />
			<div><strong>The launch story</strong><span>Wednesday · 9:00 am</span></div>
			<Check size={14} />
		</div>
		<div class="scheduled-post">
			<PostizSocialLogo platform="bluesky" />
			<div><strong>A quick introduction</strong><span>Wednesday · 12:30 pm</span></div>
			<Check size={14} />
		</div>
		<div class="scheduled-post">
			<PostizSocialLogo platform="instagram" />
			<div><strong>Meet Fieldnotes</strong><span>Thursday · 10:00 am</span></div>
			<Check size={14} />
		</div>
		<div class="schedule-note">
			Scheduled.<br /><strong>Back to building.</strong><ArrowUpRight size={27} />
		</div>
	</div>
</div>
<p class="example-note">Illustrative launch. Try switching destinations.</p>

<style>
	.publication-story {
		display: grid;
		grid-template-columns: 0.78fr 1.25fr 0.85fr;
		align-items: center;
		gap: 22px;
		text-align: left;
		padding: 28px 22px 14px;
	}
	.idea-sheet,
	.publication-sheet,
	.schedule-sheet {
		min-width: 0;
		border-radius: 14px;
	}
	.idea-sheet {
		padding: 24px;
		background: var(--marketing-lilac);
		color: var(--marketing-lilac-ink);
		transform: rotate(-4deg) translateY(3px);
	}
	.sheet-top {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 12px;
		font-weight: 550;
	}
	.sheet-dot {
		width: 8px;
		height: 8px;
		border-radius: 50%;
		background: currentColor;
	}
	.sheet-tag {
		margin-left: auto;
		font-size: 10px;
		opacity: 0.75;
	}
	.idea-title {
		margin-top: 36px;
		font-size: 25px;
		line-height: 1.14;
		font-weight: 550;
		letter-spacing: -0.035em;
	}
	.idea-note {
		margin-top: 20px;
		font-size: 13px;
		line-height: 1.65;
	}
	.attachment {
		display: flex;
		gap: 8px;
		align-items: center;
		margin-top: 26px;
		padding-block: 15px;
		border-block: 1px solid color-mix(in oklch, currentColor 20%, transparent);
		font-size: 11px;
	}
	.attachment :global(svg:last-child) {
		margin-left: auto;
	}
	.idea-bottom {
		display: flex;
		align-items: center;
		gap: 7px;
		margin-top: 20px;
		font-size: 11px;
	}
	.publication-sheet {
		z-index: 1;
		padding: 20px;
		background: var(--card);
		box-shadow: 0 16px 60px color-mix(in oklch, var(--foreground) 12%, transparent);
	}
	.destination-picker {
		display: flex;
		gap: 5px;
		margin-top: 20px;
		border-bottom: 1px solid var(--border);
		padding-bottom: 12px;
	}
	.destination-picker button {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		padding: 9px 8px;
		border-radius: 7px;
		flex: 1;
		font-size: 11px;
		cursor: pointer;
		transition: background 180ms ease;
	}
	.destination-picker button[aria-pressed='true'] {
		background: var(--muted);
	}
	.destination-picker button:hover {
		background: var(--accent);
	}
	.destination-picker button:focus-visible {
		outline: 2px solid var(--ring);
		outline-offset: 2px;
	}
	.destination-picker :global(img) {
		width: 18px;
		height: 18px;
	}
	.author {
		display: flex;
		gap: 9px;
		align-items: center;
		margin-top: 18px;
	}
	.avatar {
		display: grid;
		place-items: center;
		width: 31px;
		height: 31px;
		border-radius: 50%;
		background: var(--marketing-mint);
		color: var(--marketing-mint-ink);
		font-size: 21px;
		font-family: Georgia, serif;
	}
	.author strong {
		display: block;
		font-size: 12px;
	}
	.author div > span {
		display: block;
		color: var(--muted-foreground);
		font-size: 10px;
	}
	.author > :global(svg) {
		margin-left: auto;
		color: var(--muted-foreground);
	}
	.post-copy {
		min-height: 86px;
		padding-top: 15px;
		font-size: 12px;
		line-height: 1.7;
		animation: copy-change 300ms ease-out;
	}
	.launch-art {
		position: relative;
		isolation: isolate;
		overflow: hidden;
		aspect-ratio: 1.8;
		background: #d7edb6;
		color: #213b2c;
		padding: 18px;
		border-radius: 5px;
	}
	.launch-art > span {
		display: block;
		font-size: 11px;
		letter-spacing: -0.04em;
	}
	.launch-art > strong {
		display: block;
		margin-top: 22px;
		font-size: clamp(20px, 2.3vw, 32px);
		font-weight: 500;
		line-height: 1.02;
		letter-spacing: -0.035em;
	}
	.launch-art small {
		position: absolute;
		bottom: 15px;
		font-size: 8px;
	}
	.paper-sculpture {
		position: absolute;
		right: -20px;
		bottom: -25px;
		width: 50%;
		height: 95%;
		z-index: -1;
		transform: rotate(-24deg);
	}
	.paper-sculpture i {
		position: absolute;
		height: 100%;
		width: 55%;
		border-radius: 70% 70% 0 0;
		background: #396747;
		border: 1px solid #d7edb6;
		transform-origin: 50% 100%;
	}
	.paper-sculpture i:nth-child(2) {
		transform: rotate(18deg);
		background: #588254;
	}
	.paper-sculpture i:nth-child(3) {
		transform: rotate(36deg);
		background: #80a66c;
	}
	.paper-sculpture i:nth-child(4) {
		transform: rotate(54deg);
		background: #aacb86;
	}
	.paper-sculpture i:nth-child(5) {
		transform: rotate(72deg);
		background: #eaf4ce;
	}
	.publication-bottom {
		display: flex;
		justify-content: space-between;
		gap: 10px;
		margin-top: 17px;
		font-size: 9px;
		color: var(--muted-foreground);
	}
	.publication-bottom span {
		display: flex;
		align-items: center;
		gap: 5px;
	}
	.publication-bottom span:last-child {
		color: var(--foreground);
	}
	.schedule-sheet {
		padding: 22px;
		background: var(--marketing-blue);
		color: var(--marketing-blue-ink);
		transform: rotate(4deg) translateY(22px);
	}
	.week {
		display: flex;
		justify-content: space-between;
		margin-block: 24px;
		font-size: 9px;
		text-align: center;
	}
	.week span {
		padding: 7px;
	}
	.week b {
		display: block;
		margin-top: 8px;
		font-size: 14px;
		font-weight: 500;
	}
	.week .today {
		background: var(--marketing-blue-ink);
		color: var(--marketing-blue);
		border-radius: 7px;
	}
	.scheduled-post {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 10px;
		padding: 11px 0;
		border-bottom: 1px solid color-mix(in oklch, currentColor 16%, transparent);
	}
	.scheduled-post :global(img) {
		width: 23px;
		height: 23px;
	}
	.scheduled-post strong {
		display: block;
		font-size: 11px;
		font-weight: 550;
	}
	.scheduled-post span {
		display: block;
		font-size: 9px;
		margin-top: 4px;
	}
	.scheduled-post > :global(svg) {
		margin-left: auto;
	}
	.schedule-note {
		position: relative;
		margin-top: 25px;
		font-size: 22px;
		line-height: 1.2;
		letter-spacing: -0.03em;
	}
	.schedule-note strong {
		font-weight: 550;
	}
	.schedule-note :global(svg) {
		position: absolute;
		right: 0;
		bottom: 0;
	}
	.example-note {
		margin-top: 22px;
		color: var(--muted-foreground);
		text-align: center;
		font-size: 11px;
	}
	@keyframes copy-change {
		from {
			opacity: 0.4;
			transform: translateY(4px);
		}
		to {
			opacity: 1;
			transform: none;
		}
	}
	@media (min-width: 900px) and (prefers-reduced-motion: no-preference) {
		.idea-sheet {
			animation: idea-arrive 850ms cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		.schedule-sheet {
			animation: schedule-arrive 1000ms cubic-bezier(0.16, 1, 0.3, 1) both;
		}
		@keyframes idea-arrive {
			from {
				transform: rotate(0) translate(45px, 25px);
			}
		}
		@keyframes schedule-arrive {
			from {
				transform: rotate(0) translate(-45px, 45px);
			}
		}
	}
	@media (max-width: 1000px) {
		.publication-story {
			gap: 14px;
			grid-template-columns: 0.75fr 1.3fr;
			padding-inline: 10px;
		}
		.schedule-sheet {
			display: none;
		}
	}
	@media (max-width: 600px) {
		.publication-story {
			display: block;
			padding: 10px 0 0;
		}
		.idea-sheet {
			display: none;
		}
		.publication-sheet {
			padding: 16px;
		}
		.post-copy {
			min-height: 98px;
			font-size: 13px;
		}
		.launch-art {
			aspect-ratio: 1.7;
		}
		.launch-art > strong {
			font-size: clamp(22px, 6.8vw, 27px);
		}
		.paper-sculpture {
			right: -5px;
			bottom: -25px;
			width: 25%;
			height: 80%;
			transform: none;
		}
		.destination-picker button {
			min-height: 44px;
			padding-inline: 5px;
			font-size: 10px;
		}
		.sheet-tag {
			font-size: 9px;
		}
		.publication-bottom {
			font-size: 8px;
		}
		.example-note {
			font-size: 10px;
			margin-inline: 8px;
		}
	}
	@media (pointer: coarse) {
		.destination-picker button {
			min-height: 44px;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.post-copy {
			animation: none;
		}
		.destination-picker button {
			transition: none;
		}
	}
</style>
