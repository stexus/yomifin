/*
 * Anime browse filter sheet (Yozora vocabulary — DSC-2 + Phase 2-pre
 * amendments): sort / year range / season / status / format (single select) +
 * genres / grouped tags (multi select) as chip groups. Mirrors the old AniList
 * filter modal one-for-one; only the data model changed (AnimeFilters →
 * GET /discover/anime).
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import {
  ANIME_FORMAT_OPTIONS,
  ANIME_SEASON_OPTIONS,
  ANIME_SORT_OPTIONS,
  ANIME_STATUS_OPTIONS,
  type AnimeFilters,
  yearOptions,
} from "@/utils/yozora/filters";
import { ANILIST_GENRES, ANILIST_TAG_GROUPS } from "@/utils/yozora/types";
import { Chip, Section } from "./FilterChips";

interface Props {
  visible: boolean;
  initial: AnimeFilters;
  onApply: (filters: AnimeFilters) => void;
  onClose: () => void;
}

export default function AnimeFilterModal({
  visible,
  initial,
  onApply,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<AnimeFilters>(initial);
  const years = yearOptions();

  // Re-seed local state each time the sheet re-opens with fresh filters.
  useEffect(() => {
    if (visible) setFilters(initial);
  }, [visible, initial]);

  const yearMin = filters.yearMin;
  const yearMax = filters.yearMax;

  // Year taps build a contiguous range: 1st tap = single year; 2nd (different)
  // tap = span between them; tapping the lone selected year clears it; tapping
  // when a range already exists resets to that single year.
  const onYear = (y: number) =>
    setFilters((f) => {
      const from = f.yearMin;
      const to = f.yearMax;
      if (from == null || to == null) return { ...f, yearMin: y, yearMax: y };
      if (from === to)
        return y === from
          ? { ...f, yearMin: undefined, yearMax: undefined }
          : { ...f, yearMin: Math.min(from, y), yearMax: Math.max(from, y) };
      return { ...f, yearMin: y, yearMax: y };
    });

  const toggleMulti = (key: "genres" | "tags", value: string) => {
    setFilters((f) => {
      const cur = f[key] ?? [];
      const next = cur.includes(value)
        ? cur.filter((v) => v !== value)
        : [...cur, value];
      return { ...f, [key]: next };
    });
  };

  const reset = () =>
    setFilters((f) =>
      f.q ? { q: f.q, sort: undefined } : { sort: "popularity" },
    );

  return (
    <Modal
      visible={visible}
      transparent
      animationType='slide'
      supportedOrientations={[
        "portrait",
        "landscape",
        "landscape-left",
        "landscape-right",
      ]}
      onRequestClose={onClose}
    >
      <Pressable className='flex-1 bg-black/60' onPress={onClose} />
      <View
        className='bg-neutral-900 rounded-t-2xl px-4 pt-4'
        style={{ maxHeight: "82%", paddingBottom: insets.bottom + 12 }}
      >
        <View className='flex-row items-center justify-between mb-4'>
          <Text className='text-white text-lg font-bold'>Filters</Text>
          <Pressable onPress={reset} hitSlop={8}>
            <Text className='text-neutral-400 text-sm'>Reset</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Section title='Sort'>
            {ANIME_SORT_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                active={(filters.sort ?? "popularity") === o.value}
                onPress={() => setFilters((f) => ({ ...f, sort: o.value }))}
              />
            ))}
          </Section>

          <Section title='Year' hint='tap two for a range'>
            <Chip
              label='Any'
              active={!yearMin && !yearMax}
              onPress={() =>
                setFilters((f) => ({
                  ...f,
                  yearMin: undefined,
                  yearMax: undefined,
                }))
              }
            />
            {years.map((y) => (
              <Chip
                key={y}
                label={String(y)}
                active={
                  yearMin != null &&
                  yearMax != null &&
                  y >= yearMin &&
                  y <= yearMax
                }
                onPress={() => onYear(y)}
              />
            ))}
          </Section>

          <Section title='Season'>
            <Chip
              label='Any'
              active={!filters.season}
              onPress={() => setFilters((f) => ({ ...f, season: undefined }))}
            />
            {ANIME_SEASON_OPTIONS.map((s) => (
              <Chip
                key={s.value}
                label={s.label}
                active={filters.season === s.value}
                onPress={() =>
                  setFilters((f) => ({
                    ...f,
                    season: f.season === s.value ? undefined : s.value,
                  }))
                }
              />
            ))}
          </Section>

          <Section title='Airing Status'>
            <Chip
              label='Any'
              active={!filters.status}
              onPress={() => setFilters((f) => ({ ...f, status: undefined }))}
            />
            {ANIME_STATUS_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                active={filters.status === o.value}
                onPress={() =>
                  setFilters((f) => ({
                    ...f,
                    status: f.status === o.value ? undefined : o.value,
                  }))
                }
              />
            ))}
          </Section>

          <Section title='Format'>
            <Chip
              label='Any'
              active={!filters.format}
              onPress={() => setFilters((f) => ({ ...f, format: undefined }))}
            />
            {ANIME_FORMAT_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                active={filters.format === o.value}
                onPress={() =>
                  setFilters((f) => ({
                    ...f,
                    format: f.format === o.value ? undefined : o.value,
                  }))
                }
              />
            ))}
          </Section>

          <Section title='Genres'>
            {ANILIST_GENRES.map((g) => (
              <Chip
                key={g}
                label={g}
                active={(filters.genres ?? []).includes(g)}
                onPress={() => toggleMulti("genres", g)}
              />
            ))}
          </Section>

          {ANILIST_TAG_GROUPS.map((group) => (
            <Section key={group.group} title={`Tags · ${group.group}`}>
              {group.tags.map((t) => (
                <Chip
                  key={t}
                  label={t}
                  active={(filters.tags ?? []).includes(t)}
                  onPress={() => toggleMulti("tags", t)}
                />
              ))}
            </Section>
          ))}
        </ScrollView>

        <Pressable
          className='bg-purple-600 rounded-xl py-3.5 mt-3 items-center'
          onPress={() => onApply(filters)}
        >
          <Text className='text-white font-bold'>Apply filters</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
