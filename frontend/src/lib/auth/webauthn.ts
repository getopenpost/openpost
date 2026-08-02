function decodeBase64URL(input: string): ArrayBuffer {
	const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
	const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
	const binary = atob(padded);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

function encodeBase64URL(buffer: ArrayBuffer | null | undefined): string | null {
	if (!buffer) return null;
	const bytes = new Uint8Array(buffer);
	let binary = '';
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function toRegistrationOptions(options: any): CredentialCreationOptions {
	const publicKey = options.publicKey ?? options;

	return {
		publicKey: {
			...publicKey,
			challenge: decodeBase64URL(publicKey.challenge),
			user: {
				...publicKey.user,
				id: decodeBase64URL(publicKey.user.id)
			},
			excludeCredentials: (publicKey.excludeCredentials ?? []).map((credential: any) => ({
				...credential,
				id: decodeBase64URL(credential.id)
			}))
		}
	};
}

function toAuthenticationOptions(options: any): CredentialRequestOptions {
	const publicKey = options.publicKey ?? options;

	return {
		publicKey: {
			...publicKey,
			challenge: decodeBase64URL(publicKey.challenge),
			allowCredentials: (publicKey.allowCredentials ?? []).map((credential: any) => ({
				...credential,
				id: decodeBase64URL(credential.id)
			}))
		}
	};
}

function serializeCredential(credential: PublicKeyCredential) {
	const response = credential.response as
		AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;

	return {
		id: credential.id,
		rawId: encodeBase64URL(credential.rawId),
		type: credential.type,
		authenticatorAttachment: credential.authenticatorAttachment ?? null,
		clientExtensionResults: credential.getClientExtensionResults(),
		response: {
			clientDataJSON: encodeBase64URL(response.clientDataJSON),
			attestationObject:
				'attestationObject' in response ? encodeBase64URL(response.attestationObject) : null,
			authenticatorData:
				'authenticatorData' in response ? encodeBase64URL(response.authenticatorData) : null,
			signature: 'signature' in response ? encodeBase64URL(response.signature) : null,
			userHandle: 'userHandle' in response ? encodeBase64URL(response.userHandle) : null
		}
	};
}

function requireWebAuthn() {
	if (typeof window === 'undefined' || !window.PublicKeyCredential || !navigator.credentials) {
		throw new Error('This browser does not support passkeys');
	}
}

export async function createPasskeyCredential(options: any) {
	requireWebAuthn();
	const credential = await navigator.credentials.create(toRegistrationOptions(options));
	if (!credential || !(credential instanceof PublicKeyCredential)) {
		throw new Error('Passkey registration was cancelled');
	}
	return serializeCredential(credential);
}

export async function getPasskeyAssertion(options: any) {
	requireWebAuthn();
	const credential = await navigator.credentials.get(toAuthenticationOptions(options));
	if (!credential || !(credential instanceof PublicKeyCredential)) {
		throw new Error('Passkey verification was cancelled');
	}
	return serializeCredential(credential);
}
