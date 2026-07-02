/*
 * Phase 8 — cue store (data substrate; Phase 12's sidebar renders this).
 *
 * mpv's live `sub-text` only hands us the CURRENT cue, but the multi-sentence markers
 * need the whole track. `direct-player` loads + parses the full subtitle track once per
 * item/track (Jellyfin Stream.srt → parseSrt; TEXT tracks only — BITMAP/PGS leaves the
 * store empty and everything degrades to the single live cue) and publishes it here.
 *
 * The SELECTED CUE RANGE (default = the tapped cue, span 1; extended via the popup's
 * prev/next affordances) also lives here so Phase 12 can highlight it.
 */
import { atom } from "jotai";
import type { CueRange } from "@/utils/yomifin/cues";
import type { SubtitleCue } from "@/utils/yomifin/srt";

/** Full parsed track for the current item's selected TEXT subtitle ([] = none). */
export const yomifinCuesAtom = atom<SubtitleCue[]>([]);

/** Selected cue range for the in-flight lookup/card (null = no anchor / no track). */
export const yomifinCueRangeAtom = atom<CueRange | null>(null);
