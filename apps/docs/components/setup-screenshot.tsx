import { ImageZoom } from "fumadocs-ui/components/image-zoom";

type SetupScreenshotProps = {
  src: string;
  darkSrc?: string;
  alt: string;
  width: number;
  height: number;
  caption: string;
  sourceUrl?: string;
  edited?: boolean;
};

export function SetupScreenshot({
  src,
  darkSrc,
  alt,
  width,
  height,
  caption,
  sourceUrl,
  edited,
}: SetupScreenshotProps) {
  return (
    <figure className="setup-screenshot">
      <div className={darkSrc ? "dark:hidden" : undefined}>
        <ImageZoom src={src} alt={alt} width={width} height={height} loading="lazy" />
      </div>
      {darkSrc && (
        <div className="hidden dark:block">
          <ImageZoom src={darkSrc} alt={alt} width={width} height={height} loading="lazy" />
        </div>
      )}
      <figcaption>
        {caption}{" "}
        {sourceUrl && (
          <>
            <a href={sourceUrl}>Screenshot from Postiz's guide</a>.
            {edited && " Example values edited with AI."}
            {" Portal layouts may change."}
          </>
        )}
      </figcaption>
    </figure>
  );
}
