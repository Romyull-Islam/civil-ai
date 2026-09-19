/** Tool routing for the road, pavement, mix-design and drainage calculators (unrelated questions must not pull them in). */
import { it, expect } from "vitest";
import { selectToolsForText } from "@/lib/tools";
const n = (t: string) => selectToolsForText(t).map((x) => x.name);
it("routes", () => {
  expect(n("design an M25 concrete mix, grade 60 steel")).not.toContain("vertical_curve");
  expect(n("house on 5 katha plot, road width 6 m")).not.toContain("horizontal_curve");
  expect(n("horizontal curve radius 300 m deflection 40 degrees")).toContain("horizontal_curve");
  expect(n("flexible pavement for 10 msa, CBR 4")).toContain("pavement_rhd_catalogue");
  expect(n("mix design for M30 concrete")).toContain("mix_design_is10262");
  expect(n("storm drain pipe size for 0.3 m3/s")).toContain("pipe_channel_flow");
  expect(n("stopping sight distance at 80 km/h on 3% downgrade")).toContain("sight_distance");
});
