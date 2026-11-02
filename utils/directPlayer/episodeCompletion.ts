import { NEXT_EPISODE_COUNTDOWN_MS } from "@/constants/Playback";

export function shouldOfferEpisodeCompletion({
  isEpisode,
  hasNextEpisode,
  controlsVisible,
  outroActive,
  durationMs,
  remainingMs,
}: {
  isEpisode: boolean;
  hasNextEpisode: boolean;
  controlsVisible: boolean;
  outroActive: boolean;
  durationMs: number;
  remainingMs: number;
}) {
  return (
    isEpisode &&
    hasNextEpisode &&
    (controlsVisible ||
      outroActive ||
      (durationMs > 0 && remainingMs < NEXT_EPISODE_COUNTDOWN_MS))
  );
}

interface CompletionSteps {
  pause: () => Promise<unknown>;
  stop: () => Promise<unknown>;
  markPlayed: () => Promise<unknown>;
  /** Reopen the paused session if saving watched state failed after Stop. */
  restore: () => Promise<unknown>;
}

/** Per-item barrier: no outgoing progress may overwrite an explicit completion. */
export class EpisodeCompletion {
  private reports = new Set<Promise<unknown>>();
  private finishing = false;
  private completed = false;

  get blocked() {
    return this.finishing || this.completed;
  }

  async report(send: () => Promise<unknown>): Promise<void> {
    if (this.finishing || this.completed) return;
    const request = send();
    this.reports.add(request);
    try {
      await request;
    } finally {
      this.reports.delete(request);
    }
  }

  async finish(steps: CompletionSteps): Promise<boolean> {
    if (this.finishing || this.completed) return false;
    this.finishing = true;
    let stopped = false;
    try {
      await steps.pause();
      await Promise.allSettled([...this.reports]);
      await steps.stop();
      stopped = true;
      await steps.markPlayed();
      this.completed = true;
      return true;
    } catch (error) {
      if (stopped) await steps.restore();
      throw error;
    } finally {
      this.finishing = false;
    }
  }
}
