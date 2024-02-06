import PostgreSQL from "@/assets/images/logos/postgreSQL.svg"
import Docker from "@/assets/images/logos/docker.svg"
import Kafka from "@/assets/images/logos/kafka.svg"
import { Applications } from "@/lib/types"

export const applications: Applications = [
  {
    name: "Databases",
    items: [
      {
        name: "PostgreSQL",
        link: "/postgresql",
        icon: <PostgreSQL width="100" height="120" alt="PostgreSQL" />,
      },
    ],
  },
  {
    name: "Container",
    items: [
      {
        name: "Docker",
        link: "/docker",
        icon: <Docker width="100" height="120" alt="Docker" />,
      },
    ],
  },
  {
    name: "Queue",
    items: [
      {
        name: "Kafka",
        link: "/kafka",
        icon: <Kafka width="100" height="110" alt="Kafka" />,
      },
    ],
  },
]

// export const applications = [
//   {
//     name: "Databases",
//     items: [
//       {
//         name: "PostgreSQL",
//         form: <PostreSQLForm />,
//       },
//       {
//         name: "MongoDB",
//         form: <MongoDBForm />,
//       },
//       {
//         name: "Redis",
//         form: <RedisForm />,
//       },
//     ],
//   },
//   {
//     name: "Streaming",
//     items: [
//       {
//         name: "Kafka",
//         form: <KafkaForm />,
//       },
//     ],
//   },
//   {
//     name: "Container",
//     items: [
//       {
//         name: "Kubernetes",
//         form: <K8sForm />,
//       },
//       {
//         name: "Docker",
//         form: <DockerForm />,
//       },
//     ],
//   },
// ]
