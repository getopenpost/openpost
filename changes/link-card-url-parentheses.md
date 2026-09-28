### Fixed

- Detect a link card URL that contains parentheses, such as a Wikipedia article link, whole. Detection stopped at the first ")", so "https://en.wikipedia.org/wiki/Go_(programming_language)" became a broken link missing its closing parenthesis; a ")" is now dropped only when it closes text around the link.
