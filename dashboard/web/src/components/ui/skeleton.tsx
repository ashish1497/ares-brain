import type { ComponentProps } from "react";
import { cn } from "../../lib/utils";

export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn("animate-pulse rounded-nb border-[3px] border-edge bg-card", className)}
      {...props}
    />
  );
}
