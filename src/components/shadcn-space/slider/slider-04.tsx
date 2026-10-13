"use client"

import { useState } from "react"
import NumberFlow from "@number-flow/react"
import { Slider } from "@/components/ui/slider"
import { slider04ClassName } from "@/components/shadcn-space/slider/slider-04-classes"

function SliderDemo() {
  const [value, setValue] = useState<number[]>([28.1])

  return (
    <div className="mx-auto w-full max-w-sm">
      <div className="mb-2 flex items-center justify-between">
        <p className="text-xl font-semibold tracking-tight text-foreground">
          Volume
        </p>
        <div className="text-xl font-medium text-foreground">
          <NumberFlow
            value={value[0] ?? 0}
            format={{ minimumFractionDigits: 1, maximumFractionDigits: 1 }}
          />
          <span className="ml-0.5">%</span>
        </div>
      </div>

      <Slider
        className={slider04ClassName}
        value={value}
        onValueChange={(val) => setValue(Array.isArray(val) ? val : [val])}
        min={0}
        max={100}
        step={0.1}
        aria-label="Volume"
      />
    </div>
  )
}

export default SliderDemo
