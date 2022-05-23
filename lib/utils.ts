import {
  adjectives,
  animals,
  colors,
  names,
  starWars,
  uniqueNamesGenerator,
} from "unique-names-generator"

export const isBrowser = () => typeof window !== "undefined"

export const secondsToTime = (s: number): string => {
  if (isNaN(s)) {
    return "00:00"
  }

  const hours = Math.floor(s / 3600)
  const minutes = Math.floor((s - hours * 3600) / 60)
  const seconds = Math.floor(s - hours * 3600 - minutes * 60)
  if (hours === 0) {
    return (
      (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) +
      ":" +
      (seconds > 9 ? seconds.toString() : "0" + seconds.toString())
    )
  }
  return (
    (hours > 9 ? hours.toString() : "0" + hours.toString()) +
    ":" +
    (minutes > 9 ? minutes.toString() : "0" + minutes.toString()) +
    ":" +
    (seconds > 9 ? seconds.toString() : "0" + seconds.toString())
  )
}

/**
 * Time in s which is considered in sync
 */
export const SYNC_DELTA = 3
export const SYNC_PAUSED_DELTA = 0.2

export const isSync = (
  playerTime: number,
  targetProgress: number,
  lastSync: number,
  paused: boolean,
  playbackRate: number = 1
) => {
  const d =
    Math.abs(
      getTargetTime(targetProgress, lastSync, paused, playbackRate) - playerTime
    ) * playbackRate
  return d < (paused ? SYNC_PAUSED_DELTA : SYNC_DELTA)
}

export const getTargetTime = (
  targetProgress: number,
  lastSync: number,
  paused: boolean,
  playbackRate: number
) => {
  if (paused) {
    return targetProgress
  }

  const time = new Date().getTime() / 1000
  return targetProgress + (time - lastSync) * playbackRate
}

export const getRandomItem = (list: any[] | string) => {
  return list[Math.round(Math.random() * (list.length - 1))]
}

export const generateId = (length: number = 4) => {
  let result = "",
    chars = "abcdefghijklmnopqrstuvwxyz"
  for (let i = 0; i < length; i++) {
    result += getRandomItem(chars)
  }
  return result
}

const nameLists = [adjectives, animals, colors, starWars, names]

export const getRandomName = (words = 2) => {
  let dictionaries = []
  for (let i = 0; i < words; i++) {
    dictionaries.push(getRandomItem(nameLists))
  }

  return uniqueNamesGenerator({
    dictionaries,
    length: words,
    style: "capital",
  }).replace("_", " ")
}

export const isUrl = (url: string) => {
  // hell of a regex from @diegoperini, taken from https://mathiasbynens.be/demo/url-regex, note e.g. \x{ffff} is converted to \uffff
  return !!url.match(
    /^https?:\/\/(?:\S+(?::\S*)?@)?(?:(?!10(?:\.\d{1,3}){3})(?!127(?:\.\d{1,3}){3})(?!169\.254(?:\.\d{1,3}){2})(?!192\.168(?:\.\d{1,3}){2})(?!172\.(?:1[6-9]|2\d|3[0-1])(?:\.\d{1,3}){2})(?:[1-9]\d?|1\d\d|2[01]\d|22[0-3])(?:\.(?:1?\d{1,2}|2[0-4]\d|25[0-5])){2}\.(?:[1-9]\d?|1\d\d|2[0-4]\d|25[0-4])|(?:[a-z\u00a1-\uffff\d]+-?)*[a-z\u00a1-\uffff\d]+(?:\.(?:[a-z\u00a1-\uffff\d]+-?)*[a-z\u00a1-\uffff\d]+)*\.[a-z\u00a1-\uffff]{2,})(?::\d{2,5})?(?:\/\S*)?$/
  )
}

export const shellSanitizeUrl = (url: string) => {
  return url.replace(/(&&)+/g, "&").replace(/([<>$;\\|])+/, "")
}

export const getDomain = (url: string) => {
  const matches = url.match(/^(?:https?:)?(?:\/\/)?([^\/?]+)/)
  return ((matches && matches[1]) || url).replace(/^www\./, "")
}
