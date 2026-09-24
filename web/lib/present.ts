// Plain-language presentation layer. Turns the engine's internal vocabulary
// (states, weights, reserves, agent actions) into words a normal person reads.
// Pure functions — no jargon leaks past here into the UI.

export const ASSET_LABEL: Record<string, string> = {
  OPENAI: "OpenAI",
  ANTHROPIC: "Anthropic",
  FIGUREAI: "Figure AI",
  SPACEX: "SpaceX",
  ANDURIL: "Anduril",
  NEURALINK: "Neuralink",
  USDC: "Cash",
};

// Segment colors for mix bars/legends. USDC is rendered as a hatch (no color).
// Fallback palette covers any symbol not explicitly listed.
export const SEG_TONE: Record<string, string> = {
  OPENAI: "var(--color-accent)",
  ANTHROPIC: "#4d4dff",
  FIGUREAI: "#8f8fff",
  SPACEX: "var(--color-accent)",
  ANDURIL: "#4d4dff",
  NEURALINK: "#8f8fff",
  USDC: "transparent",
};

const TONE_FALLBACK = ["var(--color-accent)", "#4d4dff", "#8f8fff", "#b3b3ff"];

export function segTone(symbol: string, index = 0): string {
  if (symbol === "USDC") return "transparent";
  return SEG_TONE[symbol] ?? TONE_FALLBACK[index % TONE_FALLBACK.length];
}

export type PlainStatus = {
  label: string;
  tone: "ok" | "attention" | "muted";
  hint: string;
};

export function plainStatus(state: string): PlainStatus {
  switch (state) {
    case "NORMAL":
      return { label: "On track", tone: "ok", hint: "The mix is where it should be." };
    case "DRIFTED":
      return { label: "Needs a tune-up", tone: "attention", hint: "The mix has drifted from its target." };
    case "STALE_DATA":
      return { label: "Prices unavailable", tone: "muted", hint: "Waiting on fresh prices before anything changes." };
    case "DISLOCATED":
      return { label: "Price check needed", tone: "muted", hint: "Prices look out of line with the market." };
    case "PAUSED":
      return { label: "Paused", tone: "muted", hint: "This strategy is paused right now." };
    default:
      return { label: state, tone: "muted", hint: "" };
  }
}

// bps (e.g. 3000) → whole/one-decimal percent
export function pct(bps: number): number {
  return Math.round(bps) / 100;
}

// Turn an agent decision into a plain, honest sentence, or null when there's
// nothing for the user to do. Uses the real numbers the engine produced — the
// asset's current vs target weight and the proposed trim — never invented.
export function plainSuggestion(decision: {
  action?: string;
  trades?: {
    symbol: string;
    notionalUsd: number;
    fromWeightBps?: number;
    targetWeightBps?: number;
  }[];
}): { text: string } | null {
  if (!decision || decision.action !== "PROPOSE_REBALANCE" || !decision.trades?.length) {
    return null;
  }
  const t = decision.trades[0];
  const name = ASSET_LABEL[t.symbol] ?? t.symbol;
  const lead =
    t.fromWeightBps != null && t.targetWeightBps != null
      ? `${name} has grown to ${pct(t.fromWeightBps)}% of the mix, above its ${pct(t.targetWeightBps)}% target.`
      : `${name} grew past its target.`;
  return {
    text: `${lead} The agent suggests moving $${t.notionalUsd} into cash to bring the mix back in line — it can only suggest, so you approve every change.`,
  };
}
