import { DagId, MessageId, ThreadId, type ThreadDagLink } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  buildCompanionTranscript,
  DAG_COMPANION_TRANSCRIPT_LIMIT,
  dagCompanionDockStorageKey,
  selectCompanionThread,
  type DagCompanionMessageLike,
  type DagCompanionThreadCandidate,
} from "./dagCompanion";

const DAG_A = DagId.make("dag-a");
const DAG_B = DagId.make("dag-b");

const companionLink = (dagId: DagId): ThreadDagLink => ({ dagId, nodeId: null, role: "companion" });

function thread(
  id: string,
  updatedAt: string,
  overrides: Partial<DagCompanionThreadCandidate> = {},
): DagCompanionThreadCandidate {
  return {
    id: ThreadId.make(id),
    dagLink: companionLink(DAG_A),
    archivedAt: null,
    updatedAt,
    ...overrides,
  };
}

function message(
  id: string,
  role: DagCompanionMessageLike["role"],
  text: string,
  streaming = false,
): DagCompanionMessageLike {
  return { id: MessageId.make(id), role, text, streaming };
}

describe("selectCompanionThread", () => {
  it("picks the most recently updated live companion for the plan", () => {
    const picked = selectCompanionThread(
      [
        thread("old", "2026-01-01T00:00:00.000Z"),
        thread("new", "2026-02-01T00:00:00.000Z"),
        thread("newest-other-plan", "2026-03-01T00:00:00.000Z", {
          dagLink: companionLink(DAG_B),
        }),
      ],
      DAG_A,
    );
    expect(picked?.id).toBe("new");
  });

  it("ignores archived companions, other roles, and unlinked threads", () => {
    expect(
      selectCompanionThread(
        [
          thread("archived", "2026-04-01T00:00:00.000Z", {
            archivedAt: "2026-04-02T00:00:00.000Z",
          }),
          thread("planner", "2026-04-01T00:00:00.000Z", {
            dagLink: { dagId: DAG_A, nodeId: null, role: "planner" },
          }),
          thread("plain", "2026-04-01T00:00:00.000Z", { dagLink: null }),
        ],
        DAG_A,
      ),
    ).toBeNull();
  });

  it("keeps the earlier candidate when timestamps tie so the dock does not flip threads", () => {
    const picked = selectCompanionThread(
      [thread("first", "2026-01-01T00:00:00.000Z"), thread("second", "2026-01-01T00:00:00.000Z")],
      DAG_A,
    );
    expect(picked?.id).toBe("first");
  });

  it("keys dock state per plan", () => {
    expect(dagCompanionDockStorageKey(DAG_A)).toBe("t3code:plan-companion:dag-a");
  });
});

describe("buildCompanionTranscript", () => {
  it("peels the seeded brief off the front and keeps the conversation", () => {
    const transcript = buildCompanionTranscript([
      message("m1", "user", "You are the companion for plan X…"),
      message("m2", "assistant", "Ready."),
      message("m3", "user", "Split the migration node."),
    ]);
    expect(transcript.brief).toBe("You are the companion for plan X…");
    expect(transcript.entries.map((entry) => entry.id)).toEqual(["m2", "m3"]);
    expect(transcript.hiddenCount).toBe(0);
  });

  it("drops system and empty messages, and reports streaming", () => {
    const transcript = buildCompanionTranscript([
      message("brief", "user", "brief"),
      message("sys", "system", "session started"),
      message("blank", "assistant", "   "),
      message("live", "assistant", "Editing…", true),
    ]);
    expect(transcript.entries).toEqual([
      { id: "live", role: "assistant", text: "Editing…", streaming: true },
    ]);
  });

  it("caps to the last N entries and counts what it hid", () => {
    const messages = [
      message("brief", "user", "brief"),
      ...Array.from({ length: 60 }, (_, index) =>
        message(`m${index}`, index % 2 === 0 ? "user" : "assistant", `line ${index}`),
      ),
    ];
    const transcript = buildCompanionTranscript(messages);
    expect(transcript.entries).toHaveLength(DAG_COMPANION_TRANSCRIPT_LIMIT);
    expect(transcript.hiddenCount).toBe(10);
    expect(transcript.entries[0]?.id).toBe("m10");
  });

  it("treats a thread that opens with an assistant message as having no brief", () => {
    const transcript = buildCompanionTranscript([message("m1", "assistant", "Hi")]);
    expect(transcript.brief).toBeNull();
    expect(transcript.entries.map((entry) => entry.id)).toEqual(["m1"]);
  });

  it("returns nothing for an empty thread", () => {
    expect(buildCompanionTranscript([])).toEqual({ brief: null, entries: [], hiddenCount: 0 });
  });
});
