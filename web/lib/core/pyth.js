// Phase 2 — Pyth feed validation + deterministic price-quality assessment.
// No network calls here: pure functions over timestamps, so age is calculated, never guessed.
// Contract: Pyth maximum age 30 seconds; missing reference must yield UNKNOWN.
const MAX_AGE_SECONDS = 30;

function isValidFeedId(feedId) {
  return typeof feedId === "string" && /^(0x)?[0-9a-fA-F]{64}$/.test(feedId);
}

// Demo-only synthetic feed ID for the stale-data simulation. It is NOT a real
// Pyth feed and must never be presented as one (see DEMO_SIMULATION labelling).
const DEMO_FEED_ID = "0xabababababababababababababababababababababababababababababababab";

function assessPriceQuality(snapshot, opts = {}) {
  const maxAgeSeconds = opts.maxAgeSeconds != null ? opts.maxAgeSeconds : MAX_AGE_SECONDS;
  const { feedId, publishTimeMs, receivedTimeMs, confidenceBps, maxConfidenceBps } = snapshot;

  if (feedId === null || feedId === undefined) {
    return { validity: "UNKNOWN", ageSeconds: null };
  }
  if (!isValidFeedId(feedId)) {
    return { validity: "INVALID_FEED", ageSeconds: null };
  }
  const ageSeconds = (receivedTimeMs - publishTimeMs) / 1000;
  if (ageSeconds > maxAgeSeconds) {
    return { validity: "STALE_DATA", ageSeconds };
  }
  if (
    maxConfidenceBps != null &&
    confidenceBps != null &&
    confidenceBps > maxConfidenceBps
  ) {
    return { validity: "LOW_CONFIDENCE", ageSeconds };
  }
  return { validity: "FRESH", ageSeconds };
}

module.exports = { MAX_AGE_SECONDS, isValidFeedId, assessPriceQuality, DEMO_FEED_ID };
