import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function getRandomItem<T>(items: T[] | readonly T[]): T {
  if (items.length === 0) {
    throw new Error("Cannot pick a random item from an empty list")
  }
  return items[Math.floor(Math.random() * items.length)]!
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
