/** Recheck eligibility at fire time as well as when scheduling. */
export function createControlsTimer(
  canHide: () => boolean,
  hide: () => void,
  delay: () => number,
  schedule: (callback: () => void, ms: number) => () => void = (
    callback,
    ms,
  ) => {
    const timer = setTimeout(callback, ms);
    return () => clearTimeout(timer);
  },
) {
  let cancel: (() => void) | undefined;
  const clear = () => {
    cancel?.();
    cancel = undefined;
  };
  const reset = () => {
    clear();
    if (!canHide()) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (canHide()) hide();
    }, delay());
  };
  return { reset, clear };
}
