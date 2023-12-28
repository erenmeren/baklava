import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import PostgreSQL from "@/assets/images/logos/postgreSql2.svg"
import MongoDB from "@/assets/images/logos/mongo.svg"
import Redis from "@/assets/images/logos/redis.svg"

export default function Home() {
  return (
    <main>
      Databases
      <div className="flex-1 space-y-4 p-8 pt-6">
        <div className="flex items-center justify-between space-y-2">
          <h1 className="text-6xl font-bold tracking-tight">Databases</h1>
        </div>

        <div className="flex gap-10">
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <MongoDB width="120" height="300" alt="MongoDB" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <Redis width="300" height="300" alt="Redis" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="h-[300px] w-[300px] p-5">
              <PostgreSQL width="250" height="250" alt="PostgreSQL" />
            </CardContent>
          </Card>
        </div>
        <div className="flex items-center justify-between space-y-2">
          <h1 className="text-6xl font-bold tracking-tight">Streaming</h1>
        </div>
        <div className="flex gap-10">
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <Redis width="300" height="300" alt="Redis" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <PostgreSQL width="250" height="250" alt="PostgreSQL" />
            </CardContent>
          </Card>
        </div>
        <div className="flex items-center justify-between space-y-2">
          <h1 className="text-6xl font-bold tracking-tight">Container</h1>
        </div>
        <div className="flex gap-10">
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <PostgreSQL width="250" height="250" alt="PostgreSQL" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="flex h-[300px] w-[300px] justify-center p-5">
              <MongoDB width="120" height="300" alt="MongoDB" />
            </CardContent>
          </Card>
        </div>
      </div>
    </main>
  )
}
