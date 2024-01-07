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
  formTrigger: any
  form?: any
}

export default function Template({ title, formTrigger, form }: Props) {
  return (
    <Sheet>
      <SheetTrigger asChild>{formTrigger}</SheetTrigger>
      <SheetContent className="w-[400px]">
        <SheetHeader>
          <SheetTitle>{title}</SheetTitle>
          <SheetDescription>Make changes. Click save when you&apos;re done.</SheetDescription>
        </SheetHeader>
        <div className="py-4">{form}</div>
      </SheetContent>
    </Sheet>
  )
}
