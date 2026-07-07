/*
 * Yomifin "Reader" settings: player-side reading/immersion preferences.
 *
 * Keys live in utils/atoms/settings.ts (Settings + defaultValues):
 *   - yomifinPauseOnLookup: pause the video while a definition popup is open.
 *   - yomifinPopupPosition: which side the fixed popup is anchored to.
 *   - yomifinPopupTheme:    definition popup color theme (light/dark/auto).
 *   - controlsDimOpacity:   how much the video dims when the controls are up.
 *   - yomifinDoubleTapSeconds: double-tap L/R seek amount (0 = off).
 *   - yomifinTwoFingerTapPause: two-finger tap toggles play/pause.
 *   - yomifinDragSeekEnabled: drag anywhere on the video to scrub (Infuse-style).
 *   - yomifinMaxResults:     lookup entry (≈ popup pane) cap, Yomitan default 32.
 *   - yomifinSubtitleFontSize / yomifinSubtitleOutline / yomifinSubtitleBottomOffset:
 *     tappable subtitle overlay styling (runtime, no rebuild).
 *   - yomifinJimakuApiKey:   jimaku.cc API key for online subtitle search.
 */
import {
  Platform,
  ScrollView,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "@/utils/atoms/settings";

const DIM_STEPS = [0, 0.2, 0.4, 0.6, 0.8];
const DOUBLE_TAP_STEPS = [0, 3, 5, 10, 15, 30];
const MAX_RESULTS_STEPS = [4, 8, 16, 32];
const SUB_FONT_STEPS = [24, 28, 32, 38, 44];
const SUB_OFFSET_STEPS = [24, 48, 64, 96, 128];

export default function ReaderSettingsPage() {
  const insets = useSafeAreaInsets();
  const { settings, updateSettings } = useSettings();

  const dim = settings.controlsDimOpacity ?? 0.4;

  return (
    <ScrollView
      contentInsetAdjustmentBehavior='automatic'
      contentContainerStyle={{
        paddingLeft: insets.left,
        paddingRight: insets.right,
      }}
    >
      <View
        className='p-4 flex flex-col'
        style={{ paddingTop: Platform.OS === "android" ? 10 : 0, gap: 20 }}
      >
        {/* Pause on lookup */}
        <Row
          title='Pause on lookup'
          subtitle='Pause playback while a definition popup is open, and resume when you close it.'
        >
          <Switch
            value={settings.yomifinPauseOnLookup ?? true}
            onValueChange={(v) => updateSettings({ yomifinPauseOnLookup: v })}
          />
        </Row>

        {/* Popup position */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Popup position</Text>
          <Text style={styles.subtitle}>
            Which side of the screen the definition popup is anchored to.
          </Text>
          <Segmented
            options={[
              { label: "Left", value: "left" },
              { label: "Right", value: "right" },
            ]}
            value={settings.yomifinPopupPosition ?? "right"}
            onChange={(v) =>
              updateSettings({ yomifinPopupPosition: v as "left" | "right" })
            }
          />
        </View>

        {/* Popup theme */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Popup theme</Text>
          <Text style={styles.subtitle}>
            Color theme for the definition popup. Auto follows the app (dark for
            now).
          </Text>
          <Segmented
            options={[
              { label: "Light", value: "light" },
              { label: "Dark", value: "dark" },
              { label: "Auto", value: "auto" },
            ]}
            value={settings.yomifinPopupTheme ?? "dark"}
            onChange={(v) =>
              updateSettings({
                yomifinPopupTheme: v as "light" | "dark" | "auto",
              })
            }
          />
        </View>

        {/* Lookup result cap */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Max lookup results</Text>
          <Text style={styles.subtitle}>
            How many dictionary entries (popup panes) one tap can return.
            Yomitan's default is 32; lower trims the tail of short-prefix panes
            on dense dictionaries.
          </Text>
          <Segmented
            options={MAX_RESULTS_STEPS.map((s) => ({
              label: String(s),
              value: String(s),
            }))}
            value={String(
              MAX_RESULTS_STEPS.includes(settings.yomifinMaxResults ?? 32)
                ? (settings.yomifinMaxResults ?? 32)
                : 32,
            )}
            onChange={(v) => updateSettings({ yomifinMaxResults: Number(v) })}
          />
        </View>

        {/* Subtitle text size */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Subtitle text size</Text>
          <Text style={styles.subtitle}>
            Font size of the tappable subtitle overlay.
          </Text>
          <Segmented
            options={SUB_FONT_STEPS.map((s) => ({
              label: `${s}`,
              value: String(s),
            }))}
            value={String(
              SUB_FONT_STEPS.includes(settings.yomifinSubtitleFontSize ?? 32)
                ? (settings.yomifinSubtitleFontSize ?? 32)
                : 32,
            )}
            onChange={(v) =>
              updateSettings({ yomifinSubtitleFontSize: Number(v) })
            }
          />
        </View>

        {/* Subtitle weight */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Subtitle weight</Text>
          <Text style={styles.subtitle}>
            Thickness of the subtitle glyphs themselves. Media players like mpv
            default to Regular; heavier weights plus an outline read thick.
          </Text>
          <Segmented
            options={[
              { label: "Regular", value: "400" },
              { label: "Medium", value: "500" },
              { label: "Semibold", value: "600" },
              { label: "Bold", value: "700" },
            ]}
            value={String(settings.yomifinSubtitleWeight ?? 500)}
            onChange={(v) =>
              updateSettings({ yomifinSubtitleWeight: Number(v) })
            }
          />
        </View>

        {/* Subtitle outline */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Subtitle outline</Text>
          <Text style={styles.subtitle}>
            Dark edge around the subtitle text — stronger reads better over
            bright scenes.
          </Text>
          <Segmented
            options={[
              { label: "None", value: "none" },
              { label: "Thin", value: "thin" },
              { label: "Normal", value: "normal" },
              { label: "Strong", value: "strong" },
            ]}
            value={settings.yomifinSubtitleOutline ?? "normal"}
            onChange={(v) =>
              updateSettings({
                yomifinSubtitleOutline: v as
                  | "none"
                  | "thin"
                  | "normal"
                  | "strong",
              })
            }
          />
        </View>

        {/* Subtitle vertical offset */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Subtitle position</Text>
          <Text style={styles.subtitle}>
            Distance of the subtitle overlay from the bottom edge of the screen.
          </Text>
          <Segmented
            options={SUB_OFFSET_STEPS.map((s) => ({
              label: `${s}`,
              value: String(s),
            }))}
            value={String(
              SUB_OFFSET_STEPS.includes(
                settings.yomifinSubtitleBottomOffset ?? 64,
              )
                ? (settings.yomifinSubtitleBottomOffset ?? 64)
                : 64,
            )}
            onChange={(v) =>
              updateSettings({ yomifinSubtitleBottomOffset: Number(v) })
            }
          />
        </View>

        {/* jimaku.cc API key */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>jimaku.cc API key</Text>
          <Text style={styles.subtitle}>
            Enables “Online subtitles (jimaku)” in the player menu — search and
            load Japanese subtitle files, then auto-sync them against the item’s
            own track. Create a key at jimaku.cc → Account.
          </Text>
          <TextInput
            value={settings.yomifinJimakuApiKey ?? ""}
            onChangeText={(v) =>
              updateSettings({ yomifinJimakuApiKey: v.trim() })
            }
            placeholder='API key…'
            placeholderTextColor='#666'
            autoCapitalize='none'
            autoCorrect={false}
            style={{
              backgroundColor: "rgba(255,255,255,0.08)",
              color: "#fff",
              borderRadius: 10,
              paddingHorizontal: 12,
              paddingVertical: 10,
              fontSize: 14,
            }}
          />
        </View>

        {/* AniList title language (Anime discovery tab) */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Anime title language</Text>
          <Text style={styles.subtitle}>
            Which title to show in the AniList discovery tab. jimaku search
            always uses the romaji/native title regardless.
          </Text>
          <Segmented
            options={[
              { label: "Romaji", value: "romaji" },
              { label: "English", value: "english" },
              { label: "Native", value: "native" },
            ]}
            value={settings.anilistTitleLanguage ?? "romaji"}
            onChange={(v) =>
              updateSettings({
                anilistTitleLanguage: v as "romaji" | "english" | "native",
              })
            }
          />
        </View>

        {/* Two-finger tap */}
        <Row
          title='Two-finger tap: play/pause'
          subtitle='Tap the video with two fingers to toggle playback — works whether or not the controls are showing.'
        >
          <Switch
            value={settings.yomifinTwoFingerTapPause ?? true}
            onValueChange={(v) =>
              updateSettings({ yomifinTwoFingerTapPause: v })
            }
          />
        </Row>

        {/* Drag-anywhere seek */}
        <Row
          title='Drag anywhere to seek'
          subtitle='Horizontal drag on the video scrubs like the seek bar, with a trickplay preview when available. Off restores flick-to-skip.'
        >
          <Switch
            value={settings.yomifinDragSeekEnabled ?? true}
            onValueChange={(v) => updateSettings({ yomifinDragSeekEnabled: v })}
          />
        </Row>

        {/* Double-tap seek */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Double-tap seek</Text>
          <Text style={styles.subtitle}>
            Double-tap the left/right half of the video to jump backward/forward
            by this many seconds. Off makes single taps toggle the controls with
            no delay.
          </Text>
          <Segmented
            options={DOUBLE_TAP_STEPS.map((s) => ({
              label: s === 0 ? "Off" : `${s}s`,
              value: String(s),
            }))}
            value={String(
              DOUBLE_TAP_STEPS.includes(settings.yomifinDoubleTapSeconds ?? 10)
                ? (settings.yomifinDoubleTapSeconds ?? 10)
                : 10,
            )}
            onChange={(v) =>
              updateSettings({ yomifinDoubleTapSeconds: Number(v) })
            }
          />
        </View>

        {/* Controls dim */}
        <View style={{ gap: 8 }}>
          <Text style={styles.title}>Controls dim</Text>
          <Text style={styles.subtitle}>
            How much the video darkens when the on-screen controls are visible.
            Lower keeps the frame clearer while scrubbing.
          </Text>
          <Segmented
            options={DIM_STEPS.map((s) => ({
              label: `${Math.round(s * 100)}%`,
              value: String(s),
            }))}
            value={String(nearestStep(dim))}
            onChange={(v) => updateSettings({ controlsDimOpacity: Number(v) })}
          />
        </View>
      </View>
    </ScrollView>
  );
}

function nearestStep(v: number): number {
  return DIM_STEPS.reduce((best, s) =>
    Math.abs(s - v) < Math.abs(best - v) ? s : best,
  );
}

function Row({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
      }}
    >
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      </View>
      {children}
    </View>
  );
}

function Segmented({
  options,
  value,
  onChange,
}: {
  options: { label: string; value: string }[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        backgroundColor: "rgba(255,255,255,0.08)",
        borderRadius: 10,
        padding: 3,
        gap: 3,
      }}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <Text
            key={opt.value}
            onPress={() => onChange(opt.value)}
            style={{
              flex: 1,
              textAlign: "center",
              color: active ? "#001" : "#ddd",
              fontWeight: "700",
              backgroundColor: active ? "#6cb6ff" : "transparent",
              borderRadius: 8,
              paddingVertical: 8,
              overflow: "hidden",
            }}
          >
            {opt.label}
          </Text>
        );
      })}
    </View>
  );
}

const styles = {
  title: { color: "#fff", fontSize: 16, fontWeight: "700" as const },
  subtitle: {
    color: "#888",
    fontSize: 13,
    lineHeight: 18,
    marginTop: 2,
  },
};
