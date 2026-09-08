import type { Metadata } from "next";
import { Providers } from "@/components/providers";
import "@fontsource-variable/geist";
import "./global.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://docs.openpo.st"),
  title: { template: "%s | OpenPost Docs", default: "OpenPost Docs" },
  description:
    "Connect your accounts, publish your first post, and keep your content moving with OpenPost.",
  icons: { icon: "/assets/brand/icon.svg" },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
