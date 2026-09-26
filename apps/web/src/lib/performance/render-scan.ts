import { mount, unmount } from 'svelte';
import { RenderScan } from 'svelte-render-scan';
import './render-scan.css';

const target = document.createElement('div');
target.className = 'openpost-render-scan';
document.body.append(target);
const component = mount(RenderScan, { target });

if (import.meta.hot) {
	import.meta.hot.dispose(() => {
		void unmount(component).then(() => target.remove());
	});
}
