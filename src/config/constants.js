module.exports = {
  ROLES: {
    SUPER_ADMIN: 'super_admin',
    COMPANY_ADMIN: 'company_admin',
    COMPANY_EMPLOYEE: 'company_employee',
    CUSTOMER: 'customer',
    PROMOTER: 'promoter',
  },
  COMPANY_STATUS: {
    PENDING: 'pending',
    VERIFIED: 'verified',
    REJECTED: 'rejected',
    SUSPENDED: 'suspended',
  },
  LISTING_STATUS: {
    DRAFT: 'draft',
    ACTIVE: 'active',
    PAUSED: 'paused',
    ARCHIVED: 'archived',
  },
  BOOKING_STATUS: {
    DRAFT: 'draft',
    CONFIRMED: 'confirmed',
    CHECKED_IN: 'checked_in',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REFUNDED: 'refunded',
  },
  PAYMENT_STATUS: {
    PENDING: 'pending',
    SUCCESSFUL: 'successful',
    FAILED: 'failed',
    REFUNDED: 'refunded',
  },
  ENABLED_BOOKING_TYPES: ['bus', 'hotel'],
};
