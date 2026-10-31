import { View } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import { useShareIntentContext } from "expo-share-intent";
import DraftsScreen from "@/screens/posts-drafts";
import CalendarScreen from "@/screens/posts-calendar";
import QueueScreen from "@/screens/posts-queue";
import { Segments } from "@/components/segments";
import { useRememberedView } from "@/lib/use-remembered-view";
import { useWorkspaceId } from "@/lib/queries";

const POSTS_VIEWS = ["drafts", "calendar", "queue"] as const;
type PostsView = (typeof POSTS_VIEWS)[number];
function isPostsView(value: unknown): value is PostsView {
  return (POSTS_VIEWS as readonly string[]).includes(value as string);
}
export default function PostsScreen() {
  const params = useLocalSearchParams<{ view?: string }>();
  const workspaceId = useWorkspaceId();
  const { hasShareIntent } = useShareIntentContext();
  const { value: remembered, select: rememberView } = useRememberedView({
    allowedValues: POSTS_VIEWS,
    key: `posts-view-${workspaceId ?? "default"}`,
  });
  const view = hasShareIntent ? "drafts" : isPostsView(params.view) ? params.view : remembered;
  const navigation = (
    <View style={{ paddingHorizontal: 16, paddingVertical: 8 }}>
      <Segments
        values={[
          { value: "drafts", label: "Drafts" },
          { value: "calendar", label: "Calendar" },
          { value: "queue", label: "Queue" },
        ]}
        selected={view}
        onSelect={(value) => {
          rememberView(value);
          router.setParams({ view: value });
        }}
      />
    </View>
  );
  return view === "calendar" ? (
    <CalendarScreen navigation={navigation} />
  ) : view === "queue" ? (
    <QueueScreen navigation={navigation} />
  ) : (
    <DraftsScreen navigation={navigation} />
  );
}
