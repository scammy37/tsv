const Joi = require('joi');

const { PRIORITIES, STATUSES, ROLES } = require('../constants');

// tlds: false keeps the shape check but skips the IANA TLD list, which would
// otherwise reject valid addresses on new or internal domains.
const email = Joi.string()
  .email({ minDomainSegments: 2, tlds: { allow: false } })
  .max(255).lowercase().trim();
const password = Joi.string().min(8).max(128);
const name = Joi.string().trim().min(1).max(100);
const phone = Joi.string().trim().max(30).allow('', null);
const unitNumber = Joi.string().trim().max(120).allow('', null);

const register = Joi.object({
  email: email.required(),
  password: password.required(),
  firstName: name.required(),
  lastName: name.required(),
  unitNumber,
  phone,
  role: Joi.string().valid(...Object.values(ROLES)).default(ROLES.HOMEOWNER),
  // Required by the route (not here) when role is staff or management.
  staffInviteCode: Joi.string().allow('').optional(),
  // Bot checks, read by services/signupGuard.js and never stored.
  website: Joi.string().allow('').max(500),
  formToken: Joi.string().allow('').max(200),
  elapsedMs: Joi.number().integer().min(0),
});

const login = Joi.object({
  email: email.required(),
  password: Joi.string().required(),
});

const updateProfile = Joi.object({
  firstName: name,
  lastName: name,
  email,
  unitNumber,
  phone,
  // Only meaningful alongside a new email, and required by the route in that
  // case: the address is the login, so moving it is a credential change.
  currentPassword: Joi.string(),
}).min(1);

const changePassword = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: password.required().invalid(Joi.ref('currentPassword'))
    .messages({ 'any.invalid': 'New password must differ from the current one' }),
});

const requestPasswordReset = Joi.object({
  email: email.required(),
});

const resetPassword = Joi.object({
  token: Joi.string().hex().length(64).required(),
  password: password.required(),
});

const createTicket = Joi.object({
  title: Joi.string().trim().min(5).max(255).required(),
  description: Joi.string().trim().min(10).max(10000).required(),
  category: Joi.string().trim().max(50).required(),
  priority: Joi.string().valid(...PRIORITIES).default('medium'),
  locationDetails: Joi.string().trim().max(2000).allow('', null),
  unitNumber,
  // Staff may file a ticket on a homeowner's behalf; ignored for homeowners.
  homeownerId: Joi.number().integer().positive(),
});

const updateTicket = Joi.object({
  title: Joi.string().trim().min(5).max(255),
  description: Joi.string().trim().min(10).max(10000),
  category: Joi.string().trim().max(50),
  locationDetails: Joi.string().trim().max(2000).allow('', null),
  priority: Joi.string().valid(...PRIORITIES),
  status: Joi.string().valid(...STATUSES),
  assignedTo: Joi.number().integer().positive().allow(null),
  resolutionNotes: Joi.string().trim().max(10000).allow('', null),
}).min(1);

const assignTicket = Joi.object({
  assignedTo: Joi.number().integer().positive().allow(null).required(),
});

const listTickets = Joi.object({
  status: Joi.alternatives()
    .try(Joi.string().valid(...STATUSES), Joi.array().items(Joi.string().valid(...STATUSES)))
    .custom((v) => (Array.isArray(v) ? v : [v])),
  priority: Joi.alternatives()
    .try(Joi.string().valid(...PRIORITIES), Joi.array().items(Joi.string().valid(...PRIORITIES)))
    .custom((v) => (Array.isArray(v) ? v : [v])),
  category: Joi.string().trim().max(50),
  assignedTo: Joi.alternatives().try(Joi.number().integer().positive(), Joi.string().valid('unassigned', 'me')),
  homeownerId: Joi.number().integer().positive(),
  q: Joi.string().trim().max(200).allow(''),
  open: Joi.boolean(),
  sort: Joi.string().valid('created_at', 'updated_at', 'priority', 'status').default('created_at'),
  order: Joi.string().valid('asc', 'desc').default('desc'),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(20),
});

const createComment = Joi.object({
  comment: Joi.string().trim().min(1).max(10000).required(),
  isInternal: Joi.boolean().default(false),
});

const listUsers = Joi.object({
  role: Joi.string().valid(...Object.values(ROLES)),
  q: Joi.string().trim().max(200).allow(''),
  includeInactive: Joi.boolean().default(false),
  page: Joi.number().integer().min(1).default(1),
  limit: Joi.number().integer().min(1).max(100).default(50),
});

const updateUser = Joi.object({
  role: Joi.string().valid(...Object.values(ROLES)),
  isActive: Joi.boolean(),
  firstName: name,
  lastName: name,
  email,
  unitNumber,
  phone,
}).min(1);

const idParam = Joi.object({ id: Joi.number().integer().positive().required() });

module.exports = {
  register,
  login,
  updateProfile,
  changePassword,
  requestPasswordReset,
  resetPassword,
  createTicket,
  updateTicket,
  assignTicket,
  listTickets,
  createComment,
  listUsers,
  updateUser,
  idParam,
};
