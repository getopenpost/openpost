import type { ProviderInfo, SocialAccount } from '$lib/api/client';
import { m } from '$lib/paraglide/messages';
import {
	presentProviderReadiness,
	type ProviderReadinessPresentation
} from '$lib/provider-readiness';
import { formatAccountPlatformLabel, formatSocialAccountName, getPlatformName } from '$lib/utils';

export type ProviderEntry = ProviderInfo;

export function isConnectorProvider(provider: ProviderEntry): boolean {
	return provider.auth_mode === 'preconfigured' && Boolean(provider.installation_id);
}

export function accountDisplayName(account: SocialAccount): string {
	const displayName = formatSocialAccountName(account.account_username, account.platform);
	if (displayName) return displayName;
	if (account.instance_url) return account.instance_url.replace('https://', '');
	return account.account_id || account.platform;
}

export function accountSoftwareName(account: SocialAccount): string {
	const software = account.fediverse_software?.trim() ?? '';
	if (!software || software === account.platform) return '';
	return getPlatformName(software);
}

export function accountPlatformName(account: SocialAccount, entries: ProviderEntry[]): string {
	const softwareName = accountSoftwareName(account);
	if (softwareName) return softwareName;
	const provider = entries.find(
		(entry) =>
			(entry.installation_id && entry.installation_id === account.provider_installation_id) ||
			(!entry.installation_id && entry.platform === account.platform)
	);
	return provider ? providerTitle(provider) : getPlatformName(account.platform);
}

export function accountContextLabel(account: SocialAccount, entries: ProviderEntry[]): string {
	return formatAccountPlatformLabel(
		accountDisplayName(account),
		accountPlatformName(account, entries)
	);
}

export function accountSlug(account: SocialAccount): string {
	return account.slug || account.account_username || account.account_id || account.platform;
}

export const INSTANCE_PLATFORMS = new Set(['mastodon', 'pixelfed', 'peertube', 'lemmy', 'piefed']);

export function accountServer(account: SocialAccount): string {
	if (!INSTANCE_PLATFORMS.has(account.platform) || !account.instance_url) return '';
	try {
		return new URL(account.instance_url).host;
	} catch {
		return account.instance_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
	}
}

export function accountKindLabel(account: SocialAccount): string {
	const label = account.account_kind?.replaceAll('_', ' ').trim() ?? '';
	return label ? label[0].toUpperCase() + label.slice(1) : '';
}

export function providerTitle(provider: ProviderEntry): string {
	return provider.display_name || getPlatformName(provider.platform);
}

export function providerDescription(provider: ProviderEntry): string {
	if (provider.platform === 'mastodon') {
		return m.accounts_provider_custom_mastodon();
	}
	if (provider.platform === 'pixelfed') {
		return m.accounts_provider_custom_pixelfed();
	}
	switch (provider.platform) {
		case 'x':
			return m.accounts_provider_x();
		case 'threads':
			return m.accounts_provider_threads();
		case 'bluesky':
			return m.accounts_provider_bluesky();
		case 'discord':
			return m.accounts_provider_discord();
		case 'linkedin':
			return m.accounts_provider_linkedin();
		case 'instagram':
			return m.accounts_provider_instagram();
		case 'facebook':
			return m.accounts_provider_facebook();
		case 'youtube':
			return m.accounts_provider_youtube();
		case 'pixelfed':
			return m.accounts_provider_pixelfed();
		case 'peertube':
			return m.accounts_provider_peertube();
		case 'lemmy':
			return m.accounts_provider_lemmy();
		case 'piefed':
			return m.accounts_provider_piefed();
		case 'tiktok':
			return m.accounts_provider_tiktok();
		default:
			return provider.description || m.accounts_provider_default();
	}
}

export function providerReadiness(provider: ProviderEntry): ProviderReadinessPresentation {
	return presentProviderReadiness(provider.readiness, 'connect');
}

export function providerStatusLabel(provider: ProviderEntry): string {
	if (isConnectorProvider(provider) && providerCanConnect(provider)) {
		return m.accounts_custom_connector();
	}
	if (provider.status === 'planned') return m.accounts_provider_planned();
	switch (providerReadiness(provider).state) {
		case 'unsupported':
			return m.provider_readiness_label_unsupported();
		case 'disabled':
			return m.provider_readiness_label_disabled();
		case 'needs_configuration':
			return m.provider_readiness_label_needs_configuration();
		case 'reconnect_required':
			return m.provider_readiness_label_reconnect_required();
		case 'degraded':
			return m.provider_readiness_label_degraded();
		case 'approval_required':
			return m.provider_readiness_label_approval_required();
		case 'trial_only':
			return m.provider_readiness_label_trial_only();
		case 'policy_restricted':
			return m.provider_readiness_label_policy_restricted();
		case 'certification_required':
			return m.provider_readiness_label_certification_required();
		case 'expired_proof':
			return m.provider_readiness_label_expired_proof();
		case 'healthy':
		default:
			return '';
	}
}

export function providerStatusClass(provider: ProviderEntry): string {
	if (isConnectorProvider(provider)) {
		return 'border-border bg-muted text-muted-foreground';
	}
	if (provider.status === 'planned') {
		return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300';
	}
	switch (providerReadiness(provider).tone) {
		case 'warning':
			return 'border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-300';
		case 'error':
			return 'border-destructive/20 bg-destructive/10 text-destructive';
		case 'neutral':
		default:
			return 'border-blue-500/20 bg-blue-500/10 text-blue-700 dark:text-blue-300';
	}
}

export function readinessStateMessage(state: string, platform: string): string {
	switch (state) {
		case 'unsupported':
			return m.provider_readiness_unsupported({ platform });
		case 'disabled':
			return m.provider_readiness_disabled({ platform });
		case 'needs_configuration':
			return m.provider_readiness_needs_configuration({ platform });
		case 'reconnect_required':
			return m.provider_readiness_reconnect_required({ platform });
		case 'degraded':
			return m.provider_readiness_degraded({ platform });
		case 'approval_required':
			return m.provider_readiness_approval_required({ platform });
		case 'trial_only':
			return m.provider_readiness_trial_only({ platform });
		case 'policy_restricted':
			return m.provider_readiness_policy_restricted({ platform });
		case 'certification_required':
			return m.provider_readiness_certification_required({ platform });
		case 'expired_proof':
			return m.provider_readiness_expired_proof({ platform });
		case 'healthy':
		default:
			return '';
	}
}

export function providerReadinessMessage(provider: ProviderEntry): string {
	return readinessStateMessage(providerReadiness(provider).state, providerTitle(provider));
}

export function providerCanConnect(provider: ProviderEntry): boolean {
	return provider.status !== 'planned' && providerReadiness(provider).canProceed;
}

export function providerNeedsAdminSetup(provider: ProviderEntry): boolean {
	if (provider.status === 'planned') return true;
	const action = providerReadiness(provider).action;
	return action === 'configure' || action === 'contact_admin';
}
