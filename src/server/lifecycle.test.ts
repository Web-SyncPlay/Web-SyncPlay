import {
  isProcessDraining,
  markProcessDraining,
  registerShutdownHandler,
  resetLifecycleForTests,
  runShutdownHandlersForTests,
} from "@/server/lifecycle"
import { afterEach, describe, expect, test } from "bun:test"

describe("lifecycle drain", () => {
  afterEach(() => {
    resetLifecycleForTests({ exitProcess: false })
  })

  test("markProcessDraining flips isProcessDraining", () => {
    expect(isProcessDraining()).toBe(false)
    markProcessDraining()
    expect(isProcessDraining()).toBe(true)
  })

  test("runShutdownHandlers marks draining and runs handlers LIFO", async () => {
    const order: string[] = []
    registerShutdownHandler(async () => {
      order.push("first-registered")
    })
    registerShutdownHandler(async () => {
      order.push("second-registered")
    })

    await runShutdownHandlersForTests()

    expect(isProcessDraining()).toBe(true)
    // LIFO: last registered runs first.
    expect(order).toEqual(["second-registered", "first-registered"])
  })
})
