import { type ReactNode } from "react";
import classNames from "classnames";

export default function NewTabLink({
  href,
  children,
  className,
}: {
  href: string;
  className?: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      className={classNames(
        "hover:text-primary-900 mx-1 transition-colors",
        className,
      )}
      target={"_blank"}
      rel={"noreferrer"}
    >
      {children}
    </a>
  );
}
