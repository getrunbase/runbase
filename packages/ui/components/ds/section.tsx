import { cn } from "../../lib/utils";

/** Site content width: 1120px (1440 - 2x160, see Site footer), gutter 16/24. */
export function Container({ className, ...props }: React.ComponentProps<"div">) {
  return <div className={cn("mx-auto w-full max-w-[1168px] px-4 sm:px-6", className)} {...props} />;
}

/** Site page section: 64px then 112px at the top. */
export function Section({ className, children, ...props }: React.ComponentProps<"section">) {
  return (
    <section className={cn("pt-16 md:pt-28", className)} {...props}>
      <Container>{children}</Container>
    </section>
  );
}
