/*
 * Browse filter sheet for the AniList grid: sort / season+year / format (single
 * select) + genres / tags (multi select) as chip groups. AniList's TAG system is
 * the real discovery win, so tags get equal billing with genres.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import {
  type BrowseFilters,
  FORMAT_OPTIONS,
  GENRE_OPTIONS,
  SEASON_OPTIONS,
  SORT_OPTIONS,
  STATUS_OPTIONS,
  TAG_OPTIONS,
  yearOptions,
} from "@/utils/anilist/client";

interface Props {
  visible: boolean;
  initial: BrowseFilters;
  onApply: (filters: BrowseFilters) => void;
  onClose: () => void;
}

function Chip({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={{
        paddingHorizontal: 12,
        paddingVertical: 7,
        borderRadius: 999,
        marginRight: 8,
        marginBottom: 8,
        backgroundColor: active ? "#9334E9" : "#232323",
        borderWidth: 1,
        borderColor: active ? "#9334E9" : "#333",
      }}
    >
      <Text
        style={{
          color: active ? "white" : "#bbb",
          fontSize: 13,
          fontWeight: active ? "600" : "400",
        }}
      >
        {label}
      </Text>
    </Pressable>
  );
}

function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View className='mb-4'>
      <View className='flex-row items-baseline mb-2'>
        <Text className='text-neutral-400 text-xs font-semibold uppercase'>
          {title}
        </Text>
        {hint ? (
          <Text className='text-neutral-600 text-[11px] ml-2 lowercase'>
            {hint}
          </Text>
        ) : null}
      </View>
      <View className='flex-row flex-wrap'>{children}</View>
    </View>
  );
}

export default function AnimeFilterModal({
  visible,
  initial,
  onApply,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<BrowseFilters>(initial);
  const years = yearOptions();

  // Re-seed local state each time the sheet re-opens with fresh filters. A preset
  // seeded with a single seasonYear is normalized into the [from,to] range model.
  useEffect(() => {
    if (!visible) return;
    if (initial.seasonYear && !initial.yearFrom && !initial.yearTo) {
      setFilters({
        ...initial,
        seasonYear: undefined,
        yearFrom: initial.seasonYear,
        yearTo: initial.seasonYear,
      });
    } else {
      setFilters(initial);
    }
  }, [visible, initial]);

  const yearFrom = filters.yearFrom;
  const yearTo = filters.yearTo;

  // Year taps build a contiguous range: 1st tap = single year; 2nd (different)
  // tap = span between them; tapping the lone selected year clears it; tapping
  // when a range already exists resets to that single year.
  const onYear = (y: number) =>
    setFilters((f) => {
      const from = f.yearFrom;
      const to = f.yearTo;
      if (from == null || to == null)
        return { ...f, yearFrom: y, yearTo: y, seasonYear: undefined };
      if (from === to)
        return y === from
          ? { ...f, yearFrom: undefined, yearTo: undefined }
          : {
              ...f,
              yearFrom: Math.min(from, y),
              yearTo: Math.max(from, y),
              seasonYear: undefined,
            };
      return { ...f, yearFrom: y, yearTo: y, seasonYear: undefined };
    });

  const sortKey = (s?: string[]) => (s ?? []).join(",");
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
      f.search
        ? { search: f.search, sort: ["SEARCH_MATCH"] }
        : { sort: ["POPULARITY_DESC"] },
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
            {SORT_OPTIONS.map((o) => (
              <Chip
                key={o.label}
                label={o.label}
                active={sortKey(filters.sort) === sortKey(o.value)}
                onPress={() => setFilters((f) => ({ ...f, sort: o.value }))}
              />
            ))}
          </Section>

          <Section title='Year' hint='tap two for a range'>
            <Chip
              label='Any'
              active={!yearFrom && !yearTo}
              onPress={() =>
                setFilters((f) => ({
                  ...f,
                  yearFrom: undefined,
                  yearTo: undefined,
                  seasonYear: undefined,
                }))
              }
            />
            {years.map((y) => (
              <Chip
                key={y}
                label={String(y)}
                active={
                  yearFrom != null &&
                  yearTo != null &&
                  y >= yearFrom &&
                  y <= yearTo
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
            {SEASON_OPTIONS.map((s) => (
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
            {STATUS_OPTIONS.map((o) => (
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
              active={!filters.formats || filters.formats.length === 0}
              onPress={() => setFilters((f) => ({ ...f, formats: [] }))}
            />
            {FORMAT_OPTIONS.map((o) => (
              <Chip
                key={o.value}
                label={o.label}
                active={(filters.formats ?? []).includes(o.value)}
                onPress={() =>
                  setFilters((f) => ({ ...f, formats: [o.value] }))
                }
              />
            ))}
          </Section>

          <Section title='Genres'>
            {GENRE_OPTIONS.map((g) => (
              <Chip
                key={g}
                label={g}
                active={(filters.genres ?? []).includes(g)}
                onPress={() => toggleMulti("genres", g)}
              />
            ))}
          </Section>

          <Section title='Tags'>
            {TAG_OPTIONS.map((t) => (
              <Chip
                key={t}
                label={t}
                active={(filters.tags ?? []).includes(t)}
                onPress={() => toggleMulti("tags", t)}
              />
            ))}
          </Section>
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
