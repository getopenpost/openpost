# Recorder

Open `/record` to capture screen, camera, and microphone sources as separate synchronized files. The same recorder is available inside OpenPost Video Editor, where finished sources can be added to the current timeline together.

## Choose sources

Select any supported combination of screen, camera, and microphone. Camera and microphone use the chosen device or fall back to the current default if a saved device has disappeared. Video choices include 720p, 1080p, or 2160p and 24, 30, or 60 fps, subject to the device and browser.

Screen capture uses the browser's own tab, window, or display chooser. System or tab audio is present only when the browser returns an audio track. OpenPost reports whether it is active instead of assuming that a checked option worked. Cursor visibility also follows the browser's reported capture setting.

Microphone capture can request noise suppression and automatic gain control. A countdown and planned-length estimate help you prepare and reserve local space before recording starts.

## During capture

The recorder shows elapsed time, chunk counts, bytes written, local space, and microphone level. Screen, camera, and microphone sources use one capture timebase so the editor can place them in sync.

Chunks and a recovery manifest are written to local scratch storage while recording. Storage checks stop capture before the browser runs out of space. If a device disappears, the recorder tries the selected device and then the default. If recovery cannot continue, already flushed tracks remain available.

The standalone recorder downloads each finished source file. Inside Video Editor, **Add to timeline** imports the files and places them as one linked, undoable edit. Discard removes recoverable scratch data when possible.

## Privacy and browser support

OpenPost requests screen, camera, or microphone access only after you start recording. Captures stay on the device unless you later upload a finished export to OpenPost. Browser permission indicators and operating-system controls remain authoritative.

Current Chrome and Edge provide the intended capture APIs. Available resolutions, frame rates, system audio, cursor options, and MIME types vary by browser, operating system, and selected device.
