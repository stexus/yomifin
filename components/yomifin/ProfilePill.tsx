/*
 * Profile pill — the in-controls indicator of the ACTIVE lookup profile (JA/ZH).
 *
 * Rendered inside the player top bars (next to the other header controls, so it
 * shows exactly when the controls do). Shows "JA · auto" / "ZH · auto" when the
 * profile came from auto-selection (track language / manual default) and a plain
 * "JA" / "ZH" when a per-title manual override is active.
 *
 *   tap        → switch to the other profile, remembered PER TITLE
 *                (Settings.yomifinProfileOverrides[profileKey]); without a key it
 *                flips the app-wide active profile instead
 *   long-press → clear the per-title override (back to automatic selection)
 *
 * Selection precedence lives in utils/yomifin/profiles.ts
 * (resolveEffectiveProfileId: override > track-language hint > manual default).
 */
import { Pressable, StyleSheet, Text } from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import {
  type ProfileId,
  resolveEffectiveProfileId,
} from "@/utils/yomifin/profiles";

interface Props {
  /** Stable per-title key (Jellyfin SeriesId/ItemId, `yozora:<name>`). */
  profileKey?: string;
  /** Track-language auto-selection hint (same value the lookup layer gets). */
  languageHint?: ProfileId | null;
}

export default function ProfilePill({ profileKey, languageHint }: Props) {
  const { settings, updateSettings } = useSettings();
  const profileId = resolveEffectiveProfileId(
    settings,
    languageHint,
    profileKey,
  );
  const overridden = Boolean(
    profileKey && settings.yomifinProfileOverrides?.[profileKey],
  );

  const switchProfile = () => {
    const next: ProfileId = profileId === "ja" ? "zh" : "ja";
    if (profileKey) {
      updateSettings({
        yomifinProfileOverrides: {
          ...(settings.yomifinProfileOverrides ?? {}),
          [profileKey]: next,
        },
      });
    } else {
      updateSettings({ yomifinActiveProfile: next });
    }
  };

  const clearProfileOverride = () => {
    if (!profileKey || !overridden) return;
    const map = { ...(settings.yomifinProfileOverrides ?? {}) };
    delete map[profileKey];
    updateSettings({ yomifinProfileOverrides: map });
  };

  return (
    <Pressable
      style={styles.pill}
      onPress={switchProfile}
      onLongPress={clearProfileOverride}
      hitSlop={8}
    >
      <Text style={styles.text}>
        {profileId.toUpperCase()}
        <Text style={styles.mode}>{overridden ? "" : " · auto"}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: "center",
    backgroundColor: "rgba(0,0,0,0.55)",
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  text: { color: "#fff", fontSize: 12, fontWeight: "700" },
  mode: { color: "#aaa", fontWeight: "400" },
});
