import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "./ui/button";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/**
 * Last-resort guard against a render-time throw. Most of the overview payload's fields
 * are `T | null`, so a single unguarded access anywhere below `<main>` would otherwise
 * unmount the whole app to a white screen with no path back.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("ErrorBoundary caught:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error) {
      return (
        <div className="mx-auto max-w-[1400px] px-4 py-8 md:px-8">
          <div className="rounded-nb border-[3px] border-edge bg-bad p-4 text-black shadow-[var(--nb-shadow)] md:p-6">
            <h2 className="mb-1 font-bold">something went wrong</h2>
            <p className="mb-3 text-sm">{error.message}</p>
            <Button
              type="button"
              variant="neutral"
              size="sm"
              onClick={() => window.location.reload()}
            >
              Reload
            </Button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
