import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { App } from "../src/App.tsx";

beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      href: "http://test.local/",
      pathname: "/",
      origin: "http://test.local",
      replace: vi.fn(),
      assign: vi.fn(),
    },
  });
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("App landing flow", () => {
  test("a visitor starts on the self-host landing screen", async () => {
    render(() => <App />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Open app" }).length).toBeGreaterThan(0);
    });
    expect(screen.getByRole("heading", { name: "Release notes" })).toBeTruthy();
    expect(document.body.textContent).toContain("CLI permissions can be edited");
  });

  test("a stored token still lets the user review the landing screen first", async () => {
    window.localStorage.setItem("cr.site-token", "tok-abc");
    render(() => <App />);
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: "Open app" }).length).toBeGreaterThan(0);
    });
  });

  test("chat top-bar back button reopens the main landing screen", async () => {
    window.localStorage.setItem("cr.locale", "en");
    render(() => <App />);

    const openButton = screen.getAllByRole("button", { name: "Open app" })[0];
    if (!openButton) throw new Error("open button missing");
    fireEvent.click(openButton);
    fireEvent.input(await screen.findByPlaceholderText("CR_SITE_TOKEN"), {
      target: { value: "tok-abc" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Connect" }));

    const back = await screen.findByRole("button", { name: "Back to main screen" });
    fireEvent.click(back);

    await waitFor(() => {
      const heading = document.querySelector(".landing-headline")?.textContent ?? "";
      expect(heading).toContain("DeskRelay");
      expect(heading).toContain("for your own PCs");
    });
    expect(screen.queryByRole("button", { name: "Back to main screen" })).toBeNull();
  });

  test("local server users can open the app without typing the Site token", async () => {
    window.localStorage.setItem("cr.locale", "en");
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/__deskrelay/local-site-token")) {
        return new Response(JSON.stringify({ token: "tok-local" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response("[]", {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    render(() => <App />);
    const openButton = screen.getAllByRole("button", { name: "Open app" })[0];
    if (!openButton) throw new Error("open button missing");
    fireEvent.click(openButton);

    await waitFor(() => {
      expect(window.localStorage.getItem("cr.site-token")).toBe("tok-local");
    });
    expect(screen.queryByPlaceholderText("CR_SITE_TOKEN")).toBeNull();
  });
});
