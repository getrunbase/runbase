// Page header (N4zA5 board "Page header"): title 28/700, description
// 14 muted, actions aligned bottom right.
export function PageHeader({
  title,
  description,
  children,
}: {
  title: string;
  description?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-4">
      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <h1 className="tracking-page text-2xl font-bold">{title}</h1>
        {description && (
          <p className="text-muted-foreground text-base">{description}</p>
        )}
      </div>
      {children && <div className="flex flex-wrap gap-2">{children}</div>}
    </div>
  );
}
