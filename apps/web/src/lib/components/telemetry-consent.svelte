<script lang="ts">
	import { onMount, tick } from 'svelte';
	import ChevronDown from '@lucide/svelte/icons/chevron-down';
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
		cookielessDescription: string;
		optionsLabel: string;
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
		cookielessDescription,
		optionsLabel,
		offLabel,
		privacyLabel,
		privacyHref,
		closeLabel
	}: Props = $props();
	let preference = $state<TelemetryPreferenceStatus>('unavailable');
	let preferencesOpen = $state(false);
	let returnFocus: HTMLElement | null = null;
	let visible = $derived(preference === 'undecided' || preferencesOpen);

	async function openPreferences() {
		returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
		preferencesOpen = true;
		await tick();
		document.querySelector<HTMLElement>('[data-testid="telemetry-consent"] button')?.focus();
	}

	function closePreferences() {
		preferencesOpen = false;
		returnFocus?.focus();
		returnFocus = null;
	}

	function choose(next: 'persistent' | 'cookieless' | 'off') {
		setTelemetryPreference(next);
		closePreferences();
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
		class="fixed inset-x-3 bottom-3 z-[120] mx-auto max-h-[calc(100dvh-1.5rem)] max-w-md overflow-y-auto rounded-xl border bg-background p-4 text-foreground sm:inset-x-6 sm:bottom-6 sm:p-6"
		aria-labelledby="telemetry-consent-title"
		aria-live={preference === 'undecided' ? 'polite' : 'off'}
		data-testid="telemetry-consent"
	>
		<div class="flex items-start gap-4">
			<div class="min-w-0 flex-1">
				<h2 id="telemetry-consent-title" class="text-base font-semibold tracking-[-0.02em]">
					{title}
				</h2>
				<p class="mt-1 max-w-[68ch] text-sm leading-relaxed text-muted-foreground">{description}</p>
			</div>
			{#if preference !== 'undecided'}
				<Button
					variant="ghost"
					size="sm"
					class="-me-2 -mt-2 min-h-11 shrink-0"
					onclick={closePreferences}
				>
					{closeLabel}
				</Button>
			{/if}
		</div>
		<a
			href={privacyHref}
			class="inline-flex min-h-11 items-center rounded-md text-sm underline underline-offset-4 hover:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
		>
			{privacyLabel}
		</a>
		<div class="mt-2 grid grid-cols-2 gap-2">
			<Button
				variant="outline"
				class="min-h-11 justify-center"
				aria-pressed={preference === 'off'}
				onclick={() => choose('off')}
			>
				{offLabel}
			</Button>
			<Button
				class="min-h-11 justify-center"
				aria-pressed={preference === 'persistent'}
				onclick={() => choose('persistent')}
			>
				{allowLabel}
			</Button>
		</div>
		<details class="group mt-2 text-sm">
			<summary
				class="flex min-h-11 cursor-pointer items-center gap-2 rounded-md text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
			>
				{optionsLabel}
				<ChevronDown class="size-3.5 group-open:rotate-180" aria-hidden="true" />
			</summary>
			<p class="mb-3 leading-relaxed text-muted-foreground">{cookielessDescription}</p>
			<Button
				variant="outline"
				class="min-h-11 w-full whitespace-normal"
				aria-pressed={preference === 'cookieless'}
				onclick={() => choose('cookieless')}
			>
				{cookielessLabel}
			</Button>
		</details>
	</section>
{/if}
