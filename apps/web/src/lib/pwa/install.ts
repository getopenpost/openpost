import { writable } from 'svelte/store';

interface InstallPromptEvent extends Event {
	prompt(): Promise<void>;
	userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const installAvailable = writable(false);
export const canInstallApp = { subscribe: installAvailable.subscribe };
let pendingPrompt: InstallPromptEvent | undefined;

export function listenForAppInstallation() {
	const standalone = window.matchMedia('(display-mode: standalone)');
	let installed = standalone.matches;
	const onPrompt = (event: Event) => {
		if (!('prompt' in event) || !('userChoice' in event)) return;
		event.preventDefault();
		if (installed) return;
		// SAFETY: the browser install event exposes the prompt and userChoice members checked above.
		pendingPrompt = event as InstallPromptEvent;
		installAvailable.set(true);
	};
	const onInstalled = () => {
		installed = true;
		pendingPrompt = undefined;
		installAvailable.set(false);
	};
	const onDisplayChange = () => {
		if (standalone.matches) onInstalled();
	};
	window.addEventListener('beforeinstallprompt', onPrompt);
	window.addEventListener('appinstalled', onInstalled);
	standalone.addEventListener('change', onDisplayChange);
	return () => {
		window.removeEventListener('beforeinstallprompt', onPrompt);
		window.removeEventListener('appinstalled', onInstalled);
		standalone.removeEventListener('change', onDisplayChange);
		onInstalled();
	};
}

export async function installApp() {
	const prompt = pendingPrompt;
	if (!prompt) return;
	pendingPrompt = undefined;
	installAvailable.set(false);
	await prompt.prompt();
	await prompt.userChoice;
}
