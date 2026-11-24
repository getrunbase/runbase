import Link from "next/link";

const sections = [
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    text: "From zero to a working workspace built by an AI agent.",
  },
  {
    href: "/docs/self-hosting",
    title: "Self-hosting",
    text: "Run Runbase on your own server with Docker.",
  },
  {
    href: "/docs/concepts",
    title: "Concepts",
    text: "Workspaces, data, events, functions, workflows and interfaces.",
  },
  {
    href: "/docs/reference",
    title: "Reference",
    text: "REST API, MCP tools and workflow nodes, generated from the code.",
  },
];

export default function HomePage() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-10 px-4 py-16">
      <div className="flex flex-col gap-4">
        <h1 className="text-4xl font-bold">Runbase documentation</h1>
        <p className="text-lg text-fd-muted-foreground">
          The data, automation and interface platform that AI agents build on,
          through MCP.
        </p>
        <div>
          <Link
            href="/docs/quickstart"
            className="inline-flex rounded-md bg-fd-primary px-4 py-2 font-medium text-fd-primary-foreground"
          >
            Get started
          </Link>
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {sections.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="rounded-lg border bg-fd-card p-4 hover:bg-fd-accent"
          >
            <h2 className="font-semibold">{s.title}</h2>
            <p className="text-sm text-fd-muted-foreground">{s.text}</p>
          </Link>
        ))}
      </div>
    </main>
  );
}
