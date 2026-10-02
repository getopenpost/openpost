"use client";

import { docsPath } from "@openpost/social-images";
import { FrameworkProvider } from "fumadocs-core/framework";
import { ViewOptionsPopover } from "fumadocs-ui/layouts/docs/page";
import { useParams, usePathname, useRouter } from "next/navigation";
import type { ComponentProps } from "react";

function useDocumentationPathname() {
  return docsPath(usePathname());
}

export function PageOptions(props: ComponentProps<typeof ViewOptionsPopover>) {
  return (
    <FrameworkProvider
      useParams={useParams}
      useRouter={useRouter}
      usePathname={useDocumentationPathname}
    >
      <ViewOptionsPopover {...props} />
    </FrameworkProvider>
  );
}
