import { render, screen } from "@solidjs/testing-library";
import { describe, expect, test } from "vitest";

function Hello(props: { name: string }) {
  return <div>hello {props.name}</div>;
}

describe("solid-testing-library sanity", () => {
  test("renders a Solid component into jsdom", () => {
    render(() => <Hello name="world" />);
    expect(screen.getByText(/hello world/)).toBeInTheDocument();
  });
});
