import { fireEvent, render } from "@solidjs/testing-library";
import { afterEach, describe, expect, test, vi } from "vitest";
import { type SessionEntry, SessionList } from "../src/components/SessionList.tsx";
import { t } from "../src/i18n.ts";

const sample = (overrides: Partial<SessionEntry> = {}): SessionEntry => ({
  sessionId: "sess_1",
  title: "first task",
  cwd: "/home/user/proj",
  updatedAt: Date.now() - 60_000,
  ...overrides,
});

afterEach(() => {
  vi.useRealTimers();
});

describe("SessionList — rendering", () => {
  test("empty list shows the placeholder", () => {
    const { container } = render(() => <SessionList entries={[]} />);
    expect(container.textContent).toContain(t("sl.empty"));
  });

  test("renders one row per entry with title + cwd basename + ago", () => {
    const { container } = render(() => (
      <SessionList
        entries={[
          sample({ sessionId: "a", title: "fix the bug" }),
          sample({ sessionId: "b", title: "add the feature" }),
        ]}
      />
    ));
    expect(container.querySelectorAll(".session-item-row").length).toBe(2);
    expect(container.textContent).toContain("fix the bug");
    expect(container.textContent).toContain("add the feature");
    expect(container.textContent).toContain("proj");
  });

  test("row hover title uses the untruncated fullTitle when present", () => {
    const long = "full title that is longer than the visible truncated title";
    const { container } = render(() => (
      <SessionList entries={[sample({ title: "full title that is...", fullTitle: long })]} />
    ));
    const row = container.querySelector(".session-item") as HTMLButtonElement;
    expect(row.title).toBe(long);
  });

  test("via badge appears when set", () => {
    const { container } = render(() => <SessionList entries={[sample({ via: "web" })]} />);
    expect(container.querySelector(".session-item-via-web")).toBeTruthy();
  });

  test("selectedId highlights the matching row", () => {
    const { container } = render(() => (
      <SessionList
        entries={[sample({ sessionId: "x" }), sample({ sessionId: "y" })]}
        selectedId="y"
      />
    ));
    const selected = container.querySelectorAll(".session-item-selected");
    expect(selected.length).toBe(1);
    expect((selected[0] as HTMLElement).textContent).toBeTruthy();
  });
});

describe("SessionList — selection", () => {
  test("clicking a row fires onSelect with id + entry", () => {
    const onSelect = vi.fn();
    const entry = sample({ sessionId: "abc" });
    const { container } = render(() => <SessionList entries={[entry]} onSelect={onSelect} />);
    const btn = container.querySelector(".session-item") as HTMLButtonElement;
    fireEvent.click(btn);
    expect(onSelect).toHaveBeenCalledWith("abc", entry);
  });
});

describe("SessionList — delete arm-then-confirm", () => {
  test("first × click arms (does not delete)", () => {
    const onDelete = vi.fn();
    const { container } = render(() => (
      <SessionList entries={[sample({ sessionId: "x" })]} onDelete={onDelete} />
    ));
    const x = container.querySelector(".session-item-delete") as HTMLButtonElement;
    fireEvent.click(x);
    expect(onDelete).not.toHaveBeenCalled();
    expect(container.querySelector(".session-item-delete-armed")).toBeTruthy();
    expect((container.querySelector(".session-item-delete-armed") as HTMLElement).textContent).toBe(
      t("sl.delete.label"),
    );
  });

  test("second × click within window confirms", () => {
    const onDelete = vi.fn();
    const { container } = render(() => (
      <SessionList entries={[sample({ sessionId: "x" })]} onDelete={onDelete} />
    ));
    const x = container.querySelector(".session-item-delete") as HTMLButtonElement;
    fireEvent.click(x);
    fireEvent.click(container.querySelector(".session-item-delete") as HTMLButtonElement);
    expect(onDelete).toHaveBeenCalledWith("x");
  });

  test("deleting row is disabled and cannot be confirmed again", () => {
    const onDelete = vi.fn();
    const { container } = render(() => (
      <SessionList
        entries={[sample({ sessionId: "x" })]}
        onDelete={onDelete}
        deletingIds={{ x: true }}
      />
    ));
    const row = container.querySelector(".session-item") as HTMLButtonElement;
    const deleteButton = container.querySelector(".session-item-delete") as HTMLButtonElement;
    expect(row.disabled).toBe(true);
    expect(deleteButton.disabled).toBe(true);
    expect(deleteButton.textContent).toBe(t("sl.delete.progress"));
    fireEvent.click(deleteButton);
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("arm auto-clears after timeout", () => {
    vi.useFakeTimers();
    const onDelete = vi.fn();
    const { container } = render(() => (
      <SessionList entries={[sample({ sessionId: "x" })]} onDelete={onDelete} />
    ));
    fireEvent.click(container.querySelector(".session-item-delete") as HTMLButtonElement);
    expect(container.querySelector(".session-item-delete-armed")).toBeTruthy();
    vi.advanceTimersByTime(3500);
    expect(container.querySelector(".session-item-delete-armed")).toBeFalsy();
    expect(onDelete).not.toHaveBeenCalled();
  });

  test("clicking another row's title clears the arm on the first", () => {
    const onDelete = vi.fn();
    const { container } = render(() => (
      <SessionList
        entries={[sample({ sessionId: "a" }), sample({ sessionId: "b" })]}
        onDelete={onDelete}
      />
    ));
    const xs = Array.from(
      container.querySelectorAll(".session-item-delete"),
    ) as HTMLButtonElement[];
    fireEvent.click(xs[0] as HTMLButtonElement);
    expect(container.querySelector(".session-item-delete-armed")).toBeTruthy();
    const titleBtns = Array.from(
      container.querySelectorAll(".session-item"),
    ) as HTMLButtonElement[];
    fireEvent.click(titleBtns[1] as HTMLButtonElement);
    expect(container.querySelector(".session-item-delete-armed")).toBeFalsy();
  });
});

describe("SessionList — groupByCwd", () => {
  test("flat (default) renders no group headers", () => {
    const { container } = render(() => (
      <SessionList
        entries={[
          sample({ sessionId: "a", cwd: "/x/alpha" }),
          sample({ sessionId: "b", cwd: "/x/beta" }),
        ]}
      />
    ));
    expect(container.querySelectorAll(".session-list-group-header").length).toBe(0);
  });

  test("groupByCwd renders one header per workspace", () => {
    const { container } = render(() => (
      <SessionList
        entries={[
          sample({ sessionId: "a", cwd: "/x/alpha" }),
          sample({ sessionId: "b", cwd: "/x/alpha" }),
          sample({ sessionId: "c", cwd: "/x/beta" }),
        ]}
        groupByCwd={true}
      />
    ));
    const headers = Array.from(container.querySelectorAll(".session-list-group-header")).map(
      (h) => h.textContent ?? "",
    );
    expect(headers).toEqual(["alpha", "beta"]);
    // All three rows still rendered.
    expect(container.querySelectorAll(".session-item-row").length).toBe(3);
  });

  test("group delete arms then confirms with cwd and group rows", () => {
    const onDeleteGroup = vi.fn();
    const entries = [
      sample({ sessionId: "a", cwd: "/x/alpha" }),
      sample({ sessionId: "b", cwd: "/x/alpha" }),
    ];
    const { container } = render(() => (
      <SessionList entries={entries} groupByCwd={true} onDeleteGroup={onDeleteGroup} />
    ));

    const button = container.querySelector(".session-group-delete") as HTMLButtonElement;
    fireEvent.click(button);
    expect(onDeleteGroup).not.toHaveBeenCalled();
    expect(button.textContent).toBe(t("sl.delete-group.label"));

    fireEvent.click(button);
    expect(onDeleteGroup).toHaveBeenCalledWith("/x/alpha", entries);
  });

  test("group delete progress renders inline and disables repeated delete", () => {
    const onDeleteGroup = vi.fn();
    const entries = [
      sample({ sessionId: "a", cwd: "/x/alpha" }),
      sample({ sessionId: "b", cwd: "/x/alpha" }),
    ];
    const { container } = render(() => (
      <SessionList
        entries={entries}
        groupByCwd={true}
        onDeleteGroup={onDeleteGroup}
        deletingGroups={{ "/x/alpha": { completed: 1, total: 2 } }}
      />
    ));

    expect(container.querySelector(".session-group-progress")).toBeTruthy();
    expect(container.textContent).toContain(
      t("sl.delete-group.progress-count", { done: 1, total: 2 }),
    );
    const button = container.querySelector(".session-group-delete") as HTMLButtonElement;
    expect(button.disabled).toBe(true);
    fireEvent.click(button);
    expect(onDeleteGroup).not.toHaveBeenCalled();
  });
});
