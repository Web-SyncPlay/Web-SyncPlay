import { LoaderCircle } from "lucide-react";
import Alert, { type AlertProps } from "./Alert";
import styles from "./Loading.module.css";
import classNames from "classnames";

export default function ConnectingAlert({
  className = "",
  canClose = false,
}: AlertProps) {
  return (
    <Alert canClose={canClose} className={classNames("cursor-wait", className)}>
      <LoaderCircle className={"hide-below-sm animate-spin"} />
      <div className={styles.loading}>Connecting ...</div>
    </Alert>
  );
}
