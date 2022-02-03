import React, { FC } from "react"
import Alert, { AlertProps } from "./Alert"

const NoScriptAlert: FC<AlertProps> = ({ className = "", canClose = true }) => {
  return (
    <Alert className={className} canClose={canClose}>
      Well... it seems like you disabled javascript.
    </Alert>
  )
}

export default NoScriptAlert
