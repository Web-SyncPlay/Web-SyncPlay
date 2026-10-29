import { getBuildInfo, GITHUB_REPO_URL } from "@/shared/build-info"

import { SiteFooterClient } from "./SiteFooterClient"

export function SiteFooter() {
  const build = getBuildInfo()

  return (
    <SiteFooterClient
      githubRepoUrl={GITHUB_REPO_URL}
      appVersion={build.appVersion}
      appReleaseUrl={build.appReleaseUrl}
      gitShaShort={build.gitShaShort}
      gitCommitUrl={build.gitCommitUrl}
      ytDlpVersion={build.ytDlpVersion}
      ytDlpReleaseUrl={build.ytDlpReleaseUrl}
    />
  )
}
