export type StatusVariant = "default" | "success" | "destructive";

export type UiStatus = {
  label: string;
  variant: StatusVariant;
};

export function status(variant: StatusVariant, label: string): UiStatus {
  return { variant, label };
}

export function ok(label: string): UiStatus {
  return status("success", label);
}

export function bad(label: string): UiStatus {
  return status("destructive", label);
}

export function pending(label: string): UiStatus {
  return status("default", label);
}
