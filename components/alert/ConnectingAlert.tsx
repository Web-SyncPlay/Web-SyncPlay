import { FC } from "react"
import IconLoading from "../icon/IconLoading"
import Alert, { AlertProps } from "./Alert"
import styles from "./Loading.module.css"
import classNames from "classnames"

const ConnectingAlert: FC<AlertProps> = ({
  className = "",
  canClose = false,
}) => {
  return (
    <Alert canClose={canClose} className={classNames("cursor-wait", className)}>
      <IconLoading className={"hide-below-sm animate-spin"} />
      <div className={styles.loading}>Connecting ...</div>
    </Alert>
  )
}

export default ConnectingAlert
