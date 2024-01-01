"use client"

import Template from "./template"
import PostgreSQL from "@/assets/images/logos/postgreSQL.svg"

import * as z from "zod"
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

const PostgreSQLFormSchema = z.object({
  host: z
    .string({
      required_error: "Host is requreid",
    })
    .min(1, "Host is requreid"),
  port: z
    .number({
      required_error: "Port is requreid",
      invalid_type_error: "Port must be a number",
    })
    .positive(),
  database: z.string().min(1, "Database is requreid"),
  user: z.string().optional(),
  password: z.string().optional(),
})

export default function PostreSQLForm() {
  const form = useForm<z.infer<typeof PostgreSQLFormSchema>>({
    resolver: zodResolver(PostgreSQLFormSchema),
    defaultValues: {
      host: "localhost",
      port: 5432,
    },
  })

  function onSubmit(data: z.infer<typeof PostgreSQLFormSchema>) {
    console.log(data)
    toast(
      <pre className="mt-2 w-[340px] rounded-md bg-slate-950 p-4">
        <code className="text-white">{JSON.stringify(data, null, 2)}</code>
      </pre>
    )
  }

  return (
    <>
      <Template
        title={"PostgreSQL"}
        logo={<PostgreSQL width="100" height="120" alt="PostgreSQL" />}
        form={
          <Form {...form}>
            <form
              onSubmit={form.handleSubmit(onSubmit)}
              className="w-full space-y-6"
            >
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
                        onChange={(e) =>
                          field.onChange(parseInt(e.target.value))
                        }
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
                      <Input
                        type="password"
                        placeholder="********"
                        {...field}
                      />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <Button type="submit">Submit</Button>
            </form>
          </Form>
        }
      />
    </>
  )
}
