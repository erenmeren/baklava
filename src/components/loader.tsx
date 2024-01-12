import { cn } from "@/lib/utils"
import { Icons } from "./icons"

const Loader = ({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) => {
  return (
    <div className={cn("flex text-sm", className)} {...props}>
      <Icons.loader className="mr-1 h-5 w-5 animate-spin" /> Loading
    </div>
  )
}

export default Loader
