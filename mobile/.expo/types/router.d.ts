/* eslint-disable */
import * as Router from "expo-router";

export * from "expo-router";

declare module "expo-router" {
  export namespace ExpoRouter {
    export interface __routes<T extends string | object = string> {
      hrefInputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/appearance`; params?: Router.UnknownInputParams }
        | { pathname: `/`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/calendar` | `/calendar`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/drafts` | `/drafts`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/queue` | `/queue`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/destination`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/login`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/pair`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/server`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/workspace`; params?: Router.UnknownInputParams }
        | {
            pathname: `/publications/[id]`;
            params: Router.UnknownInputParams & { id: string | number };
          }
        | {
            pathname: `/publications/[id]/edit`;
            params: Router.UnknownInputParams & { id: string | number };
          };
      hrefOutputParams:
        | { pathname: Router.RelativePathString; params?: Router.UnknownOutputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownOutputParams }
        | { pathname: `/appearance`; params?: Router.UnknownOutputParams }
        | { pathname: `/`; params?: Router.UnknownOutputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(tabs)"}/calendar` | `/calendar`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(tabs)"}/drafts` | `/drafts`; params?: Router.UnknownOutputParams }
        | { pathname: `${"/(tabs)"}/queue` | `/queue`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/destination`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/login`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/pair`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/server`; params?: Router.UnknownOutputParams }
        | { pathname: `/onboarding/workspace`; params?: Router.UnknownOutputParams }
        | { pathname: `/publications/[id]`; params: Router.UnknownOutputParams & { id: string } }
        | {
            pathname: `/publications/[id]/edit`;
            params: Router.UnknownOutputParams & { id: string };
          };
      href:
        | Router.RelativePathString
        | Router.ExternalPathString
        | `/appearance${`?${string}` | `#${string}` | ""}`
        | `/${`?${string}` | `#${string}` | ""}`
        | `/_sitemap${`?${string}` | `#${string}` | ""}`
        | `${"/(tabs)"}/calendar${`?${string}` | `#${string}` | ""}`
        | `/calendar${`?${string}` | `#${string}` | ""}`
        | `${"/(tabs)"}/drafts${`?${string}` | `#${string}` | ""}`
        | `/drafts${`?${string}` | `#${string}` | ""}`
        | `${"/(tabs)"}/queue${`?${string}` | `#${string}` | ""}`
        | `/queue${`?${string}` | `#${string}` | ""}`
        | `/onboarding/destination${`?${string}` | `#${string}` | ""}`
        | `/onboarding/login${`?${string}` | `#${string}` | ""}`
        | `/onboarding/pair${`?${string}` | `#${string}` | ""}`
        | `/onboarding/server${`?${string}` | `#${string}` | ""}`
        | `/onboarding/workspace${`?${string}` | `#${string}` | ""}`
        | { pathname: Router.RelativePathString; params?: Router.UnknownInputParams }
        | { pathname: Router.ExternalPathString; params?: Router.UnknownInputParams }
        | { pathname: `/appearance`; params?: Router.UnknownInputParams }
        | { pathname: `/`; params?: Router.UnknownInputParams }
        | { pathname: `/_sitemap`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/calendar` | `/calendar`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/drafts` | `/drafts`; params?: Router.UnknownInputParams }
        | { pathname: `${"/(tabs)"}/queue` | `/queue`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/destination`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/login`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/pair`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/server`; params?: Router.UnknownInputParams }
        | { pathname: `/onboarding/workspace`; params?: Router.UnknownInputParams }
        | `/publications/${Router.SingleRoutePart<T>}${`?${string}` | `#${string}` | ""}`
        | `/publications/${Router.SingleRoutePart<T>}/edit${`?${string}` | `#${string}` | ""}`
        | {
            pathname: `/publications/[id]`;
            params: Router.UnknownInputParams & { id: string | number };
          }
        | {
            pathname: `/publications/[id]/edit`;
            params: Router.UnknownInputParams & { id: string | number };
          };
    }
  }
}
