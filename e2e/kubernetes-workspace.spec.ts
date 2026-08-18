import { test, expect, type Page } from "@playwright/test";
import { resolve } from "node:path";
import { existsSync } from "node:fs";
import { reachable } from "@/test/integration-helpers";

/**
 * Kubernetes workspace smoke test against a real cluster.
 *
 *   docker compose up -d k3s
 *   bash seed/kubernetes.sh          # creates the `demo` namespace
 *   npx playwright test e2e/kubernetes-workspace.spec.ts
 *
 * Gated on a TCP probe of the API server plus the presence of the compose
 * service's kubeconfig, and loud about skipping — a run on a machine without
 * the cluster up says it tested nothing rather than reporting a quiet green.
 *
 * The object names below (`demo` namespace, `storefront` deployment,
 * `broken-image` pod) come from seed/kubernetes.sh.
 */

const API_PORT = 6443;
const KUBECONFIG = resolve(process.cwd(), ".kube/kubeconfig.yaml");

async function clusterUp(): Promise<boolean> {
  return (await reachable("127.0.0.1", API_PORT)) && existsSync(KUBECONFIG);
}

/** Create a Kubernetes connection through the home-screen sheet and open it. */
async function openWorkspace(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: /open kubernetes connections/i }).click();
  const dialog = page.getByRole("dialog").first();
  await expect(dialog).toBeVisible({ timeout: 5_000 });

  await dialog.getByRole("button", { name: /new connection/i }).click();
  await dialog.locator("#k8s-path").fill(KUBECONFIG);
  await dialog.getByRole("button", { name: /test & save/i }).click();

  await expect(dialog.getByRole("button", { name: /new connection/i })).toBeVisible({
    timeout: 20_000,
  });
  await dialog.getByRole("button", { name: /^open$/i }).first().click();
  await expect(page).toHaveURL(/\/kubernetes\/[^/]+\/pods/, { timeout: 15_000 });
}

/**
 * The workspace's one error surface is `LoadError` (role="alert", "could not
 * list <resource>"). Deliberately not a text sweep for words like "failed":
 * a healthy Events screen is full of `FailedScheduling` and "Failed to pull
 * image", and matching those would fail the test on working software.
 */
async function expectNoErrorBanner(page: Page) {
  // LoadError's own two markers, not a bare getByRole("alert"): the Next dev
  // overlay and the toast region also emit alerts, so an unscoped sweep fails
  // on working software under parallel load.
  await expect(page.getByText(/could not list/i)).toHaveCount(0);
  await expect(page.getByText("unreachable", { exact: true })).toHaveCount(0);
}

test.describe("kubernetes workspace", () => {
  test.beforeEach(async () => {
    if (!(await clusterUp())) {
      console.warn(
        `[skip] k3s not reachable on 127.0.0.1:${API_PORT} or no kubeconfig at ${KUBECONFIG} — ` +
          "run `docker compose up -d k3s && bash seed/kubernetes.sh`",
      );
      test.skip();
    }
  });

  test("browses every resource screen without an error state", async ({ page }) => {
    // Fourteen live round-trips plus the connection setup — well past the
    // 30s default, and the workspace auto-refreshes, so "load" never settles.
    test.setTimeout(180_000);
    await openWorkspace(page);

    // Every screen in the sidebar catalogue (src/lib/kubernetes/commands.ts).
    const screens = [
      "pods",
      "deployments",
      "statefulsets",
      "daemonsets",
      "jobs",
      "cronjobs",
      "services",
      "ingresses",
      "configmaps",
      "secrets",
      "pvcs",
      "namespaces",
      "nodes",
      "events",
    ];
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");

    for (const screen of screens) {
      await page.goto(`${base}/${screen}?ns=*`, { waitUntil: "domcontentloaded" });
      // The footer counter is the table's "I rendered" signal.
      await expect(page.getByText(/selected/i).first()).toBeVisible({ timeout: 15_000 });
      await expectNoErrorBanner(page);
    }
  });

  test("shows the seeded workloads and scopes by namespace", async ({ page }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");

    await page.goto(`${base}/deployments?ns=demo`);
    await expect(page.getByText("storefront").first()).toBeVisible({ timeout: 15_000 });

    // A namespace with no storefront must not show it — proof the server
    // scoped the query rather than the browser filtering after the fact.
    await page.goto(`${base}/deployments?ns=kube-system`);
    await expect(page.getByText(/selected/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("storefront", { exact: true })).toHaveCount(0);
  });

  test("describe reads the cluster: the failing pod's reason and its events", async ({
    page,
  }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");
    await page.goto(`${base}/pods?ns=demo&select=broken-image`);
    await expect(page.getByText("broken-image").first()).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("Enter");
    const overlay = page.getByText(/Name:\s+broken-image/);
    await expect(overlay).toBeVisible({ timeout: 15_000 });
    // The part a row could never carry.
    await expect(page.getByText(/Events:/)).toBeVisible();
    await expect(page.getByText(/Failed|ErrImagePull|ImagePullBackOff/).first()).toBeVisible();
  });

  test("the yaml view shows the real manifest", async ({ page }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");
    await page.goto(`${base}/configmaps?ns=demo&select=storefront-config`);
    await expect(page.getByText("storefront-config").first()).toBeVisible({ timeout: 15_000 });

    await page.keyboard.press("y");
    await expect(page.getByText(/FEATURE_FLAGS/)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/kind: ConfigMap/)).toBeVisible();
  });

  test("nodes screen reports real usage from metrics-server", async ({ page }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");
    await page.goto(`${base}/nodes`);
    await expect(page.getByText(/selected/i).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/^Ready/).first()).toBeVisible();
    // %cpu renders a number, not the "—" placeholder, when metrics-server is up.
    await expect(page.getByText(/^\d+%$/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("reaches a pod's HTTP port through the apiserver proxy", async ({ page }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");
    await page.goto(`${base}/pods?ns=demo`);

    // A *Running* storefront pod: the seed's nginx listens on 80, but a pod
    // still terminating from a rollout makes the apiserver proxy answer 502,
    // which is real behaviour and not what this test is about.
    const row = page.getByRole("row", { name: /storefront-.*Running/ }).first();
    await expect(row).toBeVisible({ timeout: 20_000 });
    await row.click();
    await page.keyboard.press("F");

    const send = page.getByRole("button", { name: "GET" });
    await expect(send).toBeVisible({ timeout: 10_000 });
    // Retry the request itself: a pod can go Ready a moment before its
    // container is actually serving.
    await expect(async () => {
      await send.click();
      await expect(page.getByText(/Welcome to nginx/)).toBeVisible({ timeout: 5_000 });
    }).toPass({ timeout: 45_000 });
    await expect(page.getByText("200", { exact: true })).toBeVisible();
  });

  test("a truncated list is never presented as complete", async ({ page }) => {
    await openWorkspace(page);
    const base = new URL(page.url()).pathname.replace(/\/pods$/, "");
    await page.goto(`${base}/pods?ns=*`);
    await expect(page.getByText(/selected/i).first()).toBeVisible({ timeout: 15_000 });
    // The demo cluster is far below LIST_LIMIT, so the banner must be absent —
    // this pins the banner to real truncation rather than showing always.
    await expect(page.getByText(/showing the first/i)).toHaveCount(0);
  });
});
