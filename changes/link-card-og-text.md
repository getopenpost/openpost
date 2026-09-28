### Fixed

- Read a link card's Open Graph title and description whole when they contain an apostrophe, such as "The world's best", which was cut at the apostrophe, and decode HTML entities in them and in the page title, so a LinkedIn article card no longer shows "Tom &amp; Jerry" or "Don&#39;t". A `data-content` attribute is no longer read as the value, and an unquoted `content=` value is read.
