import Alert, { type AlertProps } from "./Alert";

export default function NoScriptAlert({
  className = "",
  canClose = true,
}: AlertProps) {
  return (
    <Alert className={className} canClose={canClose}>
      Well... it seems like you disabled javascript.
    </Alert>
  );
}
