import Template from "./template"
import MongoDB from "@/assets/images/logos/mongoDB.svg"

export default function MongoDBForm() {
  return (
    <Template
      title={"MongoDB"}
      logo={<MongoDB width="100" height="110" alt="MongoDB" />}
    />
  )
}
