### Fixed

- Video Editor exports retry WebCodecs source decoding with software acceleration when a browser decoder reports a decoding error. This recovers affected high-frame-rate VP9 recordings without changing the selected export format or codec.
