// pnpm admin:create <email> [name]: creates an account (owner of its own
// organization), even with signups closed. Then sign in by magic link.
// Platform admin: add the email to PLATFORM_ADMIN_EMAILS.
export {};

const [email, name = "Admin"] = process.argv.slice(2);
if (!email) {
  console.error("Usage : pnpm admin:create <email> [nom]");
  process.exit(1);
}
const { auth } = await import("../auth/index");
const { internalAdapter } = await auth.$context;
const user = await internalAdapter.createUser(
  { email: email.toLowerCase(), name, emailVerified: true },
  { method: "admin" },
);
console.log(`Account created: ${user.email}`);
process.exit(0);
