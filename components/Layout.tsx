import { FC, ReactNode } from "react"
import Navbar from "./Navbar"
import NoScriptAlert from "./alert/NoScriptAlert"
import Footer from "./Footer"
import Head, { MetaProps } from "./Head"

interface Props {
  meta: MetaProps
  showNavbar?: boolean
  error?: number
  roomId?: string
  children?: ReactNode
}

const Layout: FC<Props> = ({
  meta,
  showNavbar = true,
  error,
  roomId,
  children,
}) => {
  return (
    <div className={"flex flex-col min-h-screen"}>
      <Head customMeta={meta} />
      {showNavbar && (
        <header>
          <Navbar roomId={roomId} />
        </header>
      )}

      <noscript>
        <NoScriptAlert />
      </noscript>

      <main className={"relative flex flex-col grow p-2"}>{children}</main>

      <Footer error={error} />
    </div>
  )
}

export default Layout
