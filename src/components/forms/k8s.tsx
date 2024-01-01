import Template from "./template"
import K8s from "@/assets/images/logos/k8s.svg"

export default function K8sForm() {
  return <Template title={"Kubernetes"} logo={<K8s width="100" height="110" alt="Kubernetes" />} />
}
