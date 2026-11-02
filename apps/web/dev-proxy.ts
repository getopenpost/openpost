export function devProxy(backend: string = 'http://localhost:8080') {
	return {
		'/api': { target: backend, changeOrigin: false, timeout: 120_000, proxyTimeout: 120_000 },
		'^/media/[^/]+': { target: backend },
		'^/avatars/[^/]+': { target: backend }
	};
}
