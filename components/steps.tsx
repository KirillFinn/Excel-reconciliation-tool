import { cn } from "@/lib/utils"

interface StepsProps {
  currentStep: number
  className?: string
}

export function Steps({ currentStep, className }: StepsProps) {
  const steps = [{ title: "Select Files & Sheets" }, { title: "Map Columns" }, { title: "Run Comparison" }]

  return (
    <div className={cn("w-full", className)}>
      <div className="flex items-center justify-between">
        {steps.map((step, index) => (
          <div key={index} className="flex flex-col items-center flex-1">
            <div
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-full border-2 text-xs font-medium",
                currentStep > index + 1
                  ? "border-primary bg-primary text-primary-foreground"
                  : currentStep === index + 1
                    ? "border-primary text-primary"
                    : "border-muted-foreground/30 text-muted-foreground",
              )}
            >
              {currentStep > index + 1 ? "✓" : index + 1}
            </div>
            <div
              className={cn(
                "mt-2 text-xs font-medium text-center",
                currentStep === index + 1 ? "text-primary" : "text-muted-foreground",
              )}
            >
              {step.title}
            </div>
            {index < steps.length - 1 && (
              <div
                className={cn(
                  "h-[2px] w-full flex-1 hidden md:block",
                  currentStep > index + 1 ? "bg-primary" : "bg-muted-foreground/30",
                )}
              />
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
