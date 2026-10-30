import { useState } from "react";
import { FlatList, RefreshControl, View } from "react-native";
import { useQuery } from "@tanstack/react-query";
import { mediaListQueryOptions } from "@openpost/query-catalog";
import { Screen, BodyText, Button, ContentTitle, EmptyState, TextField } from "@/components/ui";
import { WorkspaceHeader } from "@/components/workspace-header";
import { MediaImage } from "@/components/media-image";
import { Segments } from "@/components/segments";
import { DelayedQueryPlaceholder, InitialQueryError, QueryNotice } from "@/components/query-state";
import { mobileMediaAPI } from "@/lib/inbox/api";
import { useWorkspaceId } from "@/lib/queries";
import { useNativeTheme } from "@/theme";

export default function MediaScreen() {
  const workspaceId = useWorkspaceId() ?? "";
  const { colors, spacing } = useNativeTheme().manifest;
  const [search, setSearch] = useState("");
  const [type, setType] = useState<"" | "image" | "video" | "audio">("");
  const [offset, setOffset] = useState(0);
  const media = useQuery(
    mediaListQueryOptions(mobileMediaAPI, workspaceId, {
      search,
      type,
      limit: 40,
      offset,
      lifecycle: "library",
    }),
  );
  const hasMediaData = media.data !== undefined;
  return (
    <Screen>
      <WorkspaceHeader />
      <View style={{ paddingHorizontal: spacing.large, paddingBottom: 12, gap: 12 }}>
        <TextField
          accessibilityLabel="Search media library"
          placeholder="Search media"
          value={search}
          onChangeText={(value) => {
            setSearch(value);
            setOffset(0);
          }}
        />
        <Segments
          values={[
            { value: "", label: "All" },
            { value: "image", label: "Images" },
            { value: "video", label: "Video" },
            { value: "audio", label: "Audio" },
          ]}
          selected={type}
          onSelect={(value) => {
            setType(value);
            setOffset(0);
          }}
        />
      </View>
      <FlatList
        data={media.data?.media ?? []}
        keyExtractor={(item) => item.id}
        contentContainerStyle={{ paddingHorizontal: spacing.large, paddingBottom: 32, gap: 12 }}
        refreshControl={
          <RefreshControl
            refreshing={media.isRefetching}
            onRefresh={() => void media.refetch()}
            tintColor={colors.onSurfaceVariant}
          />
        }
        ListHeaderComponent={
          <>
            <DelayedQueryPlaceholder pending={!hasMediaData && media.isPending} />
            {media.isError && !hasMediaData ? (
              <InitialQueryError
                title="Could not load media"
                message={
                  media.error instanceof Error
                    ? media.error.message
                    : "Check your connection and try again."
                }
                retry={() => void media.refetch()}
              />
            ) : null}
            {media.isError && hasMediaData ? (
              <QueryNotice
                message="Could not refresh media. The current library remains visible."
                retry={() => void media.refetch()}
              />
            ) : null}
            {media.data ? (
              <BodyText>
                {media.data.total} {media.data.total === 1 ? "item" : "items"}
              </BodyText>
            ) : null}
          </>
        }
        ListEmptyComponent={
          !media.isPending && !media.isError ? (
            <EmptyState
              iconRole="videoProjects"
              title="No media found"
              body="Uploaded and saved assets appear in your Workspace library."
            />
          ) : null
        }
        ListFooterComponent={
          <View style={{ flexDirection: "row", gap: 8 }}>
            {offset > 0 ? (
              <Button
                title="Previous"
                intent="ordinary"
                onPress={() => setOffset(Math.max(0, offset - 40))}
                style={{ flex: 1 }}
              />
            ) : null}
            {offset + 40 < (media.data?.total ?? 0) ? (
              <Button
                title="Next"
                intent="ordinary"
                onPress={() => setOffset(offset + 40)}
                style={{ flex: 1 }}
              />
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={{
              flexDirection: "row",
              gap: 12,
              alignItems: "center",
              minHeight: 88,
              borderBottomWidth: 1,
              borderBottomColor: colors.outlineVariant,
              paddingBottom: 12,
            }}
          >
            {item.mime_type.startsWith("image/") || item.mime_type.startsWith("video/") ? (
              <MediaImage
                uri={item.url}
                size="sm"
                accessibilityLabel={item.alt_text || item.original_filename}
                contentFit="cover"
                style={{ width: 76, height: 76, borderRadius: 10 }}
              />
            ) : null}
            <View style={{ flex: 1, gap: 6 }}>
              <ContentTitle numberOfLines={2}>
                {item.original_filename || "Untitled media"}
              </ContentTitle>
              <BodyText>
                {item.mime_type} · {Math.ceil(item.size / 1024)} KB
              </BodyText>
              {item.processing_status && item.processing_status !== "ready" ? (
                <BodyText>{item.processing_status}</BodyText>
              ) : null}
            </View>
          </View>
        )}
      />
    </Screen>
  );
}
