/**
 * Pure manifest transforms behind the deployment actions (scale, rollout
 * restart). They are kept out of the driver so the interesting part — what we
 * write back to the cluster — is testable without one.
 */

/** The annotation `kubectl rollout restart` stamps to force a new ReplicaSet. */
export const RESTART_ANNOTATION = "kubectl.kubernetes.io/restartedAt";

interface TemplateMetadataLike {
  annotations?: Record<string, string>;
  [key: string]: unknown;
}

interface TemplateLike {
  metadata?: TemplateMetadataLike;
  [key: string]: unknown;
}

interface DeploymentSpecLike {
  replicas?: number;
  template?: TemplateLike;
  [key: string]: unknown;
}

/**
 * Structurally the part of a Deployment these transforms touch. `metadata` is
 * declared (unused here) so a full `KubernetesObject` from the driver is
 * assignable — a type whose properties are all optional otherwise rejects
 * every value that shares none of them.
 */
export interface DeploymentLike {
  metadata?: unknown;
  spec?: DeploymentSpecLike;
}

/** Validate a replica count coming off an HTTP body. */
export function parseReplicas(value: unknown): number {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
    throw new Error("replicas must be a non-negative integer");
  }
  return n;
}

/** Copy of `deployment` with `spec.replicas` set. */
export function withReplicas(
  deployment: DeploymentLike,
  replicas: number,
): DeploymentLike {
  return {
    ...deployment,
    spec: { ...(deployment.spec ?? {}), replicas },
  };
}

/**
 * Copy of `deployment` with the restart annotation stamped on the **pod
 * template** — annotating the Deployment itself changes nothing, it is the
 * template hash that makes the rollout happen.
 */
export function withRestartedAt(
  deployment: DeploymentLike,
  timestamp: string,
): DeploymentLike {
  const spec = deployment.spec ?? {};
  const template = spec.template ?? {};
  const metadata = template.metadata ?? {};
  return {
    ...deployment,
    spec: {
      ...spec,
      template: {
        ...template,
        metadata: {
          ...metadata,
          annotations: {
            ...(metadata.annotations ?? {}),
            [RESTART_ANNOTATION]: timestamp,
          },
        },
      },
    },
  };
}
