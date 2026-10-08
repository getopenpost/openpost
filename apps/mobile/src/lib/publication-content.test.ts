import { expect, test } from "bun:test";
import { publicationContentUpdate } from "./publication-content";

const first = {
  id: "first",
  position: 0,
  body: "Before",
  title: "Title",
  description: "Description",
  url: "https://example.com",
  settings: { poll: { question: "Which?" } },
  media: [{ id: "photo", role: "attachment", alt_text: "A photo", settings: { crop: "square" } }],
};
const reply = {
  id: "reply",
  position: 1,
  body: "Keep this reply",
  title: "",
  description: "",
  settings: {},
  media: [{ id: "reply-photo", alt_text: "Reply photo" }],
};
const publication = { source_text: "Before", segments: [first, reply], media: first.media };

test("saves added photos on the first canonical segment and preserves the rest of the thread", () => {
  const update = publicationContentUpdate(publication, "Edited", ["photo", "new-photo"]);
  expect(update).toEqual({
    source_text: "Edited",
    segments: [
      {
        id: "first",
        body: "Edited",
        title: "Title",
        description: "Description",
        url: "https://example.com",
        settings: { poll: { question: "Which?" } },
        media: [
          {
            media_id: "photo",
            role: "attachment",
            alt_text: "A photo",
            settings: { crop: "square" },
          },
          { media_id: "new-photo" },
        ],
      },
      {
        id: "reply",
        body: "Keep this reply",
        title: "",
        description: "",
        settings: {},
        media: [{ media_id: "reply-photo", alt_text: "Reply photo" }],
      },
    ],
  });
});

test("explicitly removes photos and updates canonical text even without media changes", () => {
  expect(publicationContentUpdate(publication, "Edited", []).segments?.[0]?.media).toEqual([]);
  expect(publicationContentUpdate(publication, "Edited", ["photo"]).segments?.[0]?.body).toBe(
    "Edited",
  );
});
