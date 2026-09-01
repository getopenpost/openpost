<script lang="ts">
	import { onMount, tick } from 'svelte';
	import {
		setTelemetryPreference,
		subscribeTelemetryPreference,
		telemetryPreferencesEvent,
		type TelemetryPreferenceStatus
	} from '@openpost/telemetry';
	import { Button } from '$lib/components/ui/button';

	interface Props {
		title: string;
		description: string;
		allowLabel: string;
		cookielessLabel: string;
		offLabel: string;
		privacyLabel: string;
		privacyHref: string;
		closeLabel: string;
	}

	let {
		title,
		description,
		allowLabel,
		cookielessLabel,
		offLabel,
		privacyLabel,
		privacyHref,
		closeLabel
	}: Props = $props();
	let preference = $state<TelemetryPreferenceStatus>('unavailable');
	let preferencesOpen = $state(false);
	let visible = $derived(preference === 'undecided' || preferencesOpen);

	async function openPreferences() {
		preferencesOpen = true;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="telemetry-consent"] button')?.focus();
	}

	function choose(next: 'persistent' | 'cookieless' | 'off') {
		setTelemetryPreference(next);
		preferencesOpen = false;
	}

	onMount(() => {
		const unsubscribe = subscribeTelemetryPreference((next) => (preference = next));
		const open = () => void openPreferences();
		window.addEventListener(telemetryPreferencesEvent, open);
		return () => {
			unsubscribe();
			window.removeEventListener(telemetryPreferencesEvent, open);
		};
	});
</script>

{#if visible}
	<section
		class="fixed inset-x-3 bottom-3 z-[120] mx-auto max-w-2xl rounded-xl border bg-background p-4 text-foreground shadow-[0_1rem_3rem_color-mix(in_oklch,var(--foreground)_16%,transparent)] sm:inset-x-6 sm:bottom-6 sm:p-5"
		aria-labelledby="telemetry-consent-title"
		aria-live={preference === 'undecided' ? 'polite' : 'off'}
		data-testid="telemetry-consent"
	>
		<div class="flex items-start gap-4">
			<div class="min-w-0 flex-1">
				<h2 id="telemetry-consent-title" class="text-base font-semibold tracking-[-0.02em]">
					{title}
				</h2>
				<p class="mt-1 max-w-[68ch] text-sm leading-6 text-muted-foreground">{description}</p>
			</div>
			{#if preference !== 'undecided'}
				<Button
					variant="ghost"
					size="sm"
					class="-me-2 -mt-2 min-h-11 shrink-0"
					onclick={() => (preferencesOpen = false)}
				>
					{closeLabel}
				</Button>
			{/if}
		</div>
		<div class="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
			<Button
				variant="outline"
				class="min-h-11 justify-center sm:flex-1"
				aria-pressed={preference === 'persistent'}
				onclick={() => choose('persistent')}
			>
				{allowLabel}
			</Button>
			<Button
				variant="outline"
				class="min-h-11 justify-center sm:flex-1"
				aria-pressed={preference === 'cookieless'}
				onclick={() => choose('cookieless')}
			>
				{cookielessLabel}
			</Button>
			<Button
				variant="ghost"
				class="min-h-11 justify-center"
				aria-pressed={preference === 'off'}
				onclick={() => choose('off')}
			>
				{offLabel}
			</Button>
			<a
				href={privacyHref}
				class="inline-flex min-h-11 items-center justify-center rounded-md px-3 text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>
				{privacyLabel}
			</a>
		</div>
	</section>
{/if}
