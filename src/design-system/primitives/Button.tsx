import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/core/lib/cn";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  size?: Size;
  icon?: ReactNode;
};

const variants: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg hover:bg-accent-hover active:brightness-95 shadow-none",
  secondary:
    "bg-surface-2 text-text hover:bg-surface-3 border border-border",
  ghost: "text-text-muted hover:text-text hover:bg-surface-2",
  danger: "bg-danger text-text hover:brightness-110",
};

const sizes: Record<Size, string> = {
  sm: "h-7 px-2.5 text-footnote gap-1.5 rounded-sm",
  md: "h-8 px-3 text-body-sm gap-2 rounded-md",
  lg: "h-10 px-4 text-body gap-2 rounded-md",
};

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  className,
  children,
  ...props
}: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center font-medium transition-[background-color,color,filter] duration-[80ms] ease-standard",
        "disabled:pointer-events-none disabled:opacity-40",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    >
      {icon}
      {children}
    </button>
  );
}
