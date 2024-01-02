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
        <Card className="group relative flex h-[150px] w-[150px] justify-center p-5">
          <div className="absolute inset-0 rounded-lg bg-white bg-opacity-50 opacity-0 shadow-lg transition-opacity duration-300 group-hover:opacity-100 group-hover:shadow-2xl group-hover:shadow-purple-500"></div>
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
