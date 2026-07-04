import type React from "react";
import type { ViewProps } from "react-native";
import { Switch } from "react-native";
import { useSettings } from "@/utils/atoms/settings";
import { ListGroup } from "../list/ListGroup";
import { ListItem } from "../list/ListItem";

interface Props extends ViewProps {}

/**
 * Player UI (senplayer-style rework): the custom OSD status bar.
 *
 * The "show …" toggles control which items appear DURING REGULAR PLAYBACK (control
 * pane hidden). When the control pane is up, the full status bar always shows.
 */
export const PlayerUISettings: React.FC<Props> = ({ ...props }) => {
  const { settings, updateSettings } = useSettings();

  if (!settings) return null;

  const persistent = settings.playerStatusBarDuringPlayback ?? true;

  return (
    <ListGroup title='Player status bar' {...props}>
      <ListItem
        title='Show during playback'
        subtitle='Keep a subtle status bar visible while the controls are hidden'
      >
        <Switch
          value={persistent}
          onValueChange={(playerStatusBarDuringPlayback) =>
            updateSettings({ playerStatusBarDuringPlayback })
          }
        />
      </ListItem>

      <ListItem title='Clock' subtitle='System time' disabled={!persistent}>
        <Switch
          value={settings.playerStatusShowClock}
          disabled={!persistent}
          onValueChange={(playerStatusShowClock) =>
            updateSettings({ playerStatusShowClock })
          }
        />
      </ListItem>

      <ListItem title='12-hour clock' subtitle='Off = 24-hour time'>
        <Switch
          value={settings.playerClock12Hour}
          onValueChange={(playerClock12Hour) =>
            updateSettings({ playerClock12Hour })
          }
        />
      </ListItem>

      <ListItem title='Date' disabled={!persistent}>
        <Switch
          value={settings.playerStatusShowDate}
          disabled={!persistent}
          onValueChange={(playerStatusShowDate) =>
            updateSettings({ playerStatusShowDate })
          }
        />
      </ListItem>

      <ListItem title='Battery' disabled={!persistent}>
        <Switch
          value={settings.playerStatusShowBattery}
          disabled={!persistent}
          onValueChange={(playerStatusShowBattery) =>
            updateSettings({ playerStatusShowBattery })
          }
        />
      </ListItem>

      <ListItem
        title='Connection'
        subtitle='Wi-Fi / cellular indicator'
        disabled={!persistent}
      >
        <Switch
          value={settings.playerStatusShowWifi}
          disabled={!persistent}
          onValueChange={(playerStatusShowWifi) =>
            updateSettings({ playerStatusShowWifi })
          }
        />
      </ListItem>

      <ListItem
        title='Network usage'
        subtitle='Current stream throughput'
        disabled={!persistent}
      >
        <Switch
          value={settings.playerStatusShowNetwork}
          disabled={!persistent}
          onValueChange={(playerStatusShowNetwork) =>
            updateSettings({ playerStatusShowNetwork })
          }
        />
      </ListItem>
    </ListGroup>
  );
};
