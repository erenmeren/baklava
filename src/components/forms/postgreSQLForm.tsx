"use client"

import Template from "./template"

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
import { PostgreSQLConnection, PostgreSQLConnectionSchema } from "@/lib/types"
import { trpc } from "@/utils/trpc"

export default function PostreSQLForm({ formTrigger }: any) {
  const { mutate: saveConnection } = trpc.postgresql.saveConnection.useMutation({
    onSuccess: () => {
      toast.success("Connection saved!")
    },
    onError: (error) => {
      toast.error(`Error: ${error.message || "Failed to save connection."}`)
    },
  })

  const { mutate: checkConnection } = trpc.postgresql.checkConnection.useMutation({
    onSuccess: () => {
      toast.success("Connected successfully!")
    },
    onError: (error) => {
      toast.error(`Error: ${error.message || "Failed to check connection."}`)
    },
  })

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
    saveConnection(data)
  }

  const onTestConnection = async (data: PostgreSQLConnection) => {
    const isValid = await trigger()
    if (isValid) {
      await checkConnection(data)
    }
  }

  return (
    <>
      <Template
        title={"PostgreSQL"}
        formTrigger={formTrigger}
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
