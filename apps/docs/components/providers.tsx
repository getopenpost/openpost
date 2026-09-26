"use client";
import { RootProvider } from "fumadocs-ui/provider/next";
import { lazy } from "react";
import { Telemetry } from "./telemetry";

const Search = lazy(() => import("./search"));

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <RootProvider
      search={{ SearchDialog: Search, preload: false }}
      theme={{ defaultTheme: "system" }}
    >
      <Telemetry />
      {children}
    </RootProvider>
  );
}
