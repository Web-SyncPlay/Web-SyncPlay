import { canPlayNatively, isNativeProviderUrl } from "@/shared/player-utils"

export function detectNativeSupport(url: string) {
  return {
    canPlayNatively: canPlayNatively(url),
    isNativeProvider: isNativeProviderUrl(url),
  }
}
