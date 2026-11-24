// Authentication emails. Core in English only (project rule).

// Mail clients ignore CSS variables: hard-coded grey on purpose.
/* eslint-disable no-restricted-syntax */
// Escapes a value interpolated into HTML (href attribute or text).
export const escapeHtml = (v: string) =>
  v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const magicLinkEmail = (url: string) => ({
  subject: "Your Runbase sign-in link",
  text: `To sign in to Runbase, open this link (valid for 15 minutes):\n\n${url}\n\nDidn't request this? Ignore this email.`,
  html: `<p>To sign in to Runbase, click the link below (valid for 15 minutes).</p><p><a href="${escapeHtml(url)}">Sign in to Runbase</a></p><p style="color:#666">Didn't request this? Ignore this email.</p>`,
});

// Password reset email (AUTH_METHOD=password).
export const resetPasswordEmail = (url: string) => ({
  subject: "Reset your Runbase password",
  text: `To choose a new Runbase password, open this link (valid for 1 hour):\n\n${url}\n\nDidn't request this? Ignore this email.`,
  html: `<p>To choose a new Runbase password, click the link below (valid for 1 hour).</p><p><a href="${escapeHtml(url)}">Reset my password</a></p><p style="color:#666">Didn't request this? Ignore this email.</p>`,
});
// Address verification email (AUTH_METHOD=password).
export const verifyEmailEmail = (url: string) => ({
  subject: "Verify your Runbase email address",
  text: `To verify your email address, open this link:\n\n${url}\n\nDidn't request this? Ignore this email.`,
  html: `<p>To verify your email address, click the link below.</p><p><a href="${escapeHtml(url)}">Verify my address</a></p><p style="color:#666">Didn't request this? Ignore this email.</p>`,
});
/* eslint-enable no-restricted-syntax */
