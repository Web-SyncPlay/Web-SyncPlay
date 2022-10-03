import { FC } from "react"
import IconGithub from "./icon/IconGithub"
import NewTabLink from "./action/NewTabLink"
import IconCopyright from "./icon/IconCopyright"

interface Props {
  error?: number
}

const Footer: FC<Props> = ({ error }) => {
  return (
    <footer className={"flex flex-col bg-dark-900 py-1 px-4"}>
      {error && <div>Error {error}</div>}
      <div className={"text-sm flex flex-col gap-1 sm:flex-row sm:items-center"}>
        <div className={"flex flex-row items-center"}>
          <IconCopyright sizeClassName={"h-3 w-3"}/>
          <NewTabLink href={"https://github.com/Yasamato"}>Yasamato</NewTabLink>
          2022,
        </div>

        <div>
          Icons by
          <NewTabLink href={"https://heroicons.com"}>Heroicons</NewTabLink>
          and
          <NewTabLink href={"https://fontawesome.com"}>Font Awesome</NewTabLink>
        </div>

        <NewTabLink
          className={"ml-auto flex items-center"}
          href={"https://github.com/Web-SyncPlay/Web-SyncPlay"}
        >
          <IconGithub className={"mr-1"} /> Github
        </NewTabLink>
      </div>
    </footer>
  )
}

export default Footer
