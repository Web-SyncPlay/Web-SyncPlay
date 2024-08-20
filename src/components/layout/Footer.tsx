import { Copyright, Github } from "lucide-react";
import NewTabLink from "../action/NewTabLink";

export function Footer() {
  return (
    <footer className={"bg-dark-900 flex flex-col px-4 py-1"}>
      <div
        className={"flex flex-col gap-1 text-sm sm:flex-row sm:items-center"}
      >
        <div className={"flex flex-row items-center"}>
          <Copyright className={"size-3"} />
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
          <Github className={"mr-1"} /> Github
        </NewTabLink>
      </div>
    </footer>
  );
}
