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
 */
import { Platform, ScrollView, Switch, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useSettings } from "@/utils/atoms/settings";

const DIM_STEPS = [0, 0.2, 0.4, 0.6, 0.8];
const DOUBLE_TAP_STEPS = [0, 3, 5, 10, 15, 30];

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
