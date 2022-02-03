import NextHead from "next/head"
import { getSiteDomain, getSiteName } from "../lib/env"
import { useRouter } from "next/router"

export interface MetaProps {
  title?: string
  description?: string
  image?: string
  type?: string
  robots?: string
}

const Head = ({ customMeta }: { customMeta?: MetaProps }) => {
  const router = useRouter()

  const meta: MetaProps = {
    title: getSiteName(),
    description: "Watch videos or play music in sync with your friends",
    type: "website",
    robots: "noindex, noarchive, follow",
    image: getSiteDomain() + "/apple-touch-icon.png",
    ...customMeta,
  }

  return (
    <NextHead>
      <title>{meta.title}</title>
      <meta property='og:url' content={`${getSiteDomain()}${router.asPath}`} />
      <link rel='canonical' href={`${getSiteDomain()}${router.asPath}`} />
      <meta property='og:type' content='website' />
      <meta property='og:site_name' content={getSiteName()} />
      <meta property='og:description' content={meta.description} />
      <meta property='og:title' content={meta.title} />
      {meta.image && <meta property='og:image' content={meta.image} />}
      <meta name='twitter:card' content='summary' />
      <meta name='twitter:title' content={meta.title} />
      <meta name='twitter:description' content={meta.description} />
      {meta.image && <meta name='twitter:image' content={meta.image} />}
      <meta name={"robots"} content={meta.robots} />
    </NextHead>
  )
}

export default Head
