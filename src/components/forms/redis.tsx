import Template from "./template"
import Redis from "@/assets/images/logos/redis.svg"

export default function RedisForm() {
  return (
    <Template
      title={"Redis"}
      logo={<Redis width="110" height="110" alt="Redis" />}
    />
  )
}
