import { applications } from "@/app/(index)/_data"
import { Card, CardContent } from "@/components/ui/card"
import { Separator } from "@/components/ui/separator"
import Link from "next/link"

export default function Home() {
  return (
    <main className="flex-1 space-y-4 p-8 pt-6">
      {applications.map((app) => (
        <div key={app.name} className="mb-10">
          <h1 className="mb-3 text-4xl font-bold tracking-tight">{app.name}</h1>

          <div className="flex gap-10">
            {app.items.map((item) => (
              <Link key={item.name} href={item.link}>
                <Card className="neon-shadow group relative my-4 flex h-[150px] w-[150px] justify-center p-5">
                  <CardContent className="transform transition-transform duration-300 group-hover:scale-110">
                    {item.icon}
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      ))}
    </main>
  )
}
