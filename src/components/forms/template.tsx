import { Button } from "@/components/ui/button"

import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { Card, CardContent } from "../ui/card"

interface Props {
  title: string
  logo: any
  form?: any
}

export default function Template({ title, logo, form }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Card className="neon-shadow group relative my-4 flex h-[150px] w-[150px] justify-center p-5">
          <CardContent className="transform transition-transform duration-300 group-hover:scale-110">
            {logo}
          </CardContent>
        </Card>
      </SheetTrigger>
      <SheetContent className="w-[400px]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Make changes. Click save when you&apos;re done.</SheetDescription>
        </SheetHeader>
        <div className="py-4">{form}</div>
        {/* <SheetFooter>
          <SheetClose asChild>
            <Button type="submit">Save changes</Button>
          </SheetClose>
        </SheetFooter> */}
      </SheetContent>
    </Sheet>
  )
}
