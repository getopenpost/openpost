<script lang="ts">
	import { onMount } from 'svelte';
	import { dev } from '$app/environment';
	import { toast } from 'svelte-sonner';
	import { m } from '$lib/paraglide/messages';
	import { canInstallApp, installApp, listenForAppInstallation } from '$lib/pwa/install';
	import { showToast } from '$lib/toast';
	import { captureClientException } from '@openpost/telemetry';

	const invitationKey = 'openpost:install-invitation-seen';

	async function install() {
		try {
			await installApp();
		} catch {
			showToast(m.pwa_install_failed(), 'error');
		}
	}

	onMount(() => {
		const stopListening = listenForAppInstallation();
		let invitation: string | number | undefined;
		const unsubscribe = canInstallApp.subscribe((available) => {
			if (!available) {
				if (invitation !== undefined) toast.dismiss(invitation);
				return;
			}
			if (!window.matchMedia('(min-width: 768px) and (pointer: fine)').matches) return;
			try {
				if (localStorage.getItem(invitationKey)) return;
				localStorage.setItem(invitationKey, '1');
			} catch {
				// Without durable dismissal storage, keep installation in the user menu.
				return;
			}
			invitation = toast(m.pwa_install_title(), {
				id: 'pwa-install',
				description: m.pwa_install_description(),
				duration: 12_000,
				closeButton: true,
				action: { label: m.pwa_install_action(), onClick: install }
			});
		});
		if (!dev) {
			void import('virtual:pwa-register')
				.then(({ registerSW }) => {
					registerSW({
						immediate: true,
						onRegisterError: (error) => captureClientException(error, { operation: 'pwa_register' })
					});
				})
				.catch((error) => captureClientException(error, { operation: 'pwa_register' }));
		}
		return () => {
			unsubscribe();
			stopListening();
			if (invitation !== undefined) toast.dismiss(invitation);
		};
	});
</script>
