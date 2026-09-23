/*
 * Yozora source picker + resolve flow (RES/§8). Opens for one play target
 * (movie or episode):
 *   autoPlay → bare POST /resolve (server auto-picks the best CACHED source);
 *              falls back to the picker on NOTHING_CACHED / any error.
 *   picker   → GET /titles/{key}/sources rows (⚡cached badge, resolution,
 *              quality class, seeders, size, addon attribution); tap a row →
 *              POST /resolve {info_hash} → player.
 * Structured RES-15 error codes render honest states, never a bare spinner.
 */
import { Ionicons } from "@expo/vector-icons";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import useRouter from "@/hooks/useAppRouter";
import type { YozoraClient } from "@/utils/yozora/api";
import { YozoraApiError } from "@/utils/yozora/api";
import { describeSourcesError, sourceMetaLine } from "@/utils/yozora/display";
import type { Source } from "@/utils/yozora/types";
import { pushToPlayer } from "./playback";

export interface PlayTarget {
  /** Canonical episode encoding ("12" / "2:5"); undefined for movies. */
  episode?: string;
  /** Player title, e.g. "Frieren · Episode 12". */
  displayName: string;
  /** Server resume position (seconds). */
  startPositionSec?: number;
  /** Always show the picker, even when auto-play is enabled (the detail
   *  page's "Sources" affordances — user request 2026-07-15). */
  forcePicker?: boolean;
}

interface Props {
  /** Non-null opens the sheet (and kicks off auto-play when enabled). */
  target: PlayTarget | null;
  titleKey: string;
  jimakuQuery: string;
  autoPlay: boolean;
  client: YozoraClient;
  onClose: () => void;
}

export default function SourceSheet({
  target,
  titleKey,
  jimakuQuery,
  autoPlay,
  client,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const [sources, setSources] = useState<Source[] | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "auto" | "listing" | "resolving">(
    "idle",
  );
  const [resolvingHash, setResolvingHash] = useState<string | null>(null);
  // Guards stale async completions after close/retarget.
  const runRef = useRef(0);
  // Callback/router refs so the load effect keys ONLY on the target identity
  // (an unstable onClose prop must not refire the sources fetch).
  const onCloseRef = useRef(onClose);
  const routerRef = useRef(router);
  const jimakuRef = useRef(jimakuQuery);
  onCloseRef.current = onClose;
  routerRef.current = router;
  jimakuRef.current = jimakuQuery;

  useEffect(() => {
    if (!target) {
      setSources(null);
      setNote(null);
      setPhase("idle");
      setResolvingHash(null);
      return;
    }
    const run = ++runRef.current;
    setSources(null);
    setNote(null);
    setResolvingHash(null);

    const loadSources = async (prefixNote: string | null) => {
      setPhase("listing");
      setNote(prefixNote);
      try {
        const res = await client.sources(titleKey, {
          episode: target.episode,
        });
        if (runRef.current !== run) return;
        setSources(res.sources);
        if (res.sources.length === 0 && !prefixNote)
          setNote("No sources found for this title.");
      } catch (e) {
        if (runRef.current !== run) return;
        setSources([]);
        setNote(
          e instanceof YozoraApiError
            ? describeSourcesError(e.code)
            : "Failed to load sources.",
        );
      }
    };

    (async () => {
      if (autoPlay && !target.forcePicker) {
        setPhase("auto");
        try {
          const res = await client.resolve({
            title_key: titleKey,
            episode: target.episode,
          });
          if (runRef.current !== run) return;
          onCloseRef.current();
          pushToPlayer(routerRef.current, res, {
            titleKey,
            episode: target.episode,
            displayName: target.displayName,
            jimakuQuery: jimakuRef.current,
            startPositionSec: target.startPositionSec,
          });
          return;
        } catch (e) {
          if (runRef.current !== run) return;
          const code = e instanceof YozoraApiError ? e.code : "UNKNOWN";
          await loadSources(
            code === "NOTHING_CACHED"
              ? "Nothing cached for auto-play — pick a source:"
              : describeSourcesError(code),
          );
          return;
        }
      }
      await loadSources(null);
    })();
    return () => {
      ++runRef.current;
    };
  }, [target, titleKey, autoPlay, client]);

  const onPick = async (s: Source) => {
    if (!target || resolvingHash) return;
    const run = runRef.current;
    setResolvingHash(s.info_hash);
    setNote(null);
    try {
      const res = await client.resolve({
        title_key: titleKey,
        episode: target.episode,
        info_hash: s.info_hash,
      });
      if (runRef.current !== run) return;
      onClose();
      pushToPlayer(router, res, {
        titleKey,
        episode: target.episode,
        displayName: target.displayName,
        jimakuQuery,
        startPositionSec: target.startPositionSec,
      });
    } catch (e) {
      if (runRef.current !== run) return;
      const code = e instanceof YozoraApiError ? e.code : "UNKNOWN";
      setNote(describeSourcesError(code));
    } finally {
      if (runRef.current === run) setResolvingHash(null);
    }
  };

  return (
    <Modal
      visible={target !== null}
      transparent
      animationType='slide'
      supportedOrientations={[
        "portrait",
        "portrait-upside-down",
        "landscape",
        "landscape-left",
        "landscape-right",
      ]}
      onRequestClose={onClose}
    >
      <Pressable className='flex-1 bg-black/60' onPress={onClose} />
      <View
        className='bg-neutral-900 rounded-t-2xl px-4 pt-4'
        style={{ maxHeight: "70%", paddingBottom: insets.bottom + 16 }}
      >
        <Text className='text-white font-bold mb-1' numberOfLines={1}>
          {target?.displayName ?? ""}
        </Text>
        <Text className='text-neutral-500 text-xs mb-3'>
          {phase === "auto"
            ? "Resolving best cached source…"
            : note
              ? note
              : sources === null
                ? "Loading sources…"
                : `${sources.length} source${sources.length === 1 ? "" : "s"} (server-ranked)`}
        </Text>

        {sources === null ? (
          <ActivityIndicator color='#aaa' style={{ marginVertical: 24 }} />
        ) : (
          <FlatList
            data={sources}
            keyExtractor={(s) => s.info_hash + (s.file_idx ?? "")}
            ListEmptyComponent={
              note ? null : (
                <Text className='text-neutral-500 text-sm py-4'>
                  No sources found.
                </Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                className='bg-neutral-800 rounded-xl px-4 py-3 mb-2'
                onPress={() => onPick(item)}
                disabled={resolvingHash !== null}
                style={{
                  opacity:
                    resolvingHash && resolvingHash !== item.info_hash ? 0.5 : 1,
                }}
              >
                <View className='flex-row items-center'>
                  {item.cached ? (
                    <View className='bg-green-900/60 rounded-md px-1.5 py-0.5 mr-2'>
                      <Text className='text-green-400 text-[11px] font-bold'>
                        ⚡ cached
                      </Text>
                    </View>
                  ) : null}
                  <Text className='text-white text-sm flex-1' numberOfLines={2}>
                    {item.name}
                  </Text>
                  {resolvingHash === item.info_hash ? (
                    <ActivityIndicator
                      size='small'
                      color='#c084fc'
                      style={{ marginLeft: 8 }}
                    />
                  ) : (
                    <Ionicons
                      name='play-circle'
                      size={22}
                      color='#c084fc'
                      style={{ marginLeft: 8 }}
                    />
                  )}
                </View>
                <Text
                  className='text-neutral-400 text-xs mt-1'
                  numberOfLines={1}
                >
                  {sourceMetaLine(item)}
                </Text>
                <Text className='text-neutral-600 text-xs mt-0.5'>
                  via {item.addon}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>
    </Modal>
  );
}
