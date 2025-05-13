import { Progress } from "@/components/ui/progress"

interface ProgressIndicatorProps {
  stage: string
  percent: number
}

export function ProgressIndicator({ stage, percent }: ProgressIndicatorProps) {
  // Ensure percent is a valid number between 0 and 100
  const validPercent = isNaN(percent) ? 0 : Math.max(0, Math.min(100, percent))

  return (
    <div className="w-full space-y-2">
      <div className="flex justify-between text-sm">
        <span>{stage || "Processing..."}</span>
        <span>{Math.round(validPercent)}%</span>
      </div>
      <Progress value={validPercent} className="h-2" />
    </div>
  )
}
