import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type AddressInfo } from "node:net";
import { AppError } from "../errors/app-error";
import { createEmailSender, mockOutbox } from ".";

const email = { to: ["a@example.com"], subject: "Hi", text: "Hello" };

test("console mode without EMAIL_FROM: the email is kept, no error", async () => {
  const before = mockOutbox.length;
  const { id } = await createEmailSender({}).send(email);
  assert.match(id, /^mock-/);
  assert.equal(mockOutbox.length, before + 1);
  assert.deepEqual(mockOutbox.at(-1), email);
});

test("configured provider without EMAIL_FROM: clear error", () => {
  assert.throws(
    () => createEmailSender({ RESEND_API_KEY: "re_test", EMAIL_FROM: " " }),
    (e: unknown) =>
      e instanceof AppError &&
      e.code === "email.fromRequired" &&
      /EMAIL_FROM is required/.test(e.message),
  );
});

test("Resend uses EMAIL_FROM", async (t) => {
  let body: Record<string, unknown> = {};
  t.mock.method(globalThis, "fetch", async (_url: string, init: RequestInit) => {
    body = JSON.parse(String(init.body));
    return new Response(JSON.stringify({ id: "re_1" }), { status: 200 });
  });
  const sender = createEmailSender({
    RESEND_API_KEY: "re_test",
    EMAIL_FROM: "Acme <team@acme.test>",
  });
  assert.deepEqual(await sender.send(email), { id: "re_1" });
  assert.equal(body.from, "Acme <team@acme.test>");
});

// Minimal SMTP server (no STARTTLS or auth): keeps received messages.
function fakeSmtp() {
  const received: { from: string; to: string[]; data: string }[] = [];
  const server = createServer((socket) => {
    let mail = { from: "", to: [] as string[], data: "" };
    let inData = false;
    let buf = "";
    socket.write("220 fake ESMTP\r\n");
    socket.on("data", (chunk) => {
      buf += chunk.toString();
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            received.push(mail);
            mail = { from: "", to: [], data: "" };
            socket.write("250 OK queued\r\n");
          } else mail.data += line + "\n";
        } else if (/^(EHLO|HELO)/i.test(line)) socket.write("250 fake\r\n");
        else if (/^MAIL FROM:/i.test(line)) {
          mail.from = line.slice(10).split(" ")[0]!;
          socket.write("250 OK\r\n");
        } else if (/^RCPT TO:/i.test(line)) {
          mail.to.push(line.slice(8));
          socket.write("250 OK\r\n");
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go\r\n");
        } else if (/^QUIT/i.test(line)) socket.end("221 bye\r\n");
        else socket.write("250 OK\r\n");
      }
    });
  });
  return { server, received };
}

test("SMTP without Resend key: sent through SMTP_HOST with EMAIL_FROM", async () => {
  const { server, received } = fakeSmtp();
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const port = (server.address() as AddressInfo).port;
    const sender = createEmailSender({
      SMTP_HOST: "127.0.0.1",
      SMTP_PORT: String(port),
      EMAIL_FROM: "team@acme.test",
    });
    const before = mockOutbox.length;
    assert.ok((await sender.send(email)).id);
    assert.equal(mockOutbox.length, before, "no console mode");
    assert.equal(received.length, 1);
    assert.equal(received[0]!.from, "<team@acme.test>");
    assert.deepEqual(received[0]!.to, ["<a@example.com>"]);
    assert.match(received[0]!.data, /Subject: Hi/);
  } finally {
    server.close();
  }
});

test("SMTP without EMAIL_FROM: clear error", () => {
  assert.throws(
    () => createEmailSender({ SMTP_HOST: "smtp.acme.test" }),
    (e: unknown) =>
      e instanceof AppError && /\(SMTP\) is configured/.test(e.message),
  );
});
