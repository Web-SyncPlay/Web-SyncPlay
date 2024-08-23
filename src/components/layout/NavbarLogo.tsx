import Image from "next/image";
import Link from "next/link";
import logo from "../../../public/logo_white.png";
import { env } from "~/env";

export function NavbarLogo() {
  return (
    <Link href={"/"} className={"flex shrink-0 items-center gap-2"}>
      <Image src={logo} alt={"Web-SyncPlay logo"} className="size-9" />
      <span className={"hidden sm:block"}>{env.NEXT_PUBLIC_SITE_NAME}</span>
    </Link>
  );
}
