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
  return d < SYNC_DELTA
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
