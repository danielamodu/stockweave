// The StockWeave brand mark. One asset (public/logo.png) rendered wherever the
// logo appears — footer, connect, the marketing header and the dashboard rail —
// so the logo and favicon (app/icon.png, app/apple-icon.png, app/favicon.ico)
// all come from the same source. Decorative by default: every placement sits
// next to the "Stockweave" wordmark, so screen readers read the name once.
import Image from "next/image";
import { cn } from "@/lib/utils";

export function BrandMark({
  size = 24,
  className,
  alt = "",
  priority = false,
}: {
  size?: number;
  className?: string;
  alt?: string;
  priority?: boolean;
}) {
  return (
    <Image
      src="/logo.png"
      alt={alt}
      width={size}
      height={size}
      priority={priority}
      className={cn("shrink-0", className)}
    />
  );
}
