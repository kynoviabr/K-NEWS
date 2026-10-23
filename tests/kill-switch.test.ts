import { describe, it, expect } from "vitest";
import { setKillSwitch, canPublish, getKillSwitch } from "@/lib/kill-switch";

describe("kill-switch", () => {
  it("bloqueia publicacao quando ativo", () => {
    setKillSwitch({ enabled: true, reason: "incidente" });
    expect(canPublish()).toBe(false);
    expect(getKillSwitch().reason).toBe("incidente");
    setKillSwitch({ enabled: false });
    expect(canPublish()).toBe(true);
  });
});
