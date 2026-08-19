import { describe, expect, it } from "vite-plus/test";

import { layoutDag } from "./dagLayout";

const size = { width: 200, height: 80 };

describe("layoutDag", () => {
  it("places downstream nodes below their dependencies", () => {
    const positions = layoutDag(
      [
        { id: "a", ...size },
        { id: "b", ...size },
        { id: "c", ...size },
      ],
      [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    );
    expect(positions.get("a")!.y).toBeLessThan(positions.get("b")!.y);
    expect(positions.get("b")!.y).toBeLessThan(positions.get("c")!.y);
  });

  it("spreads siblings horizontally and ignores edges to unknown nodes", () => {
    const positions = layoutDag(
      [
        { id: "root", ...size },
        { id: "x", ...size },
        { id: "y", ...size },
      ],
      [
        { from: "root", to: "x" },
        { from: "root", to: "y" },
        { from: "root", to: "missing" },
      ],
    );
    expect(positions.size).toBe(3);
    expect(positions.get("x")!.y).toBe(positions.get("y")!.y);
    expect(positions.get("x")!.x).not.toBe(positions.get("y")!.x);
  });
});
