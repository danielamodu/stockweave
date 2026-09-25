import { ImageResponse } from "next/og";

// Blueprint-styled social card. Served at /opengraph-image and merged into the
// root openGraph/twitter tags. satori supports only flexbox + a CSS subset, so
// the hairline grid is drawn with repeating-linear-gradients (no display:grid).
export const alt =
  "StockWeave — a public, forkable strategy layer for tokenized pre-IPO PreStocks on Solana";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

const INK = "#0a0a0a";
const ACCENT = "#0000ff";
const MUTED = "#6e6e6e";

export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: "72px",
          background: "#ffffff",
          backgroundImage:
            "repeating-linear-gradient(0deg, transparent 0, transparent 47px, rgba(0,0,0,0.06) 47px, rgba(0,0,0,0.06) 48px), repeating-linear-gradient(90deg, transparent 0, transparent 47px, rgba(0,0,0,0.06) 47px, rgba(0,0,0,0.06) 48px)",
          fontFamily: "sans-serif",
          color: INK,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
            <div style={{ display: "flex", width: "44px", height: "44px", background: ACCENT, alignItems: "center", justifyContent: "center" }}>
              <div style={{ display: "flex", width: "16px", height: "16px", border: "3px solid #ffffff" }} />
            </div>
            <div style={{ display: "flex", fontSize: "26px", fontWeight: 700, letterSpacing: "0.14em" }}>STOCKWEAVE</div>
          </div>
          <div style={{ display: "flex", fontSize: "20px", letterSpacing: "0.18em", color: MUTED }}>SOLANA · DEVNET</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
          <div style={{ display: "flex", flexDirection: "column", fontSize: "82px", fontWeight: 800, lineHeight: 1.02, letterSpacing: "-0.02em" }}>
            <div style={{ display: "flex" }}>Inspect. Simulate.</div>
            <div style={{ display: "flex" }}>Fork. Follow.</div>
          </div>
          <div style={{ display: "flex", fontSize: "30px", color: MUTED, maxWidth: "860px", lineHeight: 1.3 }}>
            A public, forkable strategy layer for tokenized pre-IPO PreStocks — every rule, weight, and agent permission inspectable before you follow or fork.
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", width: "100%", fontSize: "19px", letterSpacing: "0.14em", color: MUTED }}>
          <div style={{ display: "flex" }}>PYTH · ANCHOR · READ + PROPOSE AGENT</div>
          <div style={{ display: "flex", color: ACCENT }}>stockweavexbt.vercel.app</div>
        </div>
      </div>
    ),
    size,
  );
}
