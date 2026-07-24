const onboardingRepository = require('../../repositories/domain/onboardingRepository');
const { nextId } = require('../data/idService');

function cleanText(value) {
  return String(value || '').replace(/<[^>]*>/g, '').trim();
}

function normalize(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function safePublicId(value) {
  try {
    return decodeURIComponent(cleanText(value || ''));
  } catch (_) {
    return cleanText(value || '');
  }
}

function mediaMatches(media = {}, publicId = '') {
  const key = safePublicId(publicId);
  return [media.publicId, media.public_id, media.id, media.url, media.secureUrl]
    .some((value) => cleanText(value) === key);
}

async function audit(actorId, action, target, metadata = {}) {
  const row = {
    id: await nextId('audit'),
    actorId: actorId || 'admin-system',
    action,
    entityType: 'media_review',
    entityId: target,
    target,
    metadata,
    status: 'success',
    createdAt: new Date().toISOString(),
  };
  await onboardingRepository.auditLogs.save(row, { id: row.id });
  return row;
}

async function findTarget(targetType, targetId) {
  const type = normalize(targetType);
  const id = cleanText(targetId);
  const targets = {
    company: { collection: onboardingRepository.companies, collections: ['documents'] },
    vehicle: { collection: onboardingRepository.vehicles, collections: ['media'] },
    driver: { collection: onboardingRepository.employees, collections: ['documents'], alternate: 'userId' },
    hotelproperty: { collection: onboardingRepository.hotelProperties, collections: ['media'] },
    hotel_property: { collection: onboardingRepository.hotelProperties, collections: ['media'] },
    roomtype: { collection: onboardingRepository.roomTypes, collections: ['images', 'media'] },
    room_type: { collection: onboardingRepository.roomTypes, collections: ['images', 'media'] },
    roomunit: { collection: onboardingRepository.roomUnits, collections: ['documents', 'media'] },
    room_unit: { collection: onboardingRepository.roomUnits, collections: ['documents', 'media'] },
  };
  const config = targets[type];
  if (!config) return null;
  const filter = config.alternate ? { $or: [{ id }, { [config.alternate]: id }] } : { id };
  const entity = await config.collection.findOne(filter);
  return entity ? { ...config, entity, type } : null;
}

async function reviewDocument(targetType, targetId, publicId, status = 'approved', actorId = 'admin-system', payload = {}) {
  const target = await findTarget(targetType, targetId);
  if (!target) {
    const error = new Error('Review target not found');
    error.status = 404;
    throw error;
  }
  const normalizedStatus = normalize(status);
  const safeStatus = ['approved', 'rejected', 'pending_review'].includes(normalizedStatus)
    ? normalizedStatus
    : 'approved';
  let matched = null;
  for (const collectionName of target.collections) {
    const list = Array.isArray(target.entity[collectionName]) ? target.entity[collectionName] : [];
    for (const media of list) {
      if (!mediaMatches(media, publicId)) continue;
      media.status = safeStatus;
      media.reviewedBy = actorId;
      media.reviewedAt = new Date().toISOString();
      media.reviewNotes = cleanText(payload.reviewNotes || payload.note || '');
      matched = media;
      break;
    }
    if (matched) break;
  }
  if (!matched) {
    const error = new Error('Document/media item not found');
    error.status = 404;
    throw error;
  }
  await target.collection.save(target.entity, { id: target.entity.id });
  await audit(actorId, `admin.media_document.${safeStatus}`, target.entity.id, {
    targetType: target.type,
    publicId: matched.publicId || publicId,
    reviewNotes: matched.reviewNotes,
  });
  return { target: target.entity, document: matched };
}

module.exports = { reviewDocument };
