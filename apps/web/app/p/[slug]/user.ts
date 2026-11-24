// User exposed to page bindings (`{{user.*}}`): minimal
// session identity, no token or other sensitive data.
export const pageUser = (u: { id: string; email: string; name: string }) => ({
  id: u.id,
  email: u.email,
  name: u.name,
});
