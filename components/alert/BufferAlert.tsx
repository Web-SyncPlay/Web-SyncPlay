import { FC } from "react"
import Alert, { AlertProps } from "./Alert"
import styles from "./Loading.module.css"
import classNames from "classnames"

const BufferAlert: FC<AlertProps> = ({ className, canClose }) => {
  return (
    <Alert
      className={classNames("cursor-progress", className)}
      canClose={canClose}
    >
      <div className={styles.loading}>Buffering ...</div>
    </Alert>
  )
}

export default BufferAlert
