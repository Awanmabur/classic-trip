const generateReferralCode = require('../utils/generateReferralCode');

module.exports = [
  { id: 'user-admin-001', role: 'super_admin', fullName: 'Classic Trip Admin', email: 'admin@classictrip.test', phone: '+256700000001', status: 'active', isVerified: true },
  { id: 'user-company-001', role: 'company_admin', fullName: 'Partner Admin', email: 'company@classictrip.test', phone: '+256700000002', status: 'active', isVerified: true, companyId: 'company-01' },
  { id: 'user-employee-001', role: 'company_employee', fullName: 'Gate Scanner', email: 'employee@classictrip.test', phone: '+256700000003', status: 'active', isVerified: true, companyId: 'company-01' },
  { id: 'user-customer-001', role: 'customer', fullName: 'Amina Nakanwagi', email: 'amina@classictrip.test', phone: '+256700000004', status: 'active', isVerified: true },
  { id: 'user-promoter-001', role: 'promoter', fullName: 'Samuel Kato', email: 'samuel@classictrip.test', phone: '+256700000005', status: 'active', isVerified: true, referralCode: generateReferralCode('Samuel Kato') },
];
