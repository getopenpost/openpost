### Security

- Stop serving original media, thumbnails, and video posters after access is denied. Previously, error responses could include private file bytes when the media ID was known, even without valid credentials.
