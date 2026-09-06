export function safeSameOriginRedirect(url: URL, fallback = '/') {
	const redirect = url.searchParams.get('redirect');
	if (!redirect || redirect.startsWith('//') || redirect.startsWith('\\')) return fallback;

	try {
		const target = new URL(redirect, url.origin);
		if (target.origin !== url.origin || !target.pathname.startsWith('/')) return fallback;
		return `${target.pathname}${target.search}${target.hash}`;
	} catch {
		return fallback;
	}
}
