// Sending emails: Resend if RESEND_API_KEY, otherwise SMTP if SMTP_HOST, otherwise
// console mode (the email is logged and kept in memory: dev, tests).
// setEmailSender installs another one.
import { createTransport } from "nodemailer";
import { appError } from "../errors/app-error";

export type Email = {
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
};

export type EmailSender = {
  send: (email: Email) => Promise<{ id: string }>;
};

type Env = Record<string, string | undefined>;

// Neutral sender of console mode (no email is actually sent).
export const DEFAULT_FROM = "noreply@localhost";

// Console mode: "sent" emails stay in memory (tests) and are
// printed in the logs outside `node --test` (sign-in link in dev).
export const mockOutbox: Email[] = [];
const consoleSender = (from: string, log: boolean): EmailSender => ({
  send: async (email) => {
    mockOutbox.push(email);
    if (log)
      console.info(
        `[email:console] from=${from} to=${email.to.join(",")} subject=${email.subject}\n${email.text}`,
      );
    return { id: `mock-${mockOutbox.length}` };
  },
});

// Resend (HTTP API, no SDK).
const resendSender = (key: string, from: string): EmailSender => ({
  send: async (email) => {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${key}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        reply_to: email.replyTo,
      }),
    });
    if (!res.ok)
      throw appError("email.sendFailed", "Email send failed ({status}): {detail}", {
        status: res.status,
        detail: await res.text(),
      });
    return (await res.json()) as { id: string };
  },
});

// SMTP (self-hosting): port 465 = direct TLS, otherwise STARTTLS if offered.
const smtpSender = (env: Env, from: string): EmailSender => {
  const port = Number(env.SMTP_PORT || 587);
  const transport = createTransport({
    host: env.SMTP_HOST,
    port,
    secure: env.SMTP_SECURE ? env.SMTP_SECURE === "true" : port === 465,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" }
      : undefined,
  });
  return {
    send: async (email) => {
      const info = await transport.sendMail({
        from,
        to: email.to,
        subject: email.subject,
        text: email.text,
        html: email.html,
        replyTo: email.replyTo,
      });
      return { id: info.messageId };
    },
  };
};

// A real provider requires an explicit sender (verified domain).
const requireFrom = (env: Env, provider: string) => {
  const from = env.EMAIL_FROM?.trim();
  if (!from)
    throw appError(
      "email.fromRequired",
      "EMAIL_FROM is required when an email provider ({provider}) is configured",
      { provider },
    );
  return from;
};

// Picks the sender from the environment.
export const createEmailSender = (env: Env): EmailSender => {
  if (env.RESEND_API_KEY)
    return resendSender(env.RESEND_API_KEY, requireFrom(env, "Resend"));
  if (env.SMTP_HOST) return smtpSender(env, requireFrom(env, "SMTP"));
  return consoleSender(
    env.EMAIL_FROM?.trim() || DEFAULT_FROM,
    !process.env.NODE_TEST_CONTEXT,
  );
};

// Resolved on the first send: an invalid config does not prevent startup
// but every send fails with a clear error. Never a real send under
// `node --test` (NODE_TEST_CONTEXT), even with the key.
let sender: EmailSender | undefined;
const fromProcessEnv = (): EmailSender =>
  createEmailSender(
    process.env.NODE_TEST_CONTEXT
      ? { EMAIL_FROM: process.env.EMAIL_FROM }
      : process.env,
  );
export const emailSender = (): EmailSender =>
  sender ?? {
    send: async (email) => {
      sender = fromProcessEnv();
      return sender.send(email);
    },
  };
export const setEmailSender = (s: EmailSender) => {
  sender = s;
};
