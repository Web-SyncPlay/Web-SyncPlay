import { FC } from "react"
import IconGithub from "./icon/IconGithub"
import NewTabLink from "./action/NewTabLink"

interface Props {
  error?: number
}

const Footer: FC<Props> = ({ error }) => {
  return (
    <footer className={"flex flex-col bg-dark-900 py-2 px-4"}>
      {error && <div>Error {error}</div>}
      <div className={"flex flex-row items-center"}>
        (c)
        <NewTabLink href={"https://github.com/Yasamato"}>Yasamato</NewTabLink>
        2022, Icons by{" "}
        <NewTabLink href={"https://heroicons.com"}>Heroicons</NewTabLink> and
        <NewTabLink href={"https://fontawesome.com"}>Font Awesome</NewTabLink>
        <NewTabLink
          className={"ml-auto flex"}
          href={"https://github.com/Web-SyncPlay/Web-SyncPlay"}
        >
          <IconGithub className={"mr-2"} /> Github
        </NewTabLink>
      </div>
    </footer>
  )
}

export default Footer
