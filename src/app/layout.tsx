import "~/styles/globals.css";

import { type Metadata } from "next";
import NoScriptAlert from "~/components/alert/NoScriptAlert";
import { env } from "~/env";
import { GeistSans } from "geist/font/sans";
import Providers from "./providers";

export const metadata: Metadata = {
  title: env.SITE_NAME,
  description: "Watch videos or play music in sync with your friends",
  icons: [
    { rel: "apple-touch-icon", url: "/apple-touch-icon.png" },
    { rel: "icon", url: "/favicon-32x32.png" },
    { rel: "icon", url: "/favicon.ico" },
  ],
  robots: "index, archive, nofollow",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={GeistSans.className}>
      <head>
        <meta charSet="UTF-8" />
        <meta content="IE=Edge" httpEquiv="X-UA-Compatible" />
        <meta
          name="viewport"
          content="width=device-width,initial-scale=1,shrink-to-fit=no"
        />

        <meta name="copyright" content="Yasamato, 2022" />
        <meta name="author" content="Yasamato <https://github.com/Yasamato" />

        <link rel="manifest" href="/site.webmanifest" />
        <link rel="mask-icon" href="/safari-pinned-tab.svg" color="#28a745" />
        <meta name="apple-mobile-web-app-title" content={env.SITE_NAME} />
        <meta name="application-name" content={env.SITE_NAME} />
        <meta name="msapplication-TileColor" content="#2b5797" />
        <meta name="msapplication-TileImage" content="/mstile-144x144.png" />
        <meta name="theme-color" content="#28a745" />
        <link rel="canonical" href="/" data-react-helmet="true" />
      </head>

      <body className="flex min-h-screen flex-col items-center justify-center bg-[#090a0f] text-white">
        <noscript>
          <NoScriptAlert />
        </noscript>

        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
