# ICO decoder

This dedicated Media driver contains the decoder-only sources from [go-ico v1.0.0](https://github.com/sergeymakinen/go-ico/tree/v1.0.0) and its [go-bmp v1.0.0](https://github.com/sergeymakinen/go-bmp/tree/v1.0.0) dependency. Both use BSD 3-Clause licenses, preserved beside the sources.

Changes from upstream: import paths point to this internal driver, the unused multi-icon API is omitted, byte-slice entry points always construct seekable readers, and global `image.RegisterFormat` initialization is removed. Media calls the driver with seekable, byte-bounded readers and checks decoded dimensions before pixel allocation. Do not register these decoders globally: upstream ICO readers without seeking allocate from untrusted directory entry sizes.

The BMP preflight also rejects palettes larger than the bit depth before slicing its fixed header buffer. Three inherited parser functions have precise complexity-only lint exclusions to preserve the reviewed upstream algorithms; other lint checks remain enabled.

The existing Media owner remains responsible for upload limits, pixel-count preflight, full decode admission and thumbnails.
