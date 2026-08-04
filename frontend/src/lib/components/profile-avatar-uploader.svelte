<script lang="ts">
	import Uppy from '@uppy/core';
	import Webcam from '@uppy/webcam';
	import ImageEditor from '@uppy/image-editor';
	import XHRUpload from '@uppy/xhr-upload';
	import DashboardModal from '@uppy/svelte/dashboard-modal';
	import { getApiBase } from '$lib/stores/instance.svelte';
	import { getToken } from '$lib/api/client';
	import '@uppy/core/css/style.min.css';
	import '@uppy/dashboard/css/style.min.css';
	import '@uppy/webcam/css/style.min.css';
	import '@uppy/image-editor/css/style.min.css';
	import '@uppy/svelte/css/style.css';
	import '@uppy/svelte/css/image-editor.css';

	let {
		open = $bindable(false),
		onComplete,
		onError
	}: {
		open: boolean;
		onComplete?: (avatarURL: string) => void;
		onError?: (message: string) => void;
	} = $props();

	const uppy = new Uppy({
		restrictions: {
			maxNumberOfFiles: 1,
			maxFileSize: 4 * 1024 * 1024,
			allowedFileTypes: ['image/*']
		},
		autoProceed: false
	})
		.use(Webcam, {
			modes: ['picture'],
			mirror: true
		})
		.use(ImageEditor, {
			cropperOptions: {
				initialAspectRatio: 1,
				aspectRatio: 1,
				autoCropArea: 0.85
			},
			actions: {
				cropSquare: true,
				cropWidescreen: false,
				cropWidescreenVertical: false,
				rotate: true,
				zoomIn: true,
				zoomOut: true
			}
		})
		.use(XHRUpload, {
			endpoint: () => `${getApiBase()}/auth/profile/avatar`,
			withCredentials: true,
			fieldName: 'file',
			formData: true,
			limit: 1,
			headers: (): Record<string, string> => {
				const token = getToken();
				return token ? { Authorization: `Bearer ${token}` } : {};
			}
		});

	uppy.on('upload-success', (_file, response) => {
		const avatarURL =
			typeof response.body === 'object' && response.body && 'avatar_url' in response.body
				? String(response.body.avatar_url)
				: '';
		if (!avatarURL) {
			onError?.('Avatar upload finished without a profile URL.');
			return;
		}
		onComplete?.(avatarURL);
		open = false;
		uppy.cancelAll();
	});

	uppy.on('upload-error', (_file, error) => {
		onError?.(error.message || 'Failed to upload avatar.');
	});

	uppy.on('restriction-failed', (_file, error) => {
		onError?.(error.message || 'Avatar must be an image under 4 MB.');
	});

	uppy.on('dashboard:modal-closed', () => {
		open = false;
		uppy.cancelAll();
	});

	$effect(() => {
		return () => {
			uppy.destroy();
		};
	});
</script>

<DashboardModal
	{uppy}
	{open}
	plugins={['Webcam', 'ImageEditor']}
	props={{
		proudlyDisplayPoweredByUppy: false,
		closeModalOnClickOutside: true,
		disablePageScrollWhenModalOpen: true,
		hideUploadButton: false,
		note: 'Square PNG, JPEG, GIF, or WebP. Max 4 MB.'
	}}
/>
