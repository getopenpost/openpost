### Fixed

- Accept `.ogg`, `.oga`, `.opus` and `.m4a` uploads again. The content sniffer names Ogg `application/ogg` and every ISO BMFF brand `video/mp4`, so files browsers declare as `audio/ogg`, `video/ogg` or `audio/x-m4a` were rejected as not matching their declared MIME type.
- Store an Ogg upload with the `audio/ogg` or `video/ogg` type the browser declared instead of the sniffer's `application/ogg`, so it is presented as audio or analysed as video rather than filed as an unknown file.
