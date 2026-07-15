// Ride Plan
// Sets tomorrow's ride and optionally imports a Ride with GPS route.
//
// Required server-side environment variables:
// RWGPS_API_KEY
// RWGPS_AUTH_TOKEN
//
// Ride with GPS Basic authentication:
// Authorization: Basic base64("[api_key]:[auth_token]")

const { getJSON, setJSON } = require("./storage");
const { auth } = require("./fuel-log");

const RWGPS_API_BASE = "https://ridewithgps.com/api/v1";

function getRwgpsConfig() {
  return {
    apiKey: process.env.RWGPS_API_KEY || "",
    authToken: process.env.RWGPS_AUTH_TOKEN || "",
  };
}

function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function calculateBearing(pointA, pointB) {
  const latitude1 = degreesToRadians(pointA.y);
  const latitude2 = degreesToRadians(pointB.y);
  const longitudeDifference = degreesToRadians(pointB.x - pointA.x);

  const y =
    Math.sin(longitudeDifference) *
    Math.cos(latitude2);

  const x =
    Math.cos(latitude1) *
      Math.sin(latitude2) -
    Math.sin(latitude1) *
      Math.cos(latitude2) *
      Math.cos(longitudeDifference);

  return (
    (Math.atan2(y, x) * 180) / Math.PI +
    360
  ) % 360;
}

// Rough planning estimate only — seeds the Pre-Ride hours field, never
// authoritative. ~16mph flat moving-time pace, plus ~12 min per 1000ft
// of climbing. Always adjustable by hand on the Pre-Ride card.
function estimateRideHours(distanceMeters, elevationGainMeters) {
  if (!distanceMeters) return null;
  const miles = distanceMeters / 1609.344;
  const climbFt = elevationGainMeters ? elevationGainMeters * 3.28084 : 0;
  const hours = miles / 16 + (climbFt / 1000) * 0.2;
  return Math.round(hours * 10) / 10;
}

function extractRouteId(idOrUrl) {
  const input = String(idOrUrl || "").trim();

  if (!input) {
    throw new Error("Ride with GPS route ID or URL is required");
  }

  if (/^\d+$/.test(input)) {
    return input;
  }

  const routeMatch = input.match(
    /ridewithgps\.com\/routes\/(\d+)/i
  );

  if (routeMatch) {
    return routeMatch[1];
  }

  const numericMatches = input.match(/\d+/g);

  if (!numericMatches?.length) {
    throw new Error(
      "No Ride with GPS route ID was found"
    );
  }

  return numericMatches[numericMatches.length - 1];
}

async function readJsonResponse(response) {
  const raw = await response.text();

  if (!raw) {
    return {
      raw: "",
      json: null,
    };
  }

  try {
    return {
      raw,
      json: JSON.parse(raw),
    };
  } catch {
    return {
      raw,
      json: null,
    };
  }
}

function getErrorMessage(response, body) {
  const apiErrors = Array.isArray(body.json?.errors)
    ? body.json.errors.join("; ")
    : null;

  const apiMessage =
    body.json?.message ||
    body.json?.error ||
    apiErrors;

  return (
    apiMessage ||
    body.raw ||
    `${response.status} ${response.statusText}`
  );
}

function buildBasicAuthorization(apiKey, authToken) {
  return Buffer.from(
    `${apiKey}:${authToken}`,
    "utf8"
  ).toString("base64");
}

function findMidpointByDistance(points) {
  const finalPoint = points[points.length - 1];
  const totalDistance = Number(finalPoint.d || 0);

  if (totalDistance <= 0) {
    return points[Math.floor(points.length / 2)];
  }

  const targetDistance = totalDistance / 2;

  return (
    points.find(
      (point) =>
        Number(point.d || 0) >= targetDistance
    ) ||
    points[Math.floor(points.length / 2)]
  );
}

function normalizeRoute(route, routeId) {
  const points = (route.track_points || []).filter(
    (point) =>
      Number.isFinite(Number(point.x)) &&
      Number.isFinite(Number(point.y))
  );

  if (points.length < 2) {
    throw new Error(
      "Ride with GPS route contains no usable track points"
    );
  }

  const firstPoint = points[0];
  const lastPoint = points[points.length - 1];
  const midpoint = findMidpointByDistance(points);

  const trackDistanceMeters = Number(lastPoint.d || 0);

  const distanceMeters =
    Number(route.distance || 0) ||
    trackDistanceMeters ||
    null;

  const elevationGainMeters =
    Number(route.elevation_gain || 0) ||
    null;

  return {
    source: "rwgps",
    name: route.name || `RWGPS Route ${routeId}`,

    miles: distanceMeters
      ? Math.round(
          (distanceMeters / 1609.344) * 10
        ) / 10
      : null,

    climb_ft: elevationGainMeters
      ? Math.round(
          elevationGainMeters * 3.28084
        )
      : null,

    bearing_out: Math.round(
      calculateBearing(firstPoint, midpoint)
    ),

    bearing_back: Math.round(
      calculateBearing(midpoint, lastPoint)
    ),

    start_lat: Number(firstPoint.y),
    start_lon: Number(firstPoint.x),

    finish_lat: Number(lastPoint.y),
    finish_lon: Number(lastPoint.x),

    distance_meters: distanceMeters,
    elevation_gain_meters: elevationGainMeters,
    estimated_hours: estimateRideHours(distanceMeters, elevationGainMeters),

    track_point_count: points.length,

    rwgps_id: String(routeId),
    rwgps_url: `https://ridewithgps.com/routes/${routeId}`,

    imported_at: new Date().toISOString(),
  };
}

async function fetchRoute(idOrUrl) {
  const { apiKey, authToken } = getRwgpsConfig();

  if (!apiKey) {
    throw new Error(
      "RWGPS_API_KEY is not configured"
    );
  }

  if (!authToken) {
    throw new Error(
      "RWGPS_AUTH_TOKEN is not configured"
    );
  }

  const routeId = extractRouteId(idOrUrl);

  const authorization = buildBasicAuthorization(
    apiKey,
    authToken
  );

  const response = await fetch(
    `${RWGPS_API_BASE}/routes/${routeId}.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: "application/json",
      },
    }
  );

  const body = await readJsonResponse(response);

  if (!response.ok) {
    throw new Error(
      `Ride with GPS request failed (${response.status}): ${getErrorMessage(
        response,
        body
      )}`
    );
  }

  if (!body.json) {
    throw new Error(
      "Ride with GPS returned an invalid JSON response"
    );
  }

  const route = body.json.route || body.json;

  return normalizeRoute(route, routeId);
}

async function testRwgpsConnection() {
  const { apiKey, authToken } = getRwgpsConfig();

  if (!apiKey || !authToken) {
    return {
      configured: false,
      authenticated: false,
      error: !apiKey
        ? "RWGPS_API_KEY is not configured"
        : "RWGPS_AUTH_TOKEN is not configured",
    };
  }

  const authorization = buildBasicAuthorization(
    apiKey,
    authToken
  );

  const response = await fetch(
    `${RWGPS_API_BASE}/users/current.json`,
    {
      method: "GET",
      headers: {
        Authorization: `Basic ${authorization}`,
        Accept: "application/json",
      },
    }
  );

  const body = await readJsonResponse(response);

  if (!response.ok) {
    return {
      configured: true,
      authenticated: false,
      status: response.status,
      error: getErrorMessage(response, body),
    };
  }

  const user = body.json?.user || body.json;

  return {
    configured: true,
    authenticated: true,
    user: {
      id: user?.id || null,
      name: user?.name || null,
      email: user?.email || null,
    },
  };
}

async function getPlan() {
  const plan = await getJSON("plan", null);

  if (!plan) {
    return {
      ride: null,
      for_today: false,
      intensity: "moderate",
      planned_hours: null,
      effective_hours: null,
    };
  }

  const effective_hours =
    plan.planned_hours ||
    plan.route?.estimated_hours ||
    null;

  return {
    ...plan,
    for_today:
      plan.for_date === new Date().toDateString(),
    intensity: plan.intensity || "moderate",
    planned_hours: plan.planned_hours || null,
    effective_hours,
  };
}

function attach(app) {
  app.get(
    "/rwgps/status",
    async (req, res) => {
      if (!auth(req, res)) return;

      try {
        res.json(await testRwgpsConnection());
      } catch (error) {
        res.status(500).json({
          configured: Boolean(
            process.env.RWGPS_API_KEY &&
              process.env.RWGPS_AUTH_TOKEN
          ),
          authenticated: false,
          error: error.message,
        });
      }
    }
  );

  app.get(
    "/rwgps/route/:id",
    async (req, res) => {
      if (!auth(req, res)) return;

      try {
        const route = await fetchRoute(req.params.id);

        res.json({
          ok: true,
          route,
        });
      } catch (error) {
        res.status(502).json({
          ok: false,
          error: error.message,
        });
      }
    }
  );

  app.post("/plan", async (req, res) => {
    if (!auth(req, res)) return;

    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);

    const requestedRide = String(
      req.body?.ride || ""
    ).trim();

    const plan = {
      ride: (
        requestedRide || "Ride"
      ).slice(0, 120),

      start: /^\d{1,2}:\d{2}$/.test(
        req.body?.start || ""
      )
        ? req.body.start
        : "06:00",

      for_date: tomorrow.toDateString(),

      route: null,
      route_error: null,

      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    if (req.body?.rwgps) {
      try {
        plan.route = await fetchRoute(
          req.body.rwgps
        );

        if (
          !requestedRide &&
          plan.route?.name
        ) {
          plan.ride = plan.route.name;
        }
      } catch (error) {
        plan.route_error = error.message;
      }
    }

    await setJSON("plan", plan);

    res.json({
      ok: true,
      ...plan,
    });
  });

  // Pre-Ride fueling inputs — kept separate from POST /plan so saving an
  // intensity/duration choice can never overwrite the planned ride or route.
  app.post("/plan/fueling", async (req, res) => {
    if (!auth(req, res)) return;

    const existing =
      (await getJSON("plan", null)) || {
        ride: null,
        for_date: null,
        route: null,
      };

    const intensity = ["easy", "moderate", "hard"].includes(
      req.body?.intensity
    )
      ? req.body.intensity
      : existing.intensity || "moderate";

    const rawHours = req.body?.planned_hours;
    const planned_hours =
      rawHours !== undefined && rawHours !== null && rawHours !== ""
        ? Math.max(0, Number(rawHours)) || null
        : existing.planned_hours || null;

    existing.intensity = intensity;
    existing.planned_hours = planned_hours;
    existing.updated_at = new Date().toISOString();

    await setJSON("plan", existing);

    res.json({ ok: true, intensity, planned_hours });
  });

  app.get("/plan", async (req, res) => {
    if (!auth(req, res)) return;

    res.json(await getPlan());
  });
}

module.exports = {
  attach,
  getPlan,
  fetchRoute,
  testRwgpsConnection,
};
