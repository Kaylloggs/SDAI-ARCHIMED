import { Component, type ErrorInfo, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { Button, EmptyState } from "@/design-system/primitives";

type Props = { moduleId: string; children: ReactNode };
type State = { error: Error | null };

/** Un module qui plante ne doit jamais emporter le shell (guidelines.md §4.4). */
export class ModuleErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[module:${this.props.moduleId}]`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props): void {
    if (prev.moduleId !== this.props.moduleId && this.state.error) {
      this.setState({ error: null });
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <EmptyState
        icon={<AlertTriangle size={28} strokeWidth={1.5} />}
        title={`Le module « ${this.props.moduleId} » a rencontré une erreur`}
        description={this.state.error.message}
        action={
          <Button variant="secondary" onClick={() => this.setState({ error: null })}>
            Réessayer
          </Button>
        }
      />
    );
  }
}
