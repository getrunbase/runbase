// Error boundary of the page runtime: stops rendering on the first error and
// reports it once, with a readable message and the React component stack.
import { Component, type ReactNode } from "react";
import { describeError, withComponentStack } from "./describe-error";

type Props = {
  children?: ReactNode;
  onError: (error: { message: string; stack?: string }) => void;
};

// A boolean flag, not the message: an error with an empty message must not
// reset the boundary (render loop).
export class Boundary extends Component<Props, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(e: unknown, info: { componentStack?: string | null }) {
    const d = describeError(e);
    this.props.onError({
      message: d.message,
      stack: withComponentStack(d.stack, info.componentStack),
    });
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}
