export const ROLE_LEVEL = { admin: 4, manager: 3, cashier: 2, clerk: 1, customer: 0 };

// Minimum role required to view each staff page (mirrors backend gates).
export const PAGE_ROLES = {
  '/': 'clerk',
  '/pos': 'cashier',
  '/products': 'clerk',
  '/inventory': 'admin',
  '/sales': 'cashier',
  '/purchases': 'admin',
  '/suppliers': 'manager',
  '/customers': 'clerk',
  '/expenses': 'manager',
  '/reports': 'manager',
  '/orders': 'clerk',
  '/messages': 'manager',
  '/users': 'manager',
  '/settings': 'admin',
};

export function canRole(user, minRole) {
  if (!user) return false;
  if (!minRole) return true;
  const level = ROLE_LEVEL[user.role];
  const min = ROLE_LEVEL[minRole];
  if (level === undefined || min === undefined) return false;
  return level >= min;
}
