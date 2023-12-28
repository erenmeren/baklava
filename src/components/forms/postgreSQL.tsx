import Template from "./template"
import PostgreSQL from "@/assets/images/logos/postgreSQL.svg"

export default function PostreSQLForm() {
  return (
    <Template
      title={"PostgreSQL"}
      logo={<PostgreSQL width="100" height="120" alt="PostgreSQL" />}
    />
  )
}
