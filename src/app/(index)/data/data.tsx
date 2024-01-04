import PostreSQLForm from "@/components/forms/postgreSQLForm"
import MongoDBForm from "@/components/forms/mongoDB"
import RedisForm from "@/components/forms/redis"
import KafkaForm from "@/components/forms/kafka"
import K8sForm from "@/components/forms/k8s"
import DockerForm from "@/components/forms/docker"

export const applications = [
  {
    name: "Databases",
    items: [
      {
        name: "PostgreSQL",
        form: <PostreSQLForm />,
      },

      // {
      //   name: "MongoDB",
      //   form: <MongoDBForm />,
      // },
      // {
      //   name: "Redis",
      //   form: <RedisForm />,
      // },
    ],
  },
  // {
  //   name: "Streaming",
  //   items: [
  //     {
  //       name: "Kafka",
  //       form: <KafkaForm />,
  //     },
  //   ],
  // },
  // {
  //   name: "Container",
  //   items: [
  //     {
  //       name: "Kubernetes",
  //       form: <K8sForm />,
  //     },
  //     {
  //       name: "Docker",
  //       form: <DockerForm />,
  //     },
  //   ],
  // },
]
