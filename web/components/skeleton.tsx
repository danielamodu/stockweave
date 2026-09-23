// Blueprint loading placeholder — a hairline-bounded shimmer block.
import { cn } from "@/lib/utils";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("bp-skeleton", className)} />;
}
