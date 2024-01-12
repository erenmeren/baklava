"use client"

import DatabaseEditor from "@/components/editor/db/editor"

const DB_MANAGEMENT_SYSTEM = "postgresql"

export default function PostgreSQLHome() {
  return <DatabaseEditor databaseManagementSystem={DB_MANAGEMENT_SYSTEM} />
}
