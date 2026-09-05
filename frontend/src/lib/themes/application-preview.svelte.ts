import { getContext, setContext } from 'svelte';
import type { WebResolvedTheme } from './contracts';

const applicationPreviewKey = Symbol('application-theme-preview');

class ApplicationThemePreview {
	theme = $state<WebResolvedTheme | null>(null);
}

export function provideApplicationThemePreview() {
	return setContext(applicationPreviewKey, new ApplicationThemePreview());
}

export function getApplicationThemePreview() {
	return getContext<ApplicationThemePreview | undefined>(applicationPreviewKey);
}
