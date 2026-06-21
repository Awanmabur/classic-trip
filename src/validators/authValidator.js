const { body } = require('express-validator');

const loginRules = [
  body('identity').notEmpty().trim(),
  body('password').notEmpty(),
];

const registerRules = [
  body('email').isEmail().normalizeEmail(),
  body('phone').notEmpty().trim(),
  body('role').optional().trim(),
  body('password').isLength({ min: 8 }).withMessage('Password must be at least 8 characters'),
  body('confirmPassword').custom((value, { req }) => {
    if (value && value !== req.body.password) throw new Error('Passwords do not match');
    return true;
  }),
  body().custom((value) => {
    if (String(value.fullName || '').trim()) return true;
    if (String(value.firstName || '').trim() && String(value.lastName || '').trim()) return true;
    throw new Error('Full name is required');
  }),
  body().custom((value) => {
    const role = String(value.role || 'customer').toLowerCase().trim();
    const needsCompany = ['partner', 'company', 'company_admin', 'employee', 'staff', 'company_employee'].includes(role);
    if (!needsCompany) return true;
    if (String(value.company || value.companyName || value.businessName || value.organization || value.companyId || '').trim()) return true;
    throw new Error('Company name is required for partner and employee signup');
  }),
];

module.exports = { loginRules, registerRules };
