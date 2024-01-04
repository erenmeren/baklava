"use client"

import Template from "./template"
import PostgreSQL from "@/assets/images/logos/postgreSQL.svg"
import { zodResolver } from "@hookform/resolvers/zod"
import { useForm } from "react-hook-form"
import { toast } from "sonner"
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form"

import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { OperationResult, PostgreSQLConnection, PostgreSQLConnectionSchema } from "@/lib/schemas"
// import { checkConnection, saveConnection } from "@/lib/connections/postgreSQL"

export default function PostreSQLForm() {
  const form = useForm<PostgreSQLConnection>({
    resolver: zodResolver(PostgreSQLConnectionSchema),
    defaultValues: {
      host: "localhost",
      port: 5432,
      user: "admin",
      password: "admin",
      database: "test",
    },
  })

  const { trigger } = form

  async function onSubmit(data: PostgreSQLConnection) {
    const result = await fetch("/api/postgresql/connection?check", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    })

    const res: OperationResult = await result.json()

    res.isSuccessful ? toast.success(res.message) : toast.error(res.message)
  }

  const onTestConnection = async (data: PostgreSQLConnection) => {
    const isValid = await trigger()
    if (isValid) {
      const result = await fetch("/api/postgresql/connection?connectionCheck=true", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(data),
      })

      const res: OperationResult = await result.json()

      res.isSuccessful ? toast.success(res.message) : toast.error(res.message)
    }
  }

  return (
    <>
      <Template
        title={"PostgreSQL"}
        logo={<PostgreSQL width="100" height="120" alt="PostgreSQL" />}
        form={
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="w-full space-y-6">
              <FormField
                control={form.control}
                name="host"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Host</FormLabel>
                    <FormControl>
                      <Input placeholder="127.0.0.1" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="port"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Port</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        placeholder="5432"
                        {...field}
                        onChange={(e) => field.onChange(parseInt(e.target.value))}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="database"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Database</FormLabel>
                    <FormControl>
                      <Input {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="user"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>User</FormLabel>
                    <FormControl>
                      <Input placeholder="admin" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="password"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Password</FormLabel>
                    <FormControl>
                      <Input type="password" placeholder="********" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="flex justify-between">
                <Button type="button" onClick={() => onTestConnection(form.getValues())}>
                  Test
                </Button>
                <Button type="submit">Save</Button>
              </div>
            </form>
          </Form>
        }
      />
    </>
  )
}
