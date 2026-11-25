import { describe, expect, it } from "vitest";
import {
  ALL_NAV_ITEMS, EXPLORE_GROUPS, PRIMARY_NAV, getPageTitle, isExploreRoute,
} from "./nav";

const ALL_ROUTES = [
  "/", "/chat", "/image", "/datasets", "/architecture", "/training",
  "/internet-study", "/monitor", "/evaluation", "/dictionary", "/memory",
  "/learning", "/sandbox", "/checkpoints", "/experiments", "/knowledge", "/settings",
];

describe("navigation", () => {
  it("keeps exactly Chat and Images as the primary experiences", () => {
    expect(PRIMARY_NAV.map((item) => item.href)).toEqual(["/chat", "/image"]);
  });

  it("preserves every one of the 17 original routes", () => {
    expect(ALL_NAV_ITEMS.map((item) => item.href).sort()).toEqual([...ALL_ROUTES].sort());
    expect(ALL_NAV_ITEMS).toHaveLength(17);
  });

  it("has no duplicate hrefs", () => {
    const hrefs = ALL_NAV_ITEMS.map((item) => item.href);
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  it("places all 15 non-primary routes inside the Explore folder", () => {
    expect(EXPLORE_GROUPS.flatMap((group) => group.items)).toHaveLength(15);
    for (const route of ALL_ROUTES.filter((r) => r !== "/chat" && r !== "/image")) {
      expect(isExploreRoute(route)).toBe(true);
    }
    expect(isExploreRoute("/chat")).toBe(false);
    expect(isExploreRoute("/image")).toBe(false);
    expect(isExploreRoute("/does-not-exist")).toBe(false);
  });

  it("derives header titles from the same nav data", () => {
    for (const item of ALL_NAV_ITEMS) {
      expect(getPageTitle(item.href)).toBe(item.label);
    }
    expect(getPageTitle("/unknown")).toBe("DavidAI");
  });
});
