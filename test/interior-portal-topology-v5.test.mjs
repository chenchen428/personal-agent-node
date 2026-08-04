import assert from "node:assert/strict";
import test from "node:test";
import { auditPortalTopology, resolvePortalTopology, resolveTourNodes } from "../skills/interior-design/scripts/portal-topology-v5.mjs";

function fixture() {
  return {
    rooms: [
      { id: "room-a", polygon: [[0, 0], [4000, 0], [4000, 4000], [0, 4000]] },
      { id: "room-b", polygon: [[4000, 0], [8000, 0], [8000, 4000], [4000, 4000]] },
    ],
    walls: [{ id: "wall-ab", start: [4000, 0], end: [4000, 4000], thickness: 120, height: 2800 }],
    openings: [{ id: "door-ab", type: "door", wallId: "wall-ab", offset: 1500, width: 1000, height: 2200, sill: 0 }],
    portals: [{ id: "portal-ab", openingId: "door-ab", roomIds: ["room-a", "room-b"], traversable: true, state: "open" }],
    panoramaNodes: [
      { id: "node-a", title: "A", roomId: "room-a", position: [2000, 2000, 1550], lookAt: [4000, 2000, 1200], hotspots: [{ id: "to-b", kind: "portal", target: "node-b", portalId: "portal-ab" }] },
      { id: "node-b", title: "B", roomId: "room-b", position: [6000, 2000, 1550], lookAt: [4000, 2000, 1200], hotspots: [{ id: "to-a", kind: "portal", target: "node-a", portalId: "portal-ab" }] },
    ],
  };
}

test("portal topology derives a door threshold and reciprocal navigation headings", () => {
  const geometry = fixture();
  const portal = resolvePortalTopology(geometry)[0];
  assert.deepEqual(portal.threshold, [4000, 2000, 40]);
  assert.deepEqual(portal.normal, [-1, 0]);
  const nodes = resolveTourNodes(geometry);
  assert.equal(nodes[0].hotspots[0].anchorType, "door-threshold");
  assert.equal(nodes[0].hotspots[0].departureYaw, 0);
  assert.equal(nodes[0].hotspots[0].arrivalYaw, -180);
  assert.equal(nodes[0].hotspots[0].departurePitch, 37.0528);
  assert.deepEqual(auditPortalTopology(geometry), []);
});

test("portal topology rejects one-way or room-incompatible portal hotspots", () => {
  const geometry = fixture();
  geometry.panoramaNodes[1].hotspots = [];
  geometry.portals[0].roomIds = ["room-a", "missing-room"];
  const issues = auditPortalTopology(geometry);
  assert.ok(issues.some((entry) => entry.code === "GEO-PORTAL-ROOMS"));
  assert.ok(issues.some((entry) => entry.code === "GEO-HOTSPOT-RETURN"));
});

test("portal arrival follows the doorway normal when the target camera is off axis", () => {
  const geometry = fixture();
  geometry.panoramaNodes[1].position = [6000, 3000, 1550];
  geometry.panoramaNodes[1].lookAt = [6000, 2000, 1200];
  const nodes = resolveTourNodes(geometry);
  assert.equal(nodes[0].hotspots[0].arrivalYaw, 90);
});

test("portal arrival can turn along a declared transition path after crossing", () => {
  const geometry = fixture();
  geometry.panoramaNodes[0].hotspots[0].arrivalLookAt = [6000, 4000, 1200];
  const nodes = resolveTourNodes(geometry);
  assert.equal(nodes[0].hotspots[0].arrivalYaw, -90);
});
