import { Copyright, Github } from "lucide-react";
import NewTabLink from "../action/NewTabLink";

export function Footer() {
  return (
    <footer className={"flex w-full flex-col bg-[#1b2735] px-4 py-2"}>
      <div
        className={"flex flex-col gap-2 text-sm sm:flex-row sm:items-center"}
      >
        <div className={"flex flex-row items-center"}>
          <Copyright className={"size-4"} />
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
          <Github className={"mr-2 size-4"} /> Github
        </NewTabLink>
      </div>
    </footer>
  );
}
