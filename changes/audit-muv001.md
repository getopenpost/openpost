### Fixed

- Media image uploads now require valid decoded pixels before becoming ready or being reused. Corrupt images show an upload error and cannot become editable library assets; image decoding is bounded to 64 million pixels (MUV001).
