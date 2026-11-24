import * as React from "react";
import { cn } from "../../lib/utils";

function Table({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <div data-slot="table-container" className="relative w-full overflow-x-auto">
      <table data-slot="table" className={cn("w-full caption-bottom text-sm", className)} {...props} />
    </div>
  );
}

// Board eillb: Table header (NtOgD) height 32, top and bottom border.
function TableHeader({ className, ...props }: React.ComponentProps<"thead">) {
  return <thead data-slot="table-header" className={cn("[&_tr]:h-8 [&_tr]:border-y [&_tr]:border-border", className)} {...props} />;
}

function TableBody({ className, ...props }: React.ComponentProps<"tbody">) {
  return <tbody data-slot="table-body" className={className} {...props} />;
}

function TableFooter({ className, ...props }: React.ComponentProps<"tfoot">) {
  return <tfoot data-slot="table-footer" className={cn("border-t border-border bg-muted font-medium", className)} {...props} />;
}

// Table row (ETMvS): height row-height 36, bottom border.
function TableRow({ className, ...props }: React.ComponentProps<"tr">) {
  return (
    <tr
      data-slot="table-row"
      className={cn("h-row border-b border-border transition-colors hover:bg-muted data-[state=selected]:bg-muted", className)}
      {...props}
    />
  );
}

// Header cell: padding 0/8, text-xs 12 / 500 muted-foreground.
function TableHead({ className, ...props }: React.ComponentProps<"th">) {
  return (
    <th
      data-slot="table-head"
      className={cn("px-2 text-left align-middle text-xs font-medium whitespace-nowrap text-muted-foreground", className)}
      {...props}
    />
  );
}

// Cell: padding 0/8, text-sm 13 / 400 muted; first cell 500 foreground.
function TableCell({ className, ...props }: React.ComponentProps<"td">) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        "px-2 align-middle text-sm whitespace-nowrap text-muted-foreground first:font-medium first:text-foreground",
        className,
      )}
      {...props}
    />
  );
}

function TableCaption({ className, ...props }: React.ComponentProps<"caption">) {
  return <caption data-slot="table-caption" className={cn("mt-4 text-sm text-muted-foreground", className)} {...props} />;
}

export { Table, TableHeader, TableBody, TableFooter, TableHead, TableRow, TableCell, TableCaption };
