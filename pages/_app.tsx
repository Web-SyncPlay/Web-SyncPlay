import Head from "next/head"

import "./global.css"
import "react-tooltip/dist/react-tooltip.css"
import { getSiteName } from "../lib/env"
import { AppProps } from "next/app"

const App = ({ Component, pageProps }: AppProps) => {
  return (
    <>
      <Head>
        <meta charSet='UTF-8' />
        <meta content='IE=Edge' httpEquiv='X-UA-Compatible' />
        <meta
          name='viewport'
          content='width=device-width,initial-scale=1,shrink-to-fit=no'
        />

        <meta
          name='description'
          content='Watch videos or play music in sync with your friends'
        />

        <meta name='copyright' content='Yasamato, 2022' />
        <meta name='author' content='Yasamato <https://github.com/Yasamato' />

        <link
          rel='apple-touch-icon'
          sizes='180x180'
          href='/apple-touch-icon.png'
        />
        <link
          rel='icon'
          type='image/png'
          sizes='32x32'
          href='/favicon-32x32.png'
        />
        <link rel='icon' href='/favicon.ico' />
        <link rel='manifest' href='/site.webmanifest' />
        <link rel='mask-icon' href='/safari-pinned-tab.svg' color='#28a745' />
        <meta name='apple-mobile-web-app-title' content={getSiteName()} />
        <meta name='application-name' content={getSiteName()} />
        <meta name='msapplication-TileColor' content='#2b5797' />
        <meta name='msapplication-TileImage' content='/mstile-144x144.png' />
        <meta name='theme-color' content='#28a745' />
        <link rel='canonical' href='/' data-react-helmet='true' />
      </Head>

      <Component {...pageProps} />
    </>
  )
}

export default App
