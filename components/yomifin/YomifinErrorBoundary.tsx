/*
 * Error isolation for the yomifin language layer.
 *
 * The tappable-subtitle overlay, lookup, and structured-content renderer are
 * experimental and run over real, messy dictionary data. A render/lifecycle error in
 * any of them must NOT propagate to the host app's root (which would crash ExpoRoot /
 * the navigator and freeze the whole player). This boundary catches such errors,
 * logs them, and renders nothing — playback and the rest of the UI keep working.
 */
import { Component, type ReactNode } from "react";

interface Props {
  children: ReactNode;
  /** Label for logs so we know which boundary fired. */
  label?: string;
}

interface State {
  hasError: boolean;
}

export default class YomifinErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error(
      `[YOMIFIN] error boundary (${this.props.label ?? "layer"}) caught — overlay disabled for this screen:`,
      error,
      info,
    );
  }

  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}
