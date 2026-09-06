// Run only after the old worker has released its clients and can no longer
// recreate its unrestricted navigation cache.
self.addEventListener('activate', (event) => {
	event.waitUntil(caches.delete('openpost-pages-1'));
});
