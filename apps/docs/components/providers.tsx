"use client";
import { RootProvider } from "fumadocs-ui/provider/next";
import { Telemetry } from "./telemetry";
import Search from "./search";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider search={{ SearchDialog: Search }} theme={{ defaultTheme: "system" }}>
      <Telemetry />
      {children}
    </RootProvider>
  );
}
