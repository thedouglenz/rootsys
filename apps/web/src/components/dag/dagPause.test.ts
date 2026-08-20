import { DagNodeId, type DagPauseReason } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildDagResumeConfirmMessage,
  describeDagPauseReason,
  shouldConfirmDagResume,
  truncateProviderMessage,
} from "./dagPause";

const PAUSED_AT = "2026-01-01T00:00:00.000Z";
const PAUSED_AT_MS = Date.parse(PAUSED_AT);

function reason(partial: Partial<DagPauseReason> = {}): DagPauseReason {
  return {
    kind: "provider-refused",
    nodeId: DagNodeId.make("node-a"),
    threadId: null,
    providerMessage: null,
    pausedAt: PAUSED_AT,
    ...partial,
  };
}

describe("describeDagPauseReason", () => {
  it("explains every kind and only offers a model change where one would help", () => {
    expect(describeDagPauseReason(reason())).toEqual({
      headline: "Paused automatically — the model refused the last turn.",
      action: "change-model",
    });
    expect(describeDagPauseReason(reason({ kind: "no-model" })).action).toBe("change-model");
    expect(describeDagPauseReason(reason({ kind: "no-project" })).action).toBeNull();
    expect(describeDagPauseReason(reason({ kind: "provider-unavailable" })).headline).toBe(
      "Paused — that provider instance isn't available.",
    );
    expect(describeDagPauseReason(reason({ kind: "unresolved" })).headline).toBe(
      "Paused — nothing could be scheduled.",
    );
  });
});

describe("truncateProviderMessage", () => {
  it("collapses whitespace and leaves short messages alone", () => {
    expect(truncateProviderMessage("You've reached\n  your limit.")).toBe(
      "You've reached your limit.",
    );
  });

  it("clips long messages to the limit", () => {
    const clipped = truncateProviderMessage("a".repeat(300));
    expect(clipped).toHaveLength(200);
    expect(clipped.endsWith("…")).toBe(true);
  });
});

describe("shouldConfirmDagResume", () => {
  it("warns only for a recent provider refusal", () => {
    expect(shouldConfirmDagResume(reason(), PAUSED_AT_MS + 60_000)).toBe(true);
    expect(shouldConfirmDagResume(reason(), PAUSED_AT_MS + 11 * 60_000)).toBe(false);
    expect(shouldConfirmDagResume(reason({ kind: "no-model" }), PAUSED_AT_MS)).toBe(false);
    expect(shouldConfirmDagResume(null, PAUSED_AT_MS)).toBe(false);
    expect(shouldConfirmDagResume(reason({ pausedAt: "not-a-date" }), PAUSED_AT_MS)).toBe(false);
  });

  it("treats a pause stamped in the future as recent", () => {
    expect(shouldConfirmDagResume(reason(), PAUSED_AT_MS - 5_000)).toBe(true);
  });
});

describe("buildDagResumeConfirmMessage", () => {
  it("quotes the provider and says what resuming will do", () => {
    const message = buildDagResumeConfirmMessage(
      reason({ providerMessage: "You've reached your Fable 5 limit." }),
      "2m ago",
    );
    expect(message).toContain("This plan paused 2m ago");
    expect(message).toContain('"You\'ve reached your Fable 5 limit."');
    expect(message).toContain("Resume anyway?");
  });

  it("omits the quote when the provider said nothing", () => {
    const message = buildDagResumeConfirmMessage(reason(), "");
    expect(message).toContain("This plan paused recently");
    expect(message).not.toContain('"');
  });
});
