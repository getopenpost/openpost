### Fixed

- Media image uploads now require valid decoded pixels before becoming ready or being reused. Corrupt images show an upload error and cannot become editable library assets; image decoding is bounded to 64 million pixels (MUV001).

- Supported AVIF, BMP, TIFF and ICO uploads remain accepted after pixel validation. ICO images now retain decoded dimensions and thumbnails.
