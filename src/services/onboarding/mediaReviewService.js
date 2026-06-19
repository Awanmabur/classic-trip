const store = require('../data/persistentStore');
const { mongoose } = require('../../config/db');

function cleanText(value) { return String(value || '').replace(/<[^>]*>/g, '').trim(); }
function normalize(value) { return cleanText(value).toLowerCase(); }
function safePublicId(value) { return decodeURIComponent(cleanText(value || '')); }
function mediaMatches(media = {}, publicId = '') {
  const key = safePublicId(publicId);
  return [media.publicId, media.public_id, media.id, media.url, media.secureUrl].some((value) => cleanText(value) === key);
}
function audit(actorId, action, target, meta = {}) {
  store.state.auditLogs.push({ id: `audit-${store.state.auditLogs.length + 1}`, actorId, action, target, meta, createdAt: new Date().toISOString() });
}
async function persist(modelName, row) {
  if (!row || mongoose.connection.readyState !== 1) return;
  require(`../../models/${modelName}`);
  const Model = mongoose.model(modelName);
  await Model.updateOne({ id: row.id }, { $set: row }, { upsert: true, runValidators: true });
}
function findTarget(targetType, targetId) {
  const type = normalize(targetType);
  const id = cleanText(targetId);
  if (type === 'company') return { model: 'Company', entity: store.findCompany(id), collections: ['documents'] };
  if (type === 'vehicle') return { model: 'Vehicle', entity: store.state.vehicles.find((row) => row.id === id), collections: ['media'] };
  if (type === 'driver') return { model: 'CompanyEmployee', entity: store.state.companyEmployees.find((row) => row.id === id || row.userId === id), collections: ['documents'] };
  if (type === 'hotelproperty' || type === 'hotel_property') return { model: 'HotelProperty', entity: store.state.hotelProperties.find((row) => row.id === id), collections: ['media'] };
  if (type === 'roomtype' || type === 'room_type') return { model: 'RoomType', entity: store.state.roomTypes.find((row) => row.id === id), collections: ['images', 'media'] };
  if (type === 'roomunit' || type === 'room_unit') return { model: 'RoomUnit', entity: store.state.roomUnits.find((row) => row.id === id), collections: ['documents', 'media'] };
  return { model: '', entity: null, collections: [] };
}
async function reviewDocument(targetType, targetId, publicId, status = 'approved', actorId = 'admin-system', payload = {}) {
  const target = findTarget(targetType, targetId);
  if (!target.entity) { const error = new Error('Review target not found'); error.status = 404; throw error; }
  const safeStatus = ['approved', 'rejected', 'pending_review'].includes(normalize(status)) ? normalize(status) : 'approved';
  let matched = null;
  for (const collection of target.collections) {
    const list = Array.isArray(target.entity[collection]) ? target.entity[collection] : [];
    list.forEach((media) => {
      if (mediaMatches(media, publicId)) {
        media.status = safeStatus;
        media.reviewedBy = actorId;
        media.reviewedAt = new Date().toISOString();
        media.reviewNotes = cleanText(payload.reviewNotes || payload.note || '');
        matched = media;
      }
    });
  }
  if (!matched) { const error = new Error('Document/media item not found'); error.status = 404; throw error; }
  await persist(target.model, target.entity);
  audit(actorId, `admin.media_document.${safeStatus}`, target.entity.id, { targetType, publicId: matched.publicId || publicId, reviewNotes: matched.reviewNotes });
  return { target: target.entity, document: matched };
}

module.exports = { reviewDocument };
