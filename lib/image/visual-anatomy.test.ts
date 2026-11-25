import { describe, expect, it } from "vitest";
import {
  detectAnatomy, hasAirplaneSceneOverride, hasCleanBackdropRequest, hasExplicitScene,
} from "./visual-anatomy";
import { identifySubjects, seedConcepts } from "./visual-knowledge";

function profile(prompt: string) {
  return detectAnatomy(prompt, identifySubjects(prompt, seedConcepts(), 6));
}

describe("semantic anatomy contracts", () => {
  it("does not borrow human anatomy from a hand-carved object", () => {
    const result = profile("a rare hand-carved ocarina");
    expect(result.person).toBe(false);
    expect(result.handAnatomy).toBe(false);
    expect(result.positive).toEqual([]);
  });

  it("still applies hand anatomy to a visible hand or finger", () => {
    const result = profile("a close-up of a surgeon's hands");
    expect(result.person).toBe(true);
    expect(result.handAnatomy).toBe(true);
    expect(result.positive).toEqual(expect.arrayContaining(["five separate fingers on each hand"]));
    expect(result.negative).toEqual(expect.arrayContaining(["fused fingers", "extra eyes", "bad facial proportions"]));
  });

  it("does not treat clock hands or plane geometry as a body or vehicle", () => {
    const clock = profile("an antique clock with ornate hands");
    expect(clock.person).toBe(false);
    expect(clock.handAnatomy).toBe(false);
    const geometry = profile("a diagram of plane geometry");
    expect(geometry.vehicle).toBe(false);
  });

  it("routes a ship captain as a person without inventing a ship render", () => {
    const captain = profile("an elderly ship captain");
    expect(captain.person).toBe(true);
    expect(captain.vehicle).toBe(false);
    const vessel = profile("a cargo ship on the ocean");
    expect(vessel.vehicle).toBe(true);
  });

  it("ignores animal figures of speech", () => {
    expect(profile("an eagle-eyed detective").animal).toBe(false);
    expect(profile("a lion-hearted knight").animal).toBe(false);
  });

  it("keeps explicit scenes and clean-backdrop requests distinct", () => {
    expect(hasAirplaneSceneOverride("a plane parked in a hangar at night")).toBe(true);
    expect(hasAirplaneSceneOverride("a grey airplane flying above the clouds")).toBe(false);
    expect(hasExplicitScene("inside a busy market")).toBe(true);
    expect(hasCleanBackdropRequest("isolated on a plain background")).toBe(true);
    expect(hasCleanBackdropRequest("on a stormy runway")).toBe(false);
  });
});
