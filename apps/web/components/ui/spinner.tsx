import { cn } from "cn";
import { Loader2Icon } from "lucide-react";
import { useUiLabels } from "@/components/ui-labels";

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const labels = useUiLabels();
  return (
    <Loader2Icon
      role="status"
      aria-label={labels.loading}
      className={cn("size-4 animate-spin", className)}
      {...props}
    />
  );
}

export { Spinner };
