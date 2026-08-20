<script lang="ts">
	import { goto } from '$app/navigation';
	import { resolveAppPath } from '$lib/app-path';
	import { auth } from '$lib/stores/auth';
	import { client } from '$lib/api/client';
	import { createPasskeyCredential } from '$lib/auth/webauthn';
	import { acquireReauthGrant, startOIDCIdentityLink } from '$lib/auth/reauth';
	import { copyAuthenticatorSetupKey, isAuthenticatorCodeReady } from '$lib/authenticator-setup';
	import { getLocaleTag } from '$lib/i18n';
	import { getOptionalUnsavedChanges } from '$lib/unsaved-changes.svelte';
	import { showToast } from '$lib/toast';
	import { Button } from '$lib/components/ui/button';
	import { Checkbox } from '$lib/components/ui/checkbox';
	import { Input } from '$lib/components/ui/input';
	import { Label } from '$lib/components/ui/label';
	import AccountDataCard from '$lib/components/account-data-card.svelte';
	import DestructiveConfirmDialog from '$lib/components/destructive-confirm-dialog.svelte';
	import type { DestructiveActionOutcome } from '$lib/destructive-action-outcome';
	import InlineNotice from '$lib/components/inline-notice.svelte';
	import PageLoading from '$lib/components/page-loading.svelte';
	import {
		activeReauthProviderID,
		type AuthSessionSummary,
		type EmailChangeSummary,
		type OIDCIdentitySummary,
		type OIDCProviderSummary,
		type SecurityStatus
	} from '../../../routes/settings/settings-data';
	import { m } from '$lib/paraglide/messages';
	import LoaderIcon from '@lucide/svelte/icons/loader-2';
	import SmartphoneIcon from '@lucide/svelte/icons/smartphone';
	import KeyRoundIcon from '@lucide/svelte/icons/key-round';
	import CopyIcon from '@lucide/svelte/icons/copy';
	import DownloadIcon from '@lucide/svelte/icons/download';
	import MonitorIcon from '@lucide/svelte/icons/monitor';
	import LogOutIcon from '@lucide/svelte/icons/log-out';

	type RecoveryCodeFlow = 'setup' | 'regenerate';
	type SecurityDestructiveAction =
		| { kind: 'session'; session: AuthSessionSummary }
		| { kind: 'identity'; identity: OIDCIdentitySummary }
		| { kind: 'totp' };

	const authState = $derived($auth);
	const profileEmail = $derived(authState.user?.email ?? '');
	const unsavedChanges = getOptionalUnsavedChanges();
	let loadingSecurity = $state(true);
	let securityBusy = $state(false);
	let securityError = $state('');
	let authSessions = $state.raw<AuthSessionSummary[]>([]);
	let authSessionsLoading = $state(true);
	let authSessionsError = $state('');
	let authSessionBusyID = $state('');
	let totpCurrentPassword = $state('');
	let passkeyCurrentPassword = $state('');
	let totpSetupChallengeId = $state('');
	let totpManualEntryKey = $state('');
	let totpQRCodeDataURL = $state('');
	let totpCode = $state('');
	let totpSetupError = $state('');
	let totpSetupKeyCopyState = $state<'idle' | 'copied' | 'failed'>('idle');
	let recoveryCodeFlow = $state<RecoveryCodeFlow | null>(null);
	let recoveryCodeChallengeId = $state('');
	let recoveryCodes = $state.raw<string[]>([]);
	let recoveryCodesSaved = $state(false);
	let recoveryCodesRemaining = $state<number | null>(null);
	let newPasskeyName = $state('');
	let securityStatus = $state<SecurityStatus | null>(null);
	let linkedIdentities = $state.raw<OIDCIdentitySummary[]>([]);
	let linkableProviders = $state.raw<OIDCProviderSummary[]>([]);
	let identityPassword = $state('');
	let identityBusy = $state('');
	let emailChangePending = $state.raw<EmailChangeSummary | null>(null);
	let emailChangeNewEmail = $state('');
	let emailChangeCode = $state('');
	let emailChangePassword = $state('');
	let emailChangeBusy = $state(false);
	let emailChangeError = $state('');
	let loadedSecurityUserID = '';
	let destructiveDialogOpen = $state(false);
	let destructiveAction = $state.raw<SecurityDestructiveAction | null>(null);

	const passkeyCount = $derived((securityStatus?.passkeys ?? []).length);
	const passwordReauthUsable = $derived(securityStatus?.user.password_usable ?? false);
	const reauthProviderID = $derived(activeReauthProviderID(linkedIdentities));
	const unlinkedProviders = $derived(
		linkableProviders.filter(
			(provider) => !linkedIdentities.some((identity) => identity.provider_id === provider.id)
		)
	);
	const hasStepUpMethod = $derived(
		passwordReauthUsable || passkeyCount > 0 || Boolean(reauthProviderID)
	);
	const securityDraftDirty = $derived(Boolean(identityPassword || otherSecurityDraftDirty()));
	const securityDraftMessage = $derived(
		recoveryCodes.length > 0
			? m.settings_recovery_codes_unsaved_changes()
			: m.settings_unsaved_changes()
	);

	function notify(message: string, tone: 'success' | 'error' = 'success') {
		showToast(message, tone);
	}

	function requestSecurityAction(action: SecurityDestructiveAction) {
		destructiveAction = action;
		destructiveDialogOpen = true;
	}

	function destructiveActionTitle() {
		if (destructiveAction?.kind === 'session') {
			return destructiveAction.session.current
				? m.settings_sign_out_session_title()
				: m.settings_revoke_session_title();
		}
		if (destructiveAction?.kind === 'identity') return m.settings_unlink_identity_title();
		return m.settings_disable_authenticator_title();
	}

	function destructiveActionDescription() {
		if (destructiveAction?.kind === 'session') {
			return destructiveAction.session.current
				? m.settings_sign_out_session_body()
				: m.settings_revoke_session_body();
		}
		if (destructiveAction?.kind === 'identity') return m.settings_unlink_identity_body();
		return m.settings_disable_authenticator_body();
	}

	function destructiveActionConfirmLabel() {
		if (destructiveAction?.kind === 'session' && destructiveAction.session.current) {
			return m.settings_sign_out();
		}
		if (destructiveAction?.kind === 'identity') return m.settings_unlink_identity();
		if (destructiveAction?.kind === 'totp') return m.settings_disable_authenticator();
		return m.settings_revoke();
	}

	async function confirmDestructiveAction(): Promise<DestructiveActionOutcome> {
		const action = destructiveAction;
		if (!action) return { ok: false };
		if (action.kind === 'session') {
			const ok = await revokeAuthSession(action.session);
			const message = ok ? undefined : authSessionsError;
			if (!ok) authSessionsError = '';
			return { ok, message };
		}
		if (action.kind === 'identity') {
			const ok = await unlinkIdentity(action.identity.id);
			const message = ok ? undefined : securityError;
			if (!ok) securityError = '';
			return { ok, message };
		}
		const ok = await disableTOTP();
		const message = ok ? undefined : securityError;
		if (!ok) securityError = '';
		return { ok, message };
	}

	function securityMethodLabel(method: string) {
		if (method === 'password') return m.settings_security_method_password();
		if (method === 'totp') return m.settings_security_method_authenticator();
		if (method === 'passkey' || method === 'passkeys') {
			return m.settings_security_method_passkey();
		}
		return method;
	}

	function recoveryCodesRemainingLabel(count: number) {
		return count === 1
			? m.settings_recovery_codes_remaining_one()
			: m.settings_recovery_codes_remaining({ count });
	}

	async function loadSecurityStatus() {
		loadingSecurity = true;
		securityError = '';
		try {
			const [securityResult, identityResult, providerResult, emailChangeResult] = await Promise.all(
				[
					client.GET('/auth/security'),
					client.GET('/auth/oidc/identities'),
					client.GET('/auth/oidc/link-providers'),
					client.GET('/auth/email-change')
				]
			);
			if (securityResult.error || !securityResult.data) {
				throw new Error(securityResult.error?.detail || m.settings_action_failed());
			}
			if (identityResult.error) {
				throw new Error(identityResult.error.detail || m.settings_action_failed());
			}
			if (providerResult.error) {
				throw new Error(providerResult.error.detail || m.settings_action_failed());
			}
			if (emailChangeResult.error) {
				throw new Error(emailChangeResult.error.detail || m.settings_action_failed());
			}
			securityStatus = securityResult.data;
			linkedIdentities = identityResult.data ?? [];
			linkableProviders = providerResult.data ?? [];
			emailChangePending = emailChangeResult.data?.pending ?? null;
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			loadingSecurity = false;
		}
	}

	async function beginEmailChange() {
		if (!emailChangeNewEmail.trim()) return;
		emailChangeBusy = true;
		emailChangeError = '';
		try {
			const grant = await acquireReauthGrant('identity.email.change', {
				password: passwordReauthUsable ? emailChangePassword : '',
				providerID: reauthProviderID,
				hasPasskey: passkeyCount > 0
			});
			if (grant === null) return;
			const result = await client.POST('/auth/email-change', {
				body: { new_email: emailChangeNewEmail.trim(), reauth_grant: grant }
			});
			if (result.error || !result.data) {
				if (result.response.status === 409) throw new Error(m.settings_email_change_conflict());
				if (result.response.status === 503) {
					throw new Error(m.settings_email_change_delivery_failed());
				}
				throw new Error(result.error?.detail || m.settings_email_change_failed());
			}
			emailChangePending = result.data;
			emailChangeNewEmail = '';
			emailChangePassword = '';
			notify(m.settings_email_change_sent());
		} catch (error) {
			emailChangeError = error instanceof Error ? error.message : m.settings_email_change_failed();
		} finally {
			emailChangeBusy = false;
		}
	}

	async function resendEmailChange() {
		if (!emailChangePending) return;
		emailChangeBusy = true;
		emailChangeError = '';
		try {
			const { data, error } = await client.POST('/auth/email-change/{id}/resend', {
				params: { path: { id: emailChangePending.id } }
			});
			if (error || !data) throw new Error(error?.detail || m.settings_email_change_failed());
			emailChangePending = data;
			notify(m.settings_email_change_sent());
		} catch (error) {
			emailChangeError = error instanceof Error ? error.message : m.settings_email_change_failed();
		} finally {
			emailChangeBusy = false;
		}
	}

	async function confirmEmailChange() {
		if (!emailChangePending || emailChangeCode.length !== 6) return;
		emailChangeBusy = true;
		emailChangeError = '';
		try {
			const { data, error } = await client.POST('/auth/email-change/{id}/confirm', {
				params: { path: { id: emailChangePending.id } },
				body: { code: emailChangeCode }
			});
			if (error || !data) throw new Error(error?.detail || m.settings_email_change_failed());
			if (authState.user) auth.setUser({ ...authState.user, email: data.email });
			emailChangePending = null;
			emailChangeCode = '';
			securityStatus = securityStatus
				? { ...securityStatus, user: { ...securityStatus.user, email: data.email } }
				: securityStatus;
			notify(
				data.revoked_sessions === 1
					? m.settings_email_change_completed_one()
					: m.settings_email_change_completed({ count: data.revoked_sessions })
			);
			await loadAuthSessions();
		} catch (error) {
			emailChangeError = error instanceof Error ? error.message : m.settings_email_change_failed();
		} finally {
			emailChangeBusy = false;
		}
	}

	async function cancelEmailChange() {
		if (!emailChangePending) return;
		emailChangeBusy = true;
		emailChangeError = '';
		try {
			const { error } = await client.DELETE('/auth/email-change/{id}', {
				params: { path: { id: emailChangePending.id } }
			});
			if (error) throw new Error(error.detail || m.settings_email_change_failed());
			emailChangePending = null;
			emailChangeCode = '';
			notify(m.settings_email_change_canceled());
		} catch (error) {
			emailChangeError = error instanceof Error ? error.message : m.settings_email_change_failed();
		} finally {
			emailChangeBusy = false;
		}
	}

	async function linkIdentity(providerID: string) {
		identityBusy = `link-${providerID}`;
		securityError = '';
		try {
			const grant = await acquireReauthGrant('identity.link', {
				password: passwordReauthUsable ? identityPassword : '',
				providerID: reauthProviderID,
				hasPasskey: passkeyCount > 0
			});
			if (grant === null) return;
			await startOIDCIdentityLink(providerID, grant);
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			identityBusy = '';
		}
	}

	async function unlinkIdentity(identityID: string) {
		identityBusy = `unlink-${identityID}`;
		securityError = '';
		try {
			const grant = await acquireReauthGrant('identity.unlink', {
				password: passwordReauthUsable ? identityPassword : '',
				providerID: reauthProviderID,
				hasPasskey: passkeyCount > 0
			});
			if (grant === null) return false;
			const result = await client.DELETE('/auth/oidc/identities/{identity_id}', {
				params: { path: { identity_id: identityID } },
				body: { reauth_grant: grant }
			});
			if (result.error) {
				if (result.response.status === 400) {
					throw new Error(m.settings_identity_final_credential());
				}
				throw new Error(result.error.detail || m.settings_identity_unlink_failed());
			}
			identityPassword = '';
			await loadSecurityStatus();
			notify(m.settings_identity_unlinked());
			return true;
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_identity_unlink_failed();
			return false;
		} finally {
			identityBusy = '';
		}
	}

	async function loadAuthSessions() {
		authSessionsLoading = true;
		authSessionsError = '';
		try {
			const { data, error: err } = await client.GET('/auth/sessions');
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			authSessions = data;
		} catch (e) {
			authSessionsError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			authSessionsLoading = false;
		}
	}

	async function revokeAuthSession(session: AuthSessionSummary) {
		authSessionBusyID = session.id;
		authSessionsError = '';
		try {
			const { data, error: err } = await client.DELETE('/auth/sessions/{session_id}', {
				params: { path: { session_id: session.id } }
			});
			if (err) throw new Error(err.detail || m.settings_action_failed());
			if (data?.revoked_current || session.current) {
				await auth.logout();
				await goto(resolveAppPath('/login'));
				return true;
			}
			await loadAuthSessions();
			notify(m.settings_session_revoked());
			return true;
		} catch (e) {
			authSessionsError = e instanceof Error ? e.message : m.settings_action_failed();
			return false;
		} finally {
			authSessionBusyID = '';
		}
	}

	async function startTOTPSetup() {
		securityBusy = true;
		securityError = '';
		totpSetupError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.totp.setup', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST('/auth/security/totp/setup', {
				body: {
					current_password: totpCurrentPassword,
					reauth_grant: grant || undefined
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			clearRecoveryCodeStage();
			totpSetupChallengeId = data.challenge_id;
			totpManualEntryKey = data.manual_entry_key;
			totpQRCodeDataURL = data.qr_code_data_url;
			totpCode = '';
			totpSetupKeyCopyState = 'idle';
			totpCurrentPassword = '';
		} catch (e) {
			totpSetupError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	async function confirmTOTPSetup() {
		if (!totpSetupChallengeId) return;
		securityBusy = true;
		securityError = '';
		totpSetupError = '';
		try {
			const { data, error: err } = await client.POST('/auth/security/totp/confirm', {
				body: {
					challenge_id: totpSetupChallengeId,
					code: totpCode
				}
			});
			if (err || !data?.recovery_codes?.length) {
				throw new Error(err?.detail || m.settings_action_failed());
			}
			recoveryCodeFlow = 'setup';
			recoveryCodeChallengeId = data.challenge_id;
			recoveryCodes = data.recovery_codes;
			recoveryCodesSaved = false;
			totpSetupChallengeId = data.challenge_id;
			totpManualEntryKey = '';
			totpQRCodeDataURL = '';
			totpCode = '';
			totpSetupKeyCopyState = 'idle';
		} catch (e) {
			totpSetupError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	function clearRecoveryCodeStage() {
		recoveryCodeFlow = null;
		recoveryCodeChallengeId = '';
		recoveryCodes = [];
		recoveryCodesSaved = false;
	}

	function clearTOTPSetupStage() {
		totpSetupChallengeId = '';
		totpManualEntryKey = '';
		totpQRCodeDataURL = '';
		totpCode = '';
		totpSetupError = '';
		totpSetupKeyCopyState = 'idle';
	}

	async function copyTOTPSetupKey() {
		const copied = await copyAuthenticatorSetupKey(totpManualEntryKey, (value) =>
			navigator.clipboard.writeText(value)
		);
		totpSetupKeyCopyState = copied ? 'copied' : 'failed';
	}

	function cancelTOTPSetup() {
		clearRecoveryCodeStage();
		clearTOTPSetupStage();
		notify(m.settings_recovery_codes_setup_discarded());
	}

	function discardRecoveryCodeStage() {
		const discardedSetup = recoveryCodeFlow === 'setup';
		clearRecoveryCodeStage();
		if (discardedSetup) {
			clearTOTPSetupStage();
		}
		notify(
			discardedSetup
				? m.settings_recovery_codes_setup_discarded()
				: m.settings_recovery_codes_regeneration_discarded()
		);
	}

	function recoveryCodesText() {
		return [
			m.settings_recovery_codes_file_title(),
			m.settings_recovery_codes_file_warning(),
			'',
			...recoveryCodes,
			''
		].join('\n');
	}

	async function copyRecoveryCodes() {
		securityError = '';
		try {
			await navigator.clipboard.writeText(recoveryCodesText());
			notify(m.settings_recovery_codes_copied());
		} catch {
			securityError = m.settings_recovery_codes_copy_failed();
		}
	}

	function downloadRecoveryCodes() {
		securityError = '';
		try {
			const blob = new Blob([recoveryCodesText()], { type: 'text/plain;charset=utf-8' });
			const url = URL.createObjectURL(blob);
			const anchor = document.createElement('a');
			anchor.href = url;
			anchor.download = 'openpost-recovery-codes.txt';
			document.body.append(anchor);
			anchor.click();
			anchor.remove();
			setTimeout(() => URL.revokeObjectURL(url), 0);
			notify(m.settings_recovery_codes_downloaded());
		} catch {
			securityError = m.settings_recovery_codes_download_failed();
		}
	}

	async function activateRecoveryCodes() {
		if (!recoveryCodeChallengeId || !recoveryCodeFlow || !recoveryCodesSaved) return;
		securityBusy = true;
		securityError = '';
		try {
			const result =
				recoveryCodeFlow === 'setup'
					? await client.POST('/auth/security/totp/enable', {
							body: {
								challenge_id: recoveryCodeChallengeId,
								recovery_codes_saved: true
							}
						})
					: await client.POST('/auth/security/totp/recovery-codes/activate', {
							body: {
								challenge_id: recoveryCodeChallengeId,
								recovery_codes_saved: true
							}
						});
			if (result.error || !result.data) {
				throw new Error(result.error?.detail || m.settings_action_failed());
			}
			const completedFlow = recoveryCodeFlow;
			securityStatus = result.data;
			clearRecoveryCodeStage();
			clearTOTPSetupStage();
			recoveryCodesRemaining = null;
			notify(
				completedFlow === 'setup'
					? m.settings_authenticator_enabled_notice()
					: m.settings_recovery_codes_replaced()
			);
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	async function checkRecoveryCodeStatus() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.totp.recovery.inspect', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST('/auth/security/totp/recovery-codes/status', {
				body: {
					current_password: totpCurrentPassword,
					reauth_grant: grant || undefined
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			recoveryCodesRemaining = data.remaining;
			totpCurrentPassword = '';
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	async function regenerateRecoveryCodes() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.totp.recovery.regenerate', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST(
				'/auth/security/totp/recovery-codes/regenerate',
				{
					body: {
						current_password: totpCurrentPassword,
						reauth_grant: grant || undefined
					}
				}
			);
			if (err || !data?.recovery_codes?.length) {
				throw new Error(err?.detail || m.settings_action_failed());
			}
			recoveryCodeFlow = 'regenerate';
			recoveryCodeChallengeId = data.challenge_id;
			recoveryCodes = data.recovery_codes;
			recoveryCodesSaved = false;
			recoveryCodesRemaining = null;
			totpCurrentPassword = '';
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	async function disableTOTP() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.totp.disable', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return false;
			const { data, error: err } = await client.POST('/auth/security/totp/disable', {
				body: {
					current_password: totpCurrentPassword,
					reauth_grant: grant || undefined
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			totpCurrentPassword = '';
			recoveryCodesRemaining = null;
			clearRecoveryCodeStage();
			notify(m.settings_authenticator_disabled_notice());
			return true;
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
			return false;
		} finally {
			securityBusy = false;
		}
	}

	async function addPasskey() {
		securityBusy = true;
		securityError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.passkey.add', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data: beginData, error: beginError } = await client.POST(
				'/auth/security/passkeys/begin',
				{
					body: {
						current_password: passkeyCurrentPassword,
						name: newPasskeyName,
						reauth_grant: grant || undefined
					}
				}
			);
			if (beginError || !beginData) {
				throw new Error(beginError?.detail || m.settings_action_failed());
			}

			const credential = await createPasskeyCredential(beginData.options);
			const { data, error: err } = await client.POST('/auth/security/passkeys/finish', {
				body: {
					challenge_id: beginData.challenge_id,
					name: newPasskeyName,
					credential
				}
			});
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			passkeyCurrentPassword = '';
			newPasskeyName = '';
			notify(m.settings_passkey_added());
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	async function removePasskey(passkeyId: string) {
		securityBusy = true;
		securityError = '';
		try {
			const grant = passwordReauthUsable
				? ''
				: await acquireReauthGrant('security.passkey.remove', {
						providerID: reauthProviderID,
						hasPasskey: passkeyCount > 0
					});
			if (grant === null) return;
			const { data, error: err } = await client.POST(
				'/auth/security/passkeys/{passkey_id}/remove',
				{
					params: { path: { passkey_id: passkeyId } },
					body: {
						current_password: passkeyCurrentPassword,
						reauth_grant: grant || undefined
					}
				}
			);
			if (err || !data) throw new Error(err?.detail || m.settings_action_failed());
			securityStatus = data;
			passkeyCurrentPassword = '';
			notify(m.settings_passkey_removed());
		} catch (e) {
			securityError = e instanceof Error ? e.message : m.settings_action_failed();
		} finally {
			securityBusy = false;
		}
	}

	function otherSecurityDraftDirty() {
		return Boolean(
			totpCurrentPassword ||
			passkeyCurrentPassword ||
			totpCode ||
			newPasskeyName ||
			emailChangeNewEmail ||
			emailChangeCode ||
			emailChangePassword ||
			totpSetupChallengeId ||
			recoveryCodeChallengeId ||
			recoveryCodes.length > 0
		);
	}

	function formatDate(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag()).format(new Date(value));
	}

	function formatDateTime(value: string): string {
		return new Intl.DateTimeFormat(getLocaleTag(), {
			dateStyle: 'medium',
			timeStyle: 'short'
		}).format(new Date(value));
	}

	function formatSessionUserAgent(value: string): string {
		const trimmed = value.trim();
		if (!trimmed) return m.settings_unknown_browser();

		const browser = sessionBrowserName(trimmed);
		const device = sessionDeviceName(trimmed);
		return m.settings_browser_on_device({ browser, device });
	}

	function sessionBrowserName(userAgent: string): string {
		if (/Edg\//.test(userAgent)) return 'Edge';
		if (/OPR\//.test(userAgent) || /Opera\//.test(userAgent)) return 'Opera';
		if (/Firefox\//.test(userAgent)) return 'Firefox';
		if (/CriOS\//.test(userAgent)) return 'Chrome';
		if (/Chrome\//.test(userAgent) || /Chromium\//.test(userAgent)) return 'Chrome';
		if (/Safari\//.test(userAgent)) return 'Safari';
		return m.settings_browser();
	}

	function sessionDeviceName(userAgent: string): string {
		if (/iPad/.test(userAgent)) return 'iPad';
		if (/iPhone/.test(userAgent)) return 'iPhone';
		if (/Android/.test(userAgent))
			return /Mobile/.test(userAgent) ? m.settings_android_phone() : m.settings_android_tablet();
		if (/Macintosh|Mac OS X/.test(userAgent)) return 'MacBook';
		if (/Windows NT/.test(userAgent)) return 'Windows';
		if (/Linux/.test(userAgent)) return 'Linux';
		return m.settings_device();
	}

	function formatSessionTime(value: string): string {
		if (!value || value.startsWith('0001-01-01')) return m.settings_never();
		return formatDateTime(value);
	}

	$effect(() => {
		const userID = authState.user?.id ?? '';
		if (!authState.isAuthenticated || !userID || loadedSecurityUserID === userID) return;
		loadedSecurityUserID = userID;
		void loadSecurityStatus();
		void loadAuthSessions();
	});

	$effect(() => {
		unsavedChanges?.set('security-settings', securityDraftDirty, securityDraftMessage);
		return () => unsavedChanges?.clear('security-settings');
	});
</script>

{#snippet recoveryCodePanel()}
	<div
		class="space-y-4 rounded-lg border border-amber-500/40 bg-amber-500/5 p-4"
		data-feedback-redact
		data-testid="recovery-code-panel"
		aria-labelledby="recovery-codes-title"
	>
		<div class="space-y-1">
			<p class="text-xs font-medium tracking-wide text-amber-700 uppercase dark:text-amber-300">
				{recoveryCodeFlow === 'setup' ? m.settings_totp_setup_step_recovery() : m.settings_recovery_codes_regenerate_title()}
			</p>
			<h4 id="recovery-codes-title" class="text-base font-semibold">
				{recoveryCodeFlow === 'setup'
					? m.settings_recovery_codes_setup_title()
					: m.settings_recovery_codes_regenerate_title()}
			</h4>
			<p class="text-sm leading-6 text-muted-foreground">
				{m.settings_recovery_codes_once_body()}
			</p>
			{#if recoveryCodeFlow === 'regenerate'}
				<p class="text-sm leading-6 text-muted-foreground">
					{m.settings_recovery_codes_old_active_until_replace()}
				</p>
			{/if}
		</div>

		<InlineNotice tone="warning" message={m.settings_recovery_codes_warning()} />

		<ol
			class="grid gap-2 rounded-md border bg-background p-3 sm:grid-cols-2"
			aria-label={m.settings_recovery_codes_list_label()}
			data-testid="recovery-code-list"
		>
			{#each recoveryCodes as code, index (code)}
				<li class="flex min-w-0 items-center gap-2 font-mono text-sm">
					<span class="w-5 shrink-0 text-right text-xs text-muted-foreground">{index + 1}.</span>
					<code class="break-all">{code}</code>
				</li>
			{/each}
		</ol>

		<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
			<Button
				type="button"
				variant="outline"
				class="gap-2"
				onclick={() => void copyRecoveryCodes()}
				disabled={securityBusy}
			>
				<CopyIcon class="h-4 w-4" />
				{m.settings_copy_recovery_codes()}
			</Button>
			<Button
				type="button"
				variant="outline"
				class="gap-2"
				onclick={downloadRecoveryCodes}
				disabled={securityBusy}
			>
				<DownloadIcon class="h-4 w-4" />
				{m.settings_download_recovery_codes()}
			</Button>
		</div>

		<div class="flex items-start gap-3 rounded-md border bg-background p-3">
			<Checkbox
				id="recovery-codes-saved"
				bind:checked={recoveryCodesSaved}
				aria-describedby="recovery-codes-saved-help"
			/>
			<div class="min-w-0 flex-1">
				<Label for="recovery-codes-saved" class="font-medium">
					{m.settings_recovery_codes_saved_acknowledgement()}
				</Label>
				<p id="recovery-codes-saved-help" class="mt-1 text-sm text-muted-foreground">
					{m.settings_recovery_codes_saved_help()}
				</p>
			</div>
		</div>

		<div class="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-between">
			<Button
				type="button"
				variant="ghost"
				onclick={discardRecoveryCodeStage}
				disabled={securityBusy}
			>
				{m.settings_discard_recovery_codes()}
			</Button>
			<Button
				type="button"
				onclick={() => void activateRecoveryCodes()}
				disabled={securityBusy || !recoveryCodesSaved}
			>
				{recoveryCodeFlow === 'setup'
					? m.settings_enable_authenticator()
					: m.settings_replace_recovery_codes()}
			</Button>
		</div>
		<p class="text-xs text-muted-foreground">
			{m.settings_recovery_codes_saved_help()}
		</p>
	</div>
{/snippet}

{#if loadingSecurity}
	<PageLoading layout="grid" label={m.common_loading()} items={2} />
{:else}
	<div class="space-y-4">
		<div class="border-y py-3">
			<div class="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
				<div>
					<p class="text-sm font-medium">{securityStatus?.user.email}</p>
					<p class="text-sm text-muted-foreground">
						{m.settings_active_methods()}
						{securityStatus?.methods?.length
							? (securityStatus.methods ?? []).map(securityMethodLabel).join(', ')
							: m.settings_none_configured()}
					</p>
				</div>
				<p class="text-sm text-muted-foreground">
					{m.settings_passkey_count({ count: passkeyCount })}
				</p>
			</div>
		</div>

		<div class="rounded-lg border p-4">
			<div class="mb-4 flex items-center justify-between gap-3">
				<div>
					<h3 class="flex items-center gap-2 font-medium">
						<MonitorIcon class="h-4 w-4 text-muted-foreground" />
						{m.settings_active_sessions()}
					</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.settings_active_sessions_body()}
					</p>
				</div>
				<Button
					variant="outline"
					size="sm"
					onclick={loadAuthSessions}
					disabled={authSessionsLoading}
				>
					{#if authSessionsLoading}
						<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
					{/if}
					{m.common_refresh()}
				</Button>
			</div>

			{#if authSessionsError}
				<InlineNotice tone="error" message={authSessionsError} class="mb-3" />
			{/if}

			{#if authSessionsLoading && authSessions.length === 0}
				<PageLoading layout="list" label={m.common_loading()} items={2} />
			{:else if authSessions.length === 0 && !authSessionsError}
				<p class="rounded-md border bg-muted/20 p-4 text-sm text-muted-foreground">
					{m.settings_no_sessions()}
				</p>
			{:else}
				<div class="space-y-2" data-testid="auth-session-list">
					{#each authSessions as session (session.id)}
						<div
							class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
							data-testid="auth-session-row"
						>
							<div class="min-w-0">
								<div class="flex flex-wrap items-center gap-2">
									<p class="truncate text-sm font-medium" title={session.user_agent}>
										{formatSessionUserAgent(session.user_agent)}
									</p>
									{#if session.current}
										<span class="rounded-full bg-primary/10 px-2 py-0.5 text-xs text-primary">
											{m.settings_current()}
										</span>
									{/if}
								</div>
								<p class="mt-1 text-xs text-muted-foreground">
									{session.ip_address || m.settings_unknown_ip()} · {m.settings_last_used()}
									{formatSessionTime(session.last_used_at)} · {m.settings_expires()}
									{formatSessionTime(session.expires_at)}
								</p>
							</div>
							<Button
								variant="ghost"
								size="sm"
								class="self-start text-destructive hover:text-destructive sm:self-center"
								onclick={() => requestSecurityAction({ kind: 'session', session })}
								disabled={Boolean(authSessionBusyID)}
							>
								{#if authSessionBusyID === session.id}
									<LoaderIcon class="mr-2 h-4 w-4 animate-spin" />
								{:else}
									<LogOutIcon class="mr-2 h-4 w-4" />
								{/if}
								{session.current ? m.settings_sign_out() : m.settings_revoke()}
							</Button>
						</div>
					{/each}
				</div>
			{/if}
		</div>

		<details class="group rounded-lg border" data-testid="email-change-card" open={Boolean(emailChangePending)}>
			<summary class="flex cursor-pointer list-none items-center justify-between p-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
				<div>
					<h3 class="font-medium">{m.settings_change_email()}</h3>
					<p class="mt-1 text-sm leading-6 text-muted-foreground">
						{m.settings_change_email_description()}
					</p>
				</div>
				<span class="ml-4 shrink-0 text-xs text-muted-foreground group-open:hidden"
					>{m.common_edit()}</span
				>
			</summary>
			<div class="border-t p-4">
			<div class="mb-4 rounded-md border bg-muted/20 px-3 py-2">
				<p class="text-xs text-muted-foreground">{m.settings_email_address()}</p>
				<p class="mt-1 text-sm font-medium break-all">
					{securityStatus?.user.email ?? profileEmail}
				</p>
			</div>

			{#if emailChangePending}
				<div class="space-y-4">
					<InlineNotice
						tone="info"
						message={m.settings_email_change_pending({
							email: emailChangePending.new_email
						})}
					/>
					<div class="max-w-sm space-y-2">
						<Label for="email-change-code">{m.settings_email_change_code()}</Label>
						<Input
							id="email-change-code"
							bind:value={emailChangeCode}
							inputmode="numeric"
							pattern="[0-9]{6}"
							maxlength={6}
							autocomplete="one-time-code"
							aria-describedby="email-change-code-help"
						/>
						<p id="email-change-code-help" class="text-xs leading-5 text-muted-foreground">
							{m.settings_email_change_code_help()}
						</p>
					</div>
					<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
						<Button
							type="button"
							onclick={() => void confirmEmailChange()}
							disabled={emailChangeBusy || emailChangeCode.length !== 6}
						>
							{m.settings_confirm_email_change()}
						</Button>
						<Button
							type="button"
							variant="outline"
							onclick={() => void resendEmailChange()}
							disabled={emailChangeBusy}
						>
							{m.settings_resend_email_change()}
						</Button>
						<Button
							type="button"
							variant="ghost"
							onclick={() => void cancelEmailChange()}
							disabled={emailChangeBusy}
						>
							{m.settings_cancel_email_change()}
						</Button>
					</div>
				</div>
			{:else}
				<div class="grid gap-4 sm:grid-cols-2">
					<div class="space-y-2">
						<Label for="email-change-new">{m.settings_new_email()}</Label>
						<Input
							id="email-change-new"
							type="email"
							bind:value={emailChangeNewEmail}
							autocomplete="email"
						/>
					</div>
					{#if passwordReauthUsable}
						<div class="space-y-2">
							<Label for="email-change-password">{m.settings_current_password()}</Label>
							<Input
								id="email-change-password"
								type="password"
								bind:value={emailChangePassword}
								autocomplete="current-password"
							/>
						</div>
					{:else}
						<InlineNotice tone="info" message={m.settings_step_up_body()} />
					{/if}
				</div>
				<Button
					class="mt-4"
					type="button"
					onclick={() => void beginEmailChange()}
					disabled={emailChangeBusy ||
						!emailChangeNewEmail.trim() ||
						(passwordReauthUsable ? !emailChangePassword : !hasStepUpMethod)}
				>
					{#if emailChangeBusy}<LoaderIcon class="mr-2 size-4 animate-spin" />{/if}
					{m.settings_start_email_change()}
				</Button>
			{/if}

			{#if emailChangeError}
				<InlineNotice tone="error" message={emailChangeError} class="mt-4" />
			{/if}
			</div>
		</details>

		<details class="group rounded-lg border p-4" open={linkedIdentities.length > 0 || unlinkedProviders.length > 0}>
			<summary class="flex cursor-pointer list-none items-center justify-between focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
				<div>
					<h3 class="flex items-center gap-2 font-medium">
						<KeyRoundIcon class="h-4 w-4 text-muted-foreground" />
						{m.settings_linked_identities()}
					</h3>
					<p class="mt-1 text-sm text-muted-foreground">
						{m.settings_linked_identities_body()}
					</p>
				</div>
				<span class="ml-4 shrink-0 text-xs text-muted-foreground group-open:hidden"
					>{m.common_edit()}</span
				>
			</summary>
			<div class="pt-4">
			<InlineNotice tone="info" message={m.settings_linked_identities_boundary()} class="mb-4" />

			{#if passwordReauthUsable && (linkedIdentities.length || unlinkedProviders.length)}
				<div class="mb-3 max-w-sm space-y-2">
					<Label for="identity-link-password">{m.settings_current_password()}</Label>
					<Input
						id="identity-link-password"
						type="password"
						bind:value={identityPassword}
						autocomplete="current-password"
					/>
				</div>
			{:else if !passwordReauthUsable && (linkedIdentities.length || unlinkedProviders.length)}
				<p class="mb-3 text-sm text-muted-foreground">{m.settings_step_up_body()}</p>
			{/if}

			<div class="space-y-2">
				{#each linkedIdentities as identity (identity.id)}
					<div
						class="flex flex-col gap-3 rounded-md border px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
					>
						<div class="min-w-0">
							<p class="text-sm font-medium">
								{identity.linked_name || identity.provider_name}
							</p>
							<p class="truncate text-xs text-muted-foreground">
								{identity.provider_name} · {identity.linked_email ?? securityStatus?.user.email}
							</p>
							<p class="mt-1 text-xs text-muted-foreground">
								{m.settings_identity_linked_on({ date: formatDate(identity.created_at) })}
								{#if identity.last_login_at}
									· {m.settings_identity_last_used({
										date: formatDateTime(identity.last_login_at)
									})}
								{/if}
							</p>
						</div>
						<Button
							type="button"
							variant="ghost"
							size="sm"
							class="self-start text-destructive hover:text-destructive sm:self-auto"
							disabled={Boolean(identityBusy) ||
								(passwordReauthUsable ? !identityPassword.trim() : !hasStepUpMethod)}
							onclick={() => requestSecurityAction({ kind: 'identity', identity })}
						>
							{m.settings_unlink_identity()}
						</Button>
					</div>
				{/each}
			</div>

			{#if unlinkedProviders.length}
				<div class="mt-4 flex flex-wrap gap-2">
					{#each unlinkedProviders as provider (provider.id)}
						<Button
							type="button"
							variant="outline"
							disabled={Boolean(identityBusy) ||
								(passwordReauthUsable ? !identityPassword.trim() : !hasStepUpMethod)}
							onclick={() => void linkIdentity(provider.id)}
						>
							{m.settings_link_identity({ provider: provider.name })}
						</Button>
					{/each}
				</div>
			{:else if linkedIdentities.length === 0}
				<p class="text-sm text-muted-foreground">{m.settings_no_linkable_identities()}</p>
			{/if}
			</div>
		</details>

		<div class="grid gap-4 lg:grid-cols-2">
			<div class="rounded-lg border p-4" data-testid="authenticator-security-card">
				<div class="mb-3 flex items-center gap-2">
					<SmartphoneIcon class="h-4 w-4 text-muted-foreground" />
					<h3 class="font-medium">{m.settings_authenticator()}</h3>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">
					{m.settings_authenticator_body()}
				</p>

				{#if securityStatus?.totp_enabled}
					<div class="space-y-3">
						<InlineNotice tone="success">
							<p class="font-medium">{m.settings_authenticator_enabled()}</p>
							<p class="mt-1">{m.settings_totp_setup_enabled_body()}</p>
						</InlineNotice>
						{#if recoveryCodeFlow === 'regenerate' && recoveryCodes.length > 0}
							{@render recoveryCodePanel()}
						{:else}
							<p class="text-sm leading-6 text-muted-foreground">
								{m.settings_recovery_codes_management_body()}
							</p>
							{#if passwordReauthUsable}
								<div class="space-y-2">
									<Label for="totp-management-password">
										{m.settings_current_password()}
									</Label>
									<Input
										id="totp-management-password"
										type="password"
										bind:value={totpCurrentPassword}
										autocomplete="current-password"
										placeholder={m.settings_password_required_recovery_codes()}
									/>
								</div>
							{:else}
								<p class="text-sm text-muted-foreground">
									{m.settings_step_up_body()}
								</p>
							{/if}

							{#if recoveryCodesRemaining !== null}
								<InlineNotice
									tone={recoveryCodesRemaining <= 2 ? 'warning' : 'info'}
									message={recoveryCodesRemainingLabel(recoveryCodesRemaining)}
								/>
							{/if}

							<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
								<Button
									type="button"
									variant="outline"
									onclick={() => void checkRecoveryCodeStatus()}
									disabled={securityBusy ||
										(passwordReauthUsable ? totpCurrentPassword.length === 0 : !hasStepUpMethod)}
								>
									{m.settings_check_recovery_codes()}
								</Button>
								<Button
									type="button"
									variant="outline"
									onclick={() => void regenerateRecoveryCodes()}
									disabled={securityBusy ||
										(passwordReauthUsable ? totpCurrentPassword.length === 0 : !hasStepUpMethod)}
								>
									{m.settings_generate_recovery_codes()}
								</Button>
								<Button
									type="button"
									variant="outline"
									class="text-destructive hover:text-destructive"
									onclick={() => requestSecurityAction({ kind: 'totp' })}
									disabled={securityBusy ||
										(passwordReauthUsable ? totpCurrentPassword.length === 0 : !hasStepUpMethod)}
								>
									{m.settings_disable_authenticator()}
								</Button>
							</div>
						{/if}
					</div>
				{:else}
					<div class="space-y-3">
						{#if !totpSetupChallengeId && recoveryCodeFlow !== 'setup'}
							<details class="rounded-md border bg-muted/20 px-3 py-3" data-testid="totp-setup-steps">
								<summary class="cursor-pointer list-none text-sm font-medium focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
									{m.settings_totp_setup_steps_label()}
								</summary>
								<ol
									class="mt-2 list-decimal space-y-1.5 pl-5 text-sm leading-5 text-muted-foreground marker:font-medium marker:text-foreground"
								>
									<li>{m.settings_totp_setup_step_choose()}</li>
									<li>{m.settings_totp_setup_step_reauth()}</li>
									<li>{m.settings_totp_setup_step_add()}</li>
									<li>{m.settings_totp_setup_step_code()}</li>
									<li>{m.settings_totp_setup_step_recovery()}</li>
									<li>{m.settings_totp_setup_step_complete()}</li>
								</ol>
							</details>
						{:else}
							<div class="rounded-md border bg-muted/20 px-3 py-2 text-xs text-muted-foreground" data-testid="totp-setup-steps">
								{m.settings_totp_setup_step_add()} → {m.settings_totp_setup_step_code()} → {m.settings_totp_setup_step_recovery()}
							</div>
						{/if}
						{#if totpSetupError}
							<InlineNotice tone="error" message={totpSetupError} />
						{/if}
						{#if recoveryCodeFlow === 'setup' && recoveryCodes.length > 0}
							{@render recoveryCodePanel()}
						{:else if totpSetupChallengeId}
							<div class="space-y-4 rounded-lg border bg-muted/20 p-3 sm:p-4" data-feedback-redact>
								<InlineNotice tone="info" message={m.settings_totp_setup_keep_open()} />
								<div class="space-y-2">
									<div>
										<p class="text-sm font-medium">
											{m.settings_totp_setup_scan_title()}
										</p>
										<p class="mt-1 text-sm leading-5 text-muted-foreground">
											{m.settings_totp_setup_scan_body()}
										</p>
									</div>
									<img
										src={totpQRCodeDataURL}
										alt={m.settings_totp_setup_qr_alt()}
										class="mx-auto size-56 max-w-full rounded-lg border bg-white p-2"
										data-testid="totp-setup-qr-code"
									/>
								</div>
								<div class="space-y-2">
									<div>
										<Label for="totp-manual-entry-key">{m.settings_manual_key()}</Label>
										<p
											id="totp-manual-entry-key-help"
											class="mt-1 text-sm leading-5 text-muted-foreground"
										>
											{m.settings_totp_setup_manual_body()}
										</p>
									</div>
									<div class="flex flex-col gap-2 sm:flex-row">
										<Input
											id="totp-manual-entry-key"
											value={totpManualEntryKey}
											readonly
											aria-describedby="totp-manual-entry-key-help totp-manual-entry-key-status"
											class="font-mono text-xs tracking-wide"
											data-testid="totp-manual-entry-key"
											onfocus={(event) => event.currentTarget.select()}
										/>
										<Button
											type="button"
											variant="outline"
											class="shrink-0"
											onclick={() => void copyTOTPSetupKey()}
										>
											<CopyIcon class="mr-2 size-4" />
											{m.settings_totp_setup_copy_key()}
										</Button>
									</div>
									<p
										id="totp-manual-entry-key-status"
										class="text-xs text-muted-foreground"
										role="status"
										aria-live="polite"
									>
										{#if totpSetupKeyCopyState === 'copied'}
											{m.settings_totp_setup_key_copied()}
										{:else if totpSetupKeyCopyState === 'failed'}
											{m.settings_totp_setup_key_copy_failed()}
										{/if}
									</p>
								</div>
								<div class="space-y-2">
									<Label for="totp-code">{m.settings_totp_code()}</Label>
									<p class="text-sm leading-5 text-muted-foreground">
										{m.settings_totp_setup_code_body()}
									</p>
									<Input
										id="totp-code"
										bind:value={totpCode}
										inputmode="numeric"
										autocomplete="one-time-code"
										pattern="[0-9]{6}"
										maxlength={6}
										placeholder="123456"
										oninput={() => (totpSetupError = '')}
									/>
								</div>
								<div class="flex flex-col gap-2 sm:flex-row sm:flex-wrap">
									<Button
										type="button"
										onclick={() => void confirmTOTPSetup()}
										disabled={securityBusy || !isAuthenticatorCodeReady(totpCode)}
									>
										{m.settings_verify_authenticator()}
									</Button>
									<Button
										type="button"
										variant="ghost"
										onclick={cancelTOTPSetup}
										disabled={securityBusy}
									>
										{m.settings_cancel_authenticator_setup()}
									</Button>
								</div>
							</div>
						{:else if passwordReauthUsable}
							<div class="space-y-2">
								<Label for="totp-password">{m.settings_current_password()}</Label>
								<Input
									id="totp-password"
									type="password"
									bind:value={totpCurrentPassword}
									autocomplete="current-password"
									placeholder={m.settings_password_required_setup()}
								/>
							</div>
						{:else}
							<p class="text-sm text-muted-foreground">
								{m.settings_step_up_body()}
							</p>
						{/if}
						{#if !totpSetupChallengeId && recoveryCodeFlow !== 'setup'}
							<Button
								type="button"
								onclick={() => void startTOTPSetup()}
								disabled={securityBusy ||
									(passwordReauthUsable ? totpCurrentPassword.length === 0 : !hasStepUpMethod)}
							>
								{m.settings_start_authenticator()}
							</Button>
						{/if}
					</div>
				{/if}
			</div>

			<div class="rounded-lg border p-4">
				<div class="mb-3 flex items-center gap-2">
					<KeyRoundIcon class="h-4 w-4 text-muted-foreground" />
					<h3 class="font-medium">{m.settings_passkeys()}</h3>
				</div>
				<p class="mb-4 text-sm text-muted-foreground">
					{m.settings_passkeys_body()}
				</p>

				<div class="space-y-3">
					{#if passwordReauthUsable}
						<div class="space-y-2">
							<Label for="passkey-password">{m.settings_current_password()}</Label>
							<Input
								id="passkey-password"
								type="password"
								bind:value={passkeyCurrentPassword}
								autocomplete="current-password"
								placeholder={m.settings_password_required_passkeys()}
							/>
						</div>
					{:else}
						<p class="text-sm text-muted-foreground">
							{m.settings_step_up_body()}
						</p>
					{/if}
					<div class="space-y-2">
						<Label for="passkey-name">{m.settings_passkey_name()}</Label>
						<Input
							id="passkey-name"
							bind:value={newPasskeyName}
							placeholder={m.settings_passkey_name_placeholder()}
						/>
					</div>
					<Button
						onclick={addPasskey}
						disabled={securityBusy ||
							(passwordReauthUsable ? passkeyCurrentPassword.length === 0 : !hasStepUpMethod)}
					>
						{m.settings_add_passkey()}
					</Button>
				</div>

				<div class="mt-4 space-y-2">
					{#if (securityStatus?.passkeys ?? []).length}
						{#each securityStatus?.passkeys ?? [] as passkey (passkey.id)}
							<div class="flex items-center justify-between rounded-md border px-3 py-2">
								<div>
									<p class="text-sm font-medium">{passkey.name}</p>
									<p class="text-xs text-muted-foreground">
										{#if passkey.last_used_at && passkey.last_used_at !== '0001-01-01T00:00:00Z'}
											{m.settings_passkey_last_used({
												date: formatDateTime(passkey.last_used_at)
											})}
										{:else}
											{m.settings_passkey_added_on({
												date: formatDateTime(passkey.created_at)
											})}
										{/if}
									</p>
								</div>
								<Button
									variant="ghost"
									size="sm"
									class="text-destructive hover:text-destructive"
									onclick={() => removePasskey(passkey.id)}
									disabled={securityBusy ||
										(passwordReauthUsable ? passkeyCurrentPassword.length === 0 : !hasStepUpMethod)}
								>
									{m.settings_remove()}
								</Button>
							</div>
						{/each}
					{:else}
						<p class="text-sm text-muted-foreground">{m.settings_no_passkeys()}</p>
					{/if}
				</div>
			</div>
		</div>

		<AccountDataCard
			email={securityStatus?.user.email ?? profileEmail}
			hasPassword={passwordReauthUsable}
			{reauthProviderID}
			hasPasskey={passkeyCount > 0}
		/>

		{#if securityError}
			<InlineNotice tone="error" message={securityError} />
		{/if}
	</div>
{/if}

<DestructiveConfirmDialog
	bind:open={destructiveDialogOpen}
	title={destructiveActionTitle()}
	description={destructiveActionDescription()}
	confirmLabel={destructiveActionConfirmLabel()}
	onConfirm={confirmDestructiveAction}
/>
