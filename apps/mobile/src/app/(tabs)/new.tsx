import { Redirect } from "expo-router";

/**
 * New is the compose entry, not a destination of its own. It opens the same
 * quick-capture compose route the calendar and drafts entry use, so the tab
 * bar settles on Posts while the composer takes focus.
 */
export default function NewScreen() {
  return <Redirect href={{ pathname: "/(tabs)/posts", params: { view: "drafts" } }} />;
}
