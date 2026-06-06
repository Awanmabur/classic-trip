const actionService = require('../../services/dashboard/actionService');

function companyId(req) {
  return req.session?.user?.companyId || req.body.companyId || 'company-01';
}

function actorId(req) {
  return req.session?.user?.id || 'employee-system';
}

async function createBooking(req, res, next) {
  try {
    await actionService.createManualBooking(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#bookings');
  } catch (error) {
    next(error);
  }
}

async function updateInventory(req, res, next) {
  try {
    await actionService.updateEmployeeInventory(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#inventory');
  } catch (error) {
    next(error);
  }
}

async function sendDelayNotice(req, res, next) {
  try {
    await actionService.sendDelayNotice(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#schedule');
  } catch (error) {
    next(error);
  }
}

async function recordPayment(req, res, next) {
  try {
    await actionService.recordEmployeePayment(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#payments');
  } catch (error) {
    next(error);
  }
}

async function requestRefund(req, res, next) {
  try {
    await actionService.requestEmployeeRefund(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#refunds');
  } catch (error) {
    next(error);
  }
}

async function createSupportNotice(req, res, next) {
  try {
    await actionService.createEmployeeSupportNotice(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#support');
  } catch (error) {
    next(error);
  }
}

async function createCustomerNote(req, res, next) {
  try {
    await actionService.createCustomerNote(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#customers');
  } catch (error) {
    next(error);
  }
}

async function updateSupport(req, res, next) {
  try {
    await actionService.updateSupportTicket(companyId(req), req.params.id, req.body, actorId(req));
    res.redirect('/employee/dashboard#support');
  } catch (error) {
    next(error);
  }
}

async function createHandover(req, res, next) {
  try {
    await actionService.createHandover(companyId(req), req.body, actorId(req));
    res.redirect('/employee/dashboard#handover');
  } catch (error) {
    next(error);
  }
}

async function updateProfile(req, res, next) {
  try {
    const actorRole = req.session?.user?.role || 'company_employee';
    await actionService.updateEmployeeProfile(companyId(req), req.body, actorId(req), {
      canManageProfileAssignments: ['company_admin', 'super_admin'].includes(actorRole),
    });
    if (req.session?.user) {
      req.session.user.fullName = req.body.fullName || req.session.user.fullName;
      req.session.user.phone = req.body.phone || req.session.user.phone;
      req.session.user.email = req.body.email || req.session.user.email;
    }
    res.redirect('/employee/dashboard#profile');
  } catch (error) {
    next(error);
  }
}

module.exports = {
  createBooking,
  updateInventory,
  sendDelayNotice,
  recordPayment,
  requestRefund,
  createSupportNotice,
  createCustomerNote,
  updateSupport,
  createHandover,
  updateProfile,
};
