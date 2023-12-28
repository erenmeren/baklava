import { applications } from "@/app/(index)/data/data"
import { Separator } from "@/components/ui/separator"

export default function Home() {
  return (
    <main className="flex-1 space-y-4 p-8 pt-6">
      {applications.map((app) => (
        <div key={app.name}>
          <h1 className="mb-5 text-4xl font-bold tracking-tight">{app.name}</h1>

          <div className="flex gap-10">
            {app.items.map((item) => (
              <div key={item.name}>{item.form}</div>
            ))}
          </div>
          <Separator className="my-8" />
        </div>
      ))}
    </main>
  )
}
