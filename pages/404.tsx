import Layout from "../components/Layout"

export default function Error404() {
  return (
    <Layout
      meta={{
        title: "Not Found",
        description: "The requested site could not be found ...",
      }}
      error={404}
    >
      There is nothing to be found here :/
    </Layout>
  )
}
