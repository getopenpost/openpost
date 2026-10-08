import type { components } from "@openpost/api-contract";

type Media = Pick<components["schemas"]["MediaSummary"], "id"> &
  Partial<
    Pick<
      components["schemas"]["MediaSummary"],
      "role" | "alt_text" | "thumbnail_timestamp_ms" | "settings"
    >
  >;
type Segment = Omit<components["schemas"]["PublicationSegmentResponse"], "media" | "position"> & {
  media?: readonly Media[] | null;
};
type PublicationContent = {
  source_text: string;
  title?: string;
  source_url?: string;
  segments?: readonly Segment[] | null;
  media?: readonly Media[] | null;
};

function mediaInput(media: Media): components["schemas"]["PublicationMediaInput"] {
  return {
    media_id: media.id,
    ...(media.role === undefined ? {} : { role: media.role }),
    ...(media.alt_text === undefined ? {} : { alt_text: media.alt_text }),
    ...(media.thumbnail_timestamp_ms === undefined
      ? {}
      : { thumbnail_timestamp_ms: media.thumbnail_timestamp_ms }),
    ...(media.settings === undefined ? {} : { settings: media.settings }),
  };
}

export function publicationContentUpdate(
  publication: PublicationContent,
  body: string,
  mediaIds: readonly string[],
): Pick<components["schemas"]["PublicationUpdateBody"], "source_text" | "segments"> {
  const segments = publication.segments?.length
    ? publication.segments
    : [
        {
          body: publication.source_text,
          title: publication.title ?? "",
          description: "",
          url: publication.source_url,
          settings: {},
          media: publication.media,
        },
      ];
  const first = segments[0];
  const initialMedia = first.media ?? [];
  const mediaChanged =
    mediaIds.length !== initialMedia.length ||
    mediaIds.some((id, index) => id !== initialMedia[index]?.id);
  if (body === first.body && !mediaChanged) return { source_text: body };

  return {
    source_text: body,
    segments: segments.map((segment, index) => ({
      ...("id" in segment ? { id: segment.id } : {}),
      body: index === 0 ? body : segment.body,
      title: segment.title,
      description: segment.description,
      ...(segment.url === undefined ? {} : { url: segment.url }),
      settings: segment.settings,
      media:
        index === 0
          ? mediaIds.map((id) => {
              const existing = initialMedia.find((media) => media.id === id);
              return existing ? mediaInput(existing) : { media_id: id };
            })
          : (segment.media ?? []).map(mediaInput),
    })),
  };
}
