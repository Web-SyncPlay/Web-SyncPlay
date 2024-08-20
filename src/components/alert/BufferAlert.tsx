import Alert, { type AlertProps } from "./Alert";
import styles from "./Loading.module.css";
import classNames from "classnames";

export default function BufferAlert({ className, canClose }: AlertProps) {
  return (
    <Alert
      className={classNames("cursor-progress", className)}
      canClose={canClose}
    >
      <div className={styles.loading}>Buffering ...</div>
    </Alert>
  );
}
