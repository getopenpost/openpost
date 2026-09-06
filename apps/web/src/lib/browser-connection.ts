export function observeBrowserConnection(onChange: (online: boolean) => void): () => void {
	const update = () => onChange(navigator.onLine);
	update();
	window.addEventListener('online', update);
	window.addEventListener('offline', update);
	return () => {
		window.removeEventListener('online', update);
		window.removeEventListener('offline', update);
	};
}
