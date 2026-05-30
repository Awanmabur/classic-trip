const { companyNoticeSchema } = require("./companyNotice");
const { companyPayoutRequestSchema } = require("./companyPayoutRequest");
const { routeSchema } = require("./route");
const { seatBookingSchema } = require("./seatBooking");
const { seatHoldSchema } = require("./seatHold");
const { staffInviteSchema } = require("./staffInvite");
const { tripSchema } = require("./trip");
const { vehicleSchema } = require("./vehicle");

function registerTenantModels(connection) {
  if (!connection.models.CompanyNotice) {
    connection.model("CompanyNotice", companyNoticeSchema);
  }
  if (!connection.models.CompanyPayoutRequest) {
    connection.model("CompanyPayoutRequest", companyPayoutRequestSchema);
  }
  if (!connection.models.Route) {
    connection.model("Route", routeSchema);
  }
  if (!connection.models.SeatBooking) {
    connection.model("SeatBooking", seatBookingSchema);
  }
  if (!connection.models.SeatHold) {
    connection.model("SeatHold", seatHoldSchema);
  }
  if (!connection.models.StaffInvite) {
    connection.model("StaffInvite", staffInviteSchema);
  }
  if (!connection.models.Trip) {
    connection.model("Trip", tripSchema);
  }
  if (!connection.models.Vehicle) {
    connection.model("Vehicle", vehicleSchema);
  }
}

function getTenantModels(connection) {
  registerTenantModels(connection);

  return {
    CompanyNotice: connection.model("CompanyNotice"),
    CompanyPayoutRequest: connection.model("CompanyPayoutRequest"),
    Route: connection.model("Route"),
    SeatBooking: connection.model("SeatBooking"),
    SeatHold: connection.model("SeatHold"),
    StaffInvite: connection.model("StaffInvite"),
    Trip: connection.model("Trip"),
    Vehicle: connection.model("Vehicle")
  };
}

module.exports = {
  getTenantModels,
  registerTenantModels
};
