import { docsPath } from "@openpost/social-images";

export function BrandMark({ size = 28 }: { size?: number }) {
  return (
    <>
      <img
        src={docsPath("/assets/brand/logo.svg")}
        width={size}
        height={size}
        alt=""
        className="shrink-0 dark:hidden"
      />
      <img
        src={docsPath("/assets/brand/logo-dark.svg")}
        width={size}
        height={size}
        alt=""
        className="hidden shrink-0 dark:block"
      />
    </>
  );
}
