const companyService = require('../../services/company/companyService');
const { resolveCompanyId } = require('../../utils/companyScope');

function companyId(req) {
  return resolveCompanyId(req);
}

function rollingSchedulePayload(payload = {}) {
  const departAt = String(payload.departAt || '').trim();
  const timeMatch = departAt.match(/(?:T|\s)((?:[01]\d|2[0-3]):[0-5]\d)/);
  const startDate = departAt.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !timeMatch) {
    const error = new Error('First departure date and time are required');
    error.status = 400;
    throw error;
  }

  let durationMinutes;
  if (payload.arriveAt) {
    const departTime = new Date(departAt).getTime();
    const arrivalTime = new Date(payload.arriveAt).getTime();
    if (Number.isFinite(departTime) && Number.isFinite(arrivalTime) && arrivalTime > departTime) {
      durationMinutes = Math.round((arrivalTime - departTime) / 60000);
    }
  }

  return {
    routeId: payload.routeId,
    vehicleId: payload.vehicleId,
    fareProductId: payload.fareProductId,
    driverId: payload.driverId,
    departureTime: timeMatch[1],
    startDate,
    daysOfWeek: payload.repeatDays,
    durationMinutes,
    blockedSeats: payload.blockedSeats,
    notes: payload.notes,
    timezone: payload.timezone,
    status: String(payload.status || '').toLowerCase() === 'draft' ? 'draft' : 'active',
  };
}

async function create(req, res, next) {
  try {
    if (String(req.body?.departureMode || 'rolling_30_days') !== 'one_off') {
      const rule = await companyService.createScheduleRule(
        companyId(req),
        rollingSchedulePayload(req.body),
        req.session?.user?.id || 'company-admin',
      );
      if (req.flash) {
        req.flash(
          'success',
          rule.status === 'active'
            ? 'Rolling departure saved. The next 30 days are queued now, and one new far-end day is added automatically each day.'
            : 'Rolling departure saved as Draft. Activate it when you want the automatic 30-day window to begin.',
        );
      }
      return res.redirect('/company/schedules-fares');
    }

    const result = await companyService.createScheduleBatch(companyId(req), req.body);
    if (result.publicationDeferred?.length && req.flash) {
      const failures = [...new Set(result.publicationDeferred.flatMap((item) => item.failures || []))];
      req.flash(
        'warning',
        `${result.count} departure${result.count === 1 ? ' was' : 's were'} created safely; ${result.draftCount} remain Draft until ${failures.join(', ') || 'publication checks are completed'}.`,
      );
    }
    const suffix = result.count > 1 ? `?created=${result.count}` : '';
    return res.redirect(`/company/schedules${suffix}`);
  } catch (error) {
    return next(error);
  }
}

async function update(req, res, next) {
  try {
    await companyService.updateSchedule(companyId(req), req.params.id, req.body);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function archive(req, res, next) {
  try {
    await companyService.archiveSchedule(companyId(req), req.params.id);
    res.redirect('/company/schedules');
  } catch (error) {
    next(error);
  }
}

async function publish(req, res, next) {
  try {
    await companyService.publishSchedule(companyId(req), req.params.id);
    res.redirect('/company/schedules');
  } catch (error) {
    if (error.status === 422) return res.status(422).send(error.message);
    next(error);
  }
}

async function updateSeat(req, res, next) {
  try {
    await companyService.updateSeatStatus(companyId(req), req.body);
    res.redirect('/company/seat-maps');
  } catch (error) {
    next(error);
  }
}

async function transition(req, res, next) {
  try {
    await companyService.transitionSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function complete(req, res, next) {
  try {
    await companyService.completeSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/passenger-manifests');
  } catch (error) {
    next(error);
  }
}

async function duplicate(req, res, next) {
  try {
    await companyService.duplicateSchedule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function createRule(req, res, next) {
  try {
    const rule = await companyService.createScheduleRule(companyId(req), req.body, req.session?.user?.id || 'company-admin');
    if (req.flash) {
      req.flash(
        'success',
        rule.status === 'active'
          ? 'Recurring rule saved. The worker is preparing a rolling 30-day departure window; ready dates publish automatically and any date needing attention remains Draft.'
          : 'Recurring rule saved. Activate it when you want the rolling 30-day departure window to begin.',
      );
    }
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function updateRule(req, res, next) {
  try {
    await companyService.updateScheduleRule(companyId(req), req.params.id, req.body, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function pauseRule(req, res, next) {
  try {
    await companyService.pauseScheduleRule(companyId(req), req.params.id, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function resumeRule(req, res, next) {
  try {
    await companyService.resumeScheduleRule(companyId(req), req.params.id, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

async function cancelRule(req, res, next) {
  try {
    await companyService.cancelScheduleRule(companyId(req), req.params.id, req.session?.user?.id || 'company-admin');
    res.redirect('/company/schedules-fares');
  } catch (error) {
    next(error);
  }
}

module.exports = { create, update, archive, publish, updateSeat, transition, duplicate, complete, createRule, updateRule, pauseRule, resumeRule, cancelRule, rollingSchedulePayload };
