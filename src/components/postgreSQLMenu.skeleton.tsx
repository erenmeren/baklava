import { Skeleton } from "@/components/ui/skeleton"
import { ChevronDownIcon } from "lucide-react"

export default function SkeletonOfMenu() {
  return (
    <div className="p-6">
      <div className="mb-2 flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-[120px]" />
        </div>
      </div>
      <div className="mb-2 flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-[120px]" />
        </div>
      </div>
      <div className="mb-2 flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-[120px]" />
        </div>
      </div>
      <div className="mb-2 flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-[120px]" />
        </div>
      </div>
      <div className="mb-2 flex items-center gap-4">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-2">
          <Skeleton className="h-7 w-[120px]" />
        </div>
      </div>
    </div>
  )
}
