<script lang="ts">
	import { onMount } from 'svelte';
	import { setMode, userPrefersMode } from 'mode-watcher';
	import {
		setTelemetryPreference,
		subscribeTelemetryPreference,
		type TelemetryPreferenceStatus
	} from '@openpost/telemetry';
	import * as Dialog from '$lib/components/ui/dialog';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Label } from '$lib/components/ui/label';
	import AppSelect from './app-select.svelte';
	import { getCurrentLocale, localeLabels, switchLocale } from '$lib/i18n';
	import { locales, type Locale } from '$lib/paraglide/runtime';
	import { soundPreferences } from '$lib/stores/sound-preferences.svelte';
	import { ui } from '$lib/stores/ui.svelte';
	import { m } from '$lib/paraglide/messages';

	let preference = $state<TelemetryPreferenceStatus>('unavailable');
	onMount(() => subscribeTelemetryPreference((next) => (preference = next)));
	const modes = $derived([
		{ value: 'light' as const, label: m.sidebar_appearance_light() },
		{ value: 'dark' as const, label: m.sidebar_appearance_dark() },
		{ value: 'system' as const, label: m.sidebar_appearance_system() }
	]);
</script>

<Dialog.Root bind:open={ui.isPreferencesOpen}>
	<Dialog.Content class="sm:max-w-md">
		<Dialog.Header><Dialog.Title>{m.personal_preferences()}</Dialog.Title></Dialog.Header>
		<div class="grid gap-5 py-2">
			<div class="grid gap-2">
				<span id="preferences-appearance" class="text-sm font-medium">{m.sidebar_appearance()}</span
				>
				<div
					role="group"
					aria-labelledby="preferences-appearance"
					class="flex gap-1 rounded-md bg-muted p-1"
				>
					{#each modes as mode (mode.value)}
						<Button
							class="min-h-11 flex-1"
							variant={userPrefersMode.current === mode.value ? 'secondary' : 'ghost'}
							aria-pressed={userPrefersMode.current === mode.value}
							onclick={() => setMode(mode.value)}>{mode.label}</Button
						>
					{/each}
				</div>
			</div>
			<div class="grid gap-2">
				<Label for="preferences-language">{m.language_label()}</Label>
				<AppSelect
					id="preferences-language"
					class="min-h-11 w-full"
					value={getCurrentLocale()}
					options={locales.map((value) => ({ value, label: localeLabels[value] }))}
					onValueChange={(value) => switchLocale(value as Locale)}
				/>
			</div>
			<div class="flex min-h-11 items-center justify-between gap-3">
				<Label class="flex min-h-11 flex-1 items-center" for="preferences-sounds"
					>{m.sidebar_interface_sounds()}</Label
				>
				<Checkbox
					id="preferences-sounds"
					data-cuelume-toggle={undefined}
					checked={soundPreferences.enabled}
					onCheckedChange={(checked) => soundPreferences.setEnabled(checked)}
				/>
			</div>
			<div class="grid gap-2 border-t pt-4">
				<span class="text-sm font-medium">{m.personal_usage_data()}</span>
				<p class="text-xs leading-relaxed text-muted-foreground">
					{preference === 'unavailable'
						? m.personal_usage_unavailable()
						: m.telemetry_consent_description()}
				</p>
				{#if preference !== 'unavailable'}
					<AppSelect
						id="preferences-telemetry"
						ariaLabel={m.personal_usage_data()}
						class="min-h-11 w-full"
						value={preference}
						placeholder={m.personal_usage_data()}
						options={[
							{ value: 'persistent', label: m.telemetry_consent_allow() },
							{ value: 'cookieless', label: m.telemetry_consent_cookieless() },
							{ value: 'off', label: m.telemetry_consent_off() }
						]}
						onValueChange={(value) => {
							if (value === 'persistent' || value === 'cookieless' || value === 'off')
								setTelemetryPreference(value);
						}}
					/>
				{/if}
			</div>
		</div>
	</Dialog.Content>
</Dialog.Root>
