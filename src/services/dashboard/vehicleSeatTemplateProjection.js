'use strict';

function normalize(value) {
  return String(value || '').trim().toLowerCase();
}

function idOf(row = {}) {
  const value = row && typeof row === 'object' ? row : {};
  return String(value.id || value._id || '').trim();
}

function seatRows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  return [value.seats, value.seatDefinitions, value.seatTemplate, value.layout?.seats].find(Array.isArray) || [];
}

function seatLabel(seat = {}, index = 0) {
  return String(seat.seatNumber || seat.label || seat.displayLabel || seat.code || seat.id || index + 1).trim();
}

function publishedVersionFor(vehicle = {}, versions = []) {
  const vehicleId = idOf(vehicle);
  const pointer = String(vehicle.activeSeatMapVersionId || '').trim();
  const byPointer = versions.find((version) => idOf(version) === pointer);
  if (byPointer) return byPointer;
  return versions
    .filter((version) => String(version.vehicleId || '').trim() === vehicleId && normalize(version.status) === 'published')
    .sort((a, b) => Number(b.version || 0) - Number(a.version || 0))[0] || null;
}

function templateFor(vehicle = {}, templates = []) {
  const vehicleId = idOf(vehicle);
  const pointer = String(vehicle.activeSeatMapTemplateId || '').trim();
  return templates.find((template) => idOf(template) === pointer)
    || templates.find((template) => String(template.vehicleId || '').trim() === vehicleId && normalize(template.status) !== 'archived')
    || null;
}

function projectSeat(seat = {}, index = 0) {
  const status = normalize(seat.status);
  const disabled = seat.enabled === false || seat.isDisabled === true || status === 'disabled';
  const label = seatLabel(seat, index);
  return {
    ...seat,
    id: idOf(seat) || label,
    seatNumber: label,
    label,
    displayLabel: seat.displayLabel || label,
    row: Number(seat.row || seat.rowNumber || 0),
    col: Number(seat.column || seat.col || seat.columnNumber || 0),
    column: Number(seat.column || seat.col || seat.columnNumber || 0),
    seatClass: seat.seatClass || (seat.accessible ? 'Accessible' : disabled ? 'Disabled' : 'Standard'),
    seatType: seat.seatType || (seat.accessible ? 'accessible' : disabled ? 'disabled' : 'standard'),
    enabled: !disabled,
    status: disabled ? 'disabled' : (seat.status || 'available'),
  };
}

function buildVehicleSeatTemplateProjections({ vehicles = [], templates = [], versions = [] } = {}) {
  return vehicles
    .filter((vehicle) => normalize(vehicle.status) !== 'archived')
    .map((vehicle) => {
      const template = templateFor(vehicle, templates);
      const version = publishedVersionFor(vehicle, versions);
      const versionSeats = seatRows(version);
      const sourceSeats = versionSeats.length ? versionSeats : seatRows(vehicle.seatTemplate || vehicle.seatMap || vehicle.layout);
      const seats = sourceSeats.map(projectSeat);
      return {
        ...vehicle,
        id: idOf(vehicle),
        templateId: idOf(template) || vehicle.activeSeatMapTemplateId || '',
        templateName: template?.name || `${vehicle.name || 'Vehicle'} seat map`,
        templateStatus: template?.status || '',
        activeSeatMapVersionId: idOf(version) || vehicle.activeSeatMapVersionId || '',
        seatMapVersion: version?.version || '',
        seatMapStatus: version?.status || '',
        layoutName: version?.layoutName || template?.layoutName || vehicle.layoutName || '2x2',
        seatLabelMode: version?.labelMode || template?.labelMode || vehicle.seatLabelMode || 'automatic',
        seatLabelPrefix: version?.labelPrefix || template?.labelPrefix || vehicle.seatLabelPrefix || '',
        rows: Number(version?.rows || template?.rows || vehicle.rows || 0),
        cols: Number(version?.columns || template?.columns || vehicle.cols || 0),
        columns: Number(version?.columns || template?.columns || vehicle.cols || 0),
        totalSeats: Number(version?.totalSeats || version?.capacity || template?.totalSeats || vehicle.totalSeats || vehicle.capacity || seats.length || 0),
        seats,
        template,
        version,
      };
    });
}

module.exports = {
  buildVehicleSeatTemplateProjections,
  publishedVersionFor,
  templateFor,
  idOf,
  seatRows,
};
