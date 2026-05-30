const mongoose = require("mongoose");
const { TripCatalog } = require("../../../models/platform");

function normalizeTenantIds(tenantIds = []) {
  return tenantIds
    .map((tenantId) => String(tenantId || "").trim())
    .filter(Boolean)
    .filter((tenantId) => mongoose.Types.ObjectId.isValid(tenantId))
    .map((tenantId) => new mongoose.Types.ObjectId(tenantId));
}

function catalogMatch(tenantIds = []) {
  const ids = normalizeTenantIds(tenantIds);
  if (!ids.length) return {};
  return { tenantId: { $in: ids } };
}

function rowMap(rows = [], keyField = "_id") {
  return new Map(rows.map((row) => [String(row[keyField]), row]));
}

async function loadCatalogMetricsByTenant(tenantIds = []) {
  const match = catalogMatch(tenantIds);
  const now = new Date();

  const [tripRows, routeRows, vehicleRows] = await Promise.all([
    TripCatalog.aggregate([
      { $match: match },
      {
        $group: {
          _id: "$tenantId",
          totalTrips: { $sum: 1 },
          scheduledTrips: {
            $sum: {
              $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0]
            }
          },
          futureTrips: {
            $sum: {
              $cond: [{ $gte: ["$departureAt", now] }, 1, 0]
            }
          }
        }
      }
    ]),
    TripCatalog.aggregate([
      {
        $match: {
          ...match,
          sourceRouteId: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            tenantId: "$tenantId",
            routeId: "$sourceRouteId"
          },
          type: { $first: "$type" },
          isActiveAny: {
            $max: {
              $cond: [{ $eq: ["$isActive", true] }, 1, 0]
            }
          }
        }
      },
      {
        $group: {
          _id: "$_id.tenantId",
          totalRoutes: { $sum: 1 },
          activeRoutes: { $sum: "$isActiveAny" }
        }
      }
    ]),
    TripCatalog.aggregate([
      {
        $match: {
          ...match,
          sourceVehicleId: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            tenantId: "$tenantId",
            vehicleId: "$sourceVehicleId"
          }
        }
      },
      {
        $group: {
          _id: "$_id.tenantId",
          totalVehicles: { $sum: 1 }
        }
      }
    ])
  ]);

  return {
    tripsByTenant: rowMap(tripRows),
    routesByTenant: rowMap(routeRows),
    vehiclesByTenant: rowMap(vehicleRows)
  };
}

async function loadGlobalCatalogSummary() {
  const now = new Date();

  const [tripRows, routeRows, vehicleRows, inventoryMix] = await Promise.all([
    TripCatalog.aggregate([
      {
        $group: {
          _id: null,
          totalTrips: { $sum: 1 },
          scheduledTrips: {
            $sum: {
              $cond: [{ $eq: ["$status", "scheduled"] }, 1, 0]
            }
          },
          futureTrips: {
            $sum: {
              $cond: [{ $gte: ["$departureAt", now] }, 1, 0]
            }
          }
        }
      }
    ]),
    TripCatalog.aggregate([
      { $match: { sourceRouteId: { $ne: null } } },
      {
        $group: {
          _id: {
            tenantId: "$tenantId",
            routeId: "$sourceRouteId"
          },
          type: { $first: "$type" },
          isActiveAny: {
            $max: {
              $cond: [{ $eq: ["$isActive", true] }, 1, 0]
            }
          }
        }
      },
      {
        $group: {
          _id: null,
          totalRoutes: { $sum: 1 },
          activeRoutes: { $sum: "$isActiveAny" }
        }
      }
    ]),
    TripCatalog.aggregate([
      { $match: { sourceVehicleId: { $ne: null } } },
      {
        $group: {
          _id: {
            tenantId: "$tenantId",
            vehicleId: "$sourceVehicleId"
          }
        }
      },
      {
        $group: {
          _id: null,
          totalVehicles: { $sum: 1 }
        }
      }
    ]),
    TripCatalog.aggregate([
      {
        $match: {
          sourceRouteId: { $ne: null }
        }
      },
      {
        $group: {
          _id: {
            tenantId: "$tenantId",
            routeId: "$sourceRouteId"
          },
          type: { $first: "$type" },
          isActiveAny: {
            $max: {
              $cond: [{ $eq: ["$isActive", true] }, 1, 0]
            }
          }
        }
      },
      { $match: { isActiveAny: 1 } },
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ])
  ]);

  return {
    totalTrips: Number(tripRows[0]?.totalTrips || 0),
    scheduledTrips: Number(tripRows[0]?.scheduledTrips || 0),
    futureTrips: Number(tripRows[0]?.futureTrips || 0),
    totalRoutes: Number(routeRows[0]?.totalRoutes || 0),
    activeRoutes: Number(routeRows[0]?.activeRoutes || 0),
    totalVehicles: Number(vehicleRows[0]?.totalVehicles || 0),
    inventoryMix
  };
}

module.exports = {
  loadCatalogMetricsByTenant,
  loadGlobalCatalogSummary
};
