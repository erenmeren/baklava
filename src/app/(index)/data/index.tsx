import PostreSQLForm from "@/components/forms/postgreSQLForm"

export const applications = [
  {
    name: "Databases",
    items: [
      {
        name: "PostgreSQL",
        form: <PostreSQLForm />,
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
