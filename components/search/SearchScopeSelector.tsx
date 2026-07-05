/*
 * Unified-search scope selector: Jellyfin · Stremio · Both. Cross-platform pill
 * segmented control (no @expo/ui dep so it's safe on every target). Persisted by
 * the caller into Settings.searchScope.
 */
import { Pressable, View } from "react-native";
import { Text } from "@/components/common/Text";

export type SearchScope = "jellyfin" | "stremio" | "both";

const OPTIONS: { key: SearchScope; label: string }[] = [
  { key: "jellyfin", label: "Jellyfin" },
  { key: "stremio", label: "Stremio" },
  { key: "both", label: "Both" },
];

interface Props {
  scope: SearchScope;
  onChange: (scope: SearchScope) => void;
}

export function SearchScopeSelector({ scope, onChange }: Props) {
  return (
    <View className='flex-row bg-neutral-900 rounded-xl p-1 self-start'>
      {OPTIONS.map((o) => {
        const active = o.key === scope;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            className={`px-4 py-1.5 rounded-lg ${active ? "bg-purple-600" : ""}`}
            hitSlop={4}
          >
            <Text
              className={`text-sm ${active ? "text-white font-semibold" : "text-neutral-400"}`}
            >
              {o.label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** Small provenance chip shown on each search result (Jellyfin / Stremio). */
export function SourceBadge({
  source,
  detail,
}: {
  source: "jellyfin" | "stremio";
  detail?: string;
}) {
  const bg = source === "jellyfin" ? "bg-sky-600/80" : "bg-purple-600/80";
  const label = source === "jellyfin" ? "Jellyfin" : "Stremio";
  return (
    <View
      className={`absolute top-1 left-1 rounded-md px-1.5 py-0.5 ${bg}`}
      style={{ maxWidth: "90%" }}
    >
      <Text className='text-white text-[10px] font-semibold' numberOfLines={1}>
        {detail ? `${label} · ${detail}` : label}
      </Text>
    </View>
  );
}
