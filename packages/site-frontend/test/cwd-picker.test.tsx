import { fireEvent, render, waitFor } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { CwdPicker } from "../src/components/CwdPicker.tsx";

const ROOT = "C:\\Users\\darkh\\Projects";

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("CwdPicker restricted workspace roots", () => {
  test("waits for roots and lists the exact configured root instead of its forbidden parent", async () => {
    let resolveRoots!: (value: Response) => void;
    const rootsResponse = new Promise<Response>((resolve) => {
      resolveRoots = resolve;
    });
    const listedPaths: string[] = [];

    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://deskrelay.local");
      if (url.pathname.endsWith("/fs/roots")) return rootsResponse;
      if (url.pathname.endsWith("/fs/list")) {
        listedPaths.push(url.searchParams.get("path") ?? "");
        return json({
          path: ROOT,
          parent: "C:\\Users\\darkh",
          entries: [{ name: "deskrelay", fullPath: `${ROOT}\\deskrelay`, isDir: true }],
        });
      }
      return json({});
    });

    const { container } = render(() => (
      <CwdPicker deviceId="dev_1" value={ROOT} onChange={vi.fn()} />
    ));
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.focus(input);
    await Promise.resolve();
    expect(listedPaths).toEqual([]);

    resolveRoots(json({ mode: "restricted", roots: [ROOT] }));

    await waitFor(() => {
      expect(listedPaths).toEqual([ROOT]);
      expect(container.textContent).toContain("deskrelay");
    });
  });

  test("suggests matching allowed roots locally when the typed parent is outside the allowlist", async () => {
    const listedPaths: string[] = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://deskrelay.local");
      if (url.pathname.endsWith("/fs/roots")) {
        return json({ mode: "restricted", roots: [ROOT] });
      }
      if (url.pathname.endsWith("/fs/list")) {
        listedPaths.push(url.searchParams.get("path") ?? "");
        return json({ path: "", parent: null, entries: [] });
      }
      return json({});
    });

    const { container } = render(() => (
      <CwdPicker deviceId="dev_1" value="C:\\Users\\darkh\\Pro" onChange={vi.fn()} />
    ));
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.focus(input);

    await waitFor(() => {
      expect(container.textContent).toContain(ROOT);
    });
    expect(listedPaths).toEqual([]);
  });

  test("unrestricted browse mode skips client root filtering and asks the daemon for full paths", async () => {
    const rootRequests: string[] = [];
    const listRequests: Array<{ path: string; workspaceScope: string | null }> = [];
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = new URL(String(input), "http://deskrelay.local");
      if (url.pathname.endsWith("/fs/roots")) {
        rootRequests.push(url.pathname);
        return json({ mode: "restricted", roots: [ROOT] });
      }
      if (url.pathname.endsWith("/fs/list")) {
        listRequests.push({
          path: url.searchParams.get("path") ?? "",
          workspaceScope: url.searchParams.get("workspaceScope"),
        });
        return json({
          path: "C:\\Users",
          parent: "C:\\",
          entries: [{ name: "desktop", fullPath: "C:\\Users\\desktop", isDir: true }],
        });
      }
      return json({});
    });

    const { container } = render(() => (
      <CwdPicker
        deviceId="dev_1"
        value={"C:\\Users\\"}
        onChange={vi.fn()}
        browseMode="unrestricted"
      />
    ));
    const input = container.querySelector("input") as HTMLInputElement;

    fireEvent.focus(input);

    await waitFor(() => {
      expect(container.textContent).toContain("desktop");
    });
    expect(rootRequests).toEqual([]);
    expect(listRequests).toEqual([{ path: "C:\\Users\\", workspaceScope: "unrestricted" }]);
  });
});
