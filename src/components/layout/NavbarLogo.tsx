import Image from "next/image";
import Link from "next/link";
import { env } from "process";
import logo from "../../../public/logo_white.png";

export function NavbarLogo() {
  return (
    <Link
      href={"/"}
      className={"flex shrink-0 flex-row items-center gap-1 rounded p-1"}
    >
      <Image src={logo} alt={"Web-SyncPlay logo"} className="size-9" />
      <span className={"hide-below-sm"}>{env.SITE_NAME}</span>
    </Link>
  );
}
