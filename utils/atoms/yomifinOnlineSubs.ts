/*
 * Online-subtitles modal visibility (jimaku.cc browser + sync panel).
 *
 * An atom instead of prop-threading: the trigger lives in the upstream player
 * dropdown (components/video-player/controls/dropdown/DropdownView.tsx) while the
 * modal is mounted by direct-player — this keeps the upstream diff to two lines.
 * direct-player resets it to false on mount so a stale `true` can't survive
 * navigation.
 */
import { atom } from "jotai";

export const yomifinOnlineSubsVisibleAtom = atom(false);
