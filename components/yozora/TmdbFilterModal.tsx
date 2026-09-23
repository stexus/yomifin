/*
 * Movie/Show browse filter sheet (TMDB vocabulary — DSC-1): sort / year range /
 * min rating (single select) + genres (multi select). The genre vocabulary is
 * passed in (TMDB_MOVIE_GENRES vs TMDB_TV_GENRES). Note: a text search (q) is
 * mutually exclusive with filters server-side; the section clears q on apply.
 */
import { useEffect, useState } from "react";
import { Modal, Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text } from "@/components/common/Text";
import {
  TMDB_SORT_OPTIONS,
  type TmdbFilters,
  yearOptions,
} from "@/utils/yozora/filters";
import { Chip, Section } from "./FilterChips";

const RATING_OPTIONS = [6, 7, 8];

interface Props {
  visible: boolean;
  initial: TmdbFilters;
  genreVocab: ReadonlyArray<{ id: number; name: string }>;
  onApply: (filters: TmdbFilters) => void;
  onClose: () => void;
}

export default function TmdbFilterModal({
  visible,
  initial,
  genreVocab,
  onApply,
  onClose,
}: Props) {
  const insets = useSafeAreaInsets();
  const [filters, setFilters] = useState<TmdbFilters>(initial);
  const years = yearOptions(new Date(), 40);

  useEffect(() => {
    if (visible) setFilters(initial);
  }, [visible, initial]);

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

  const toggleGenre = (id: number) =>
    setFilters((f) => {
      const cur = f.genreIds ?? [];
      const next = cur.includes(id)
        ? cur.filter((v) => v !== id)
        : [...cur, id];
      return { ...f, genreIds: next };
    });

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
          <Pressable
            onPress={() => setFilters({ sort: "popularity" })}
            hitSlop={8}
          >
            <Text className='text-neutral-400 text-sm'>Reset</Text>
          </Pressable>
        </View>

        <ScrollView showsVerticalScrollIndicator={false}>
          <Section title='Sort' hint='trending ignores other filters'>
            {TMDB_SORT_OPTIONS.map((o) => (
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
              active={!filters.yearMin && !filters.yearMax}
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
                  filters.yearMin != null &&
                  filters.yearMax != null &&
                  y >= filters.yearMin &&
                  y <= filters.yearMax
                }
                onPress={() => onYear(y)}
              />
            ))}
          </Section>

          <Section title='Minimum rating'>
            <Chip
              label='Any'
              active={!filters.minRating}
              onPress={() =>
                setFilters((f) => ({ ...f, minRating: undefined }))
              }
            />
            {RATING_OPTIONS.map((r) => (
              <Chip
                key={r}
                label={`≥ ${r}`}
                active={filters.minRating === r}
                onPress={() =>
                  setFilters((f) => ({
                    ...f,
                    minRating: f.minRating === r ? undefined : r,
                  }))
                }
              />
            ))}
          </Section>

          <Section title='Genres'>
            {genreVocab.map((g) => (
              <Chip
                key={g.id}
                label={g.name}
                active={(filters.genreIds ?? []).includes(g.id)}
                onPress={() => toggleGenre(g.id)}
              />
            ))}
          </Section>
        </ScrollView>

        <Pressable
          className='bg-purple-600 rounded-xl py-3.5 mt-3 items-center'
          onPress={() => onApply({ ...filters, q: undefined })}
        >
          <Text className='text-white font-bold'>Apply filters</Text>
        </Pressable>
      </View>
    </Modal>
  );
}
