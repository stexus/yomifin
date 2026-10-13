/*
 * Content-derived media keys (pure, RN-free, bun-testable).
 *
 * Mining several words from one sentence must share ONE .m4a + ONE .jpg. The only
 * reason duplicates existed was the `card_${Date.now()}` base name — so filenames are
 * now derived from the media CONTENT identity instead:
 *
 *   image key = hash(source identity | framePos quantized to 250ms)
 *   audio key = hash(source identity | audio track | cueStart | cueEnd)
 *   word key  = hash(term | reading)
 *
 * The audio key uses the SELECTED cue range, so a 1-line and a 2-line selection get
 * different clips, while two words mined from the same line share the same file.
 * `storeMediaFile` is idempotent by filename, so same key ⇒ same Anki media file.
 */

/** 32-bit FNV-1a over a string, as 8 hex chars. Cheap and stable across sessions. */
export function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619 (FNV prime), in 32-bit space without BigInt.
    hash =
      (hash +
        (hash << 1) +
        (hash << 4) +
        (hash << 7) +
        (hash << 8) +
        (hash << 24)) >>>
      0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Quantize seconds to 250ms steps so float jitter can't split identical captures. */
export function quantizeSec(sec: number): number {
  return Math.round(sec * 4) / 4;
}

/** Key for the captured frame (same item + same quantized position ⇒ same file). */
export function imageMediaKey(sourceId: string, framePos: number): string {
  return fnv1a(
    JSON.stringify(["capture-v2", sourceId, "img", quantizeSec(framePos)]),
  );
}

/** Key for the audio clip — spans the SELECTED cue range, not just the tapped cue. */
export function audioMediaKey(
  sourceId: string,
  cueStart: number,
  cueEnd: number,
  audioId: number,
): string {
  return fnv1a(
    JSON.stringify([
      "capture-v2",
      sourceId,
      "aud",
      audioId,
      quantizeSec(cueStart),
      quantizeSec(cueEnd),
    ]),
  );
}

/** Key for word audio (same term+reading ⇒ same fetched clip / same Anki file). */
export function wordAudioKey(term: string, reading: string): string {
  return fnv1a(`${term}|${reading}`);
}
