---
name: amap-travel-routing
description: Query and preserve source-backed AMap POIs and route legs for travel planning in China. Use for 高德地图查询, POI 核验, 地点消歧, 步行/公交/驾车/骑行路线, travel-time checks, route feasibility, or when a travel itinerary needs traceable map evidence.
---

# AMap Travel Routing

Resolve place identity and adjacent travel legs before presenting a domestic
itinerary as feasible. Treat AMap output as a time-stamped planning snapshot,
not a permanent fact or a guarantee of future traffic.

## Read the API contract

Read [the AMap API contract](references/api-contract.md) before running a live
query. It records the supported endpoints, parameters, output boundaries, and
credential rules used by the bundled script.

## Query workflow

1. List the candidate places with city or district scope, desired type, and why
   each place belongs in the itinerary.
2. Resolve every destination with `poi`. Prefer an exact POI ID, address,
   administrative district, and GCJ-02 coordinate over a hand-entered point.
3. Resolve ambiguous names before routing. Do not silently pick the first search
   result when multiple branches, gates, stations, or similarly named venues are
   returned.
4. Query every adjacent itinerary leg with `route`. Use the travel mode the user
   will actually take and preserve at least distance, duration, query time,
   origin, destination, and route strategy.
5. Add realistic transfer, wait, queue, parking, luggage, meal, and recovery
   buffers outside the provider duration. Never present the provider duration as
   door-to-door time without those additions.
6. Save the normalized JSON snapshots beside the travel publication under an
   `amap/` directory. Reference their file names and retrieval times in
   `sources.md` and the planning report.

Use the CLI without a key to inspect a request:

```bash
node skills/amap-travel-routing/scripts/query.mjs poi \
  --keywords "三坊七巷" --city "福州" --city-limit true --dry-run
```

Run a live POI query:

```bash
node skills/amap-travel-routing/scripts/query.mjs poi \
  --keywords "三坊七巷" --city "福州" --city-limit true \
  --key-file secrets/amap-web-service-key.txt \
  --output publications/travel-guidebook-fuzhou/amap/sanfang-qixiang.json
```

Run a route query after selecting exact coordinates:

```bash
node skills/amap-travel-routing/scripts/query.mjs route \
  --mode walking \
  --origin "119.296494,26.078061" \
  --destination "119.294362,26.075787" \
  --key-file secrets/amap-web-service-key.txt \
  --output publications/travel-guidebook-fuzhou/amap/leg-01.json
```

Do not place a key value on the command line, in generated HTML, in source logs,
or in a URL shown to the user. Store it in an ignored local file under the
customer Workspace's `secrets/` directory and pass that path with `--key-file`.
The script reads the file only for live requests and omits its path and value
from saved output.

## Planning boundaries

- AMap verifies place identity and route estimates. It does not verify opening
  hours, ticket inventory, accessibility, weather, visa rules, or safety advice.
- Re-query route-critical legs shortly before departure. Road networks, data,
  algorithms, and traffic conditions change.
- Use official venue and transport sources for opening, reservation, and
  timetable facts. Record conflicts instead of choosing whichever source is more
  convenient.
- Keep live location, home address, booking identifiers, and traveler identity
  out of reusable examples.
- If the key or network is unavailable, keep the route as unverified, show the
  exact pending queries, and do not invent POI IDs, distances, or durations.

## Return to the planning skill

Provide the itinerary planner with:

- selected POI name, ID, address, district, type, and coordinate;
- each adjacent leg's mode, distance, provider duration, and retrieval time;
- rejected ambiguous candidates and the reason for rejection;
- unresolved queries, provider errors, and assumptions;
- the snapshot paths used by the final Page.
