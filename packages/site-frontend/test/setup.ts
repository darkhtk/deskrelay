// Vitest setup — extends expect with jest-dom matchers (toBeInTheDocument,
// toHaveClass, etc.) and runs cleanup() after every test so DOM doesn't leak
// between cases.

import "@testing-library/jest-dom/vitest";
import { cleanup } from "@solidjs/testing-library";
import { afterEach } from "vitest";

afterEach(() => {
  cleanup();
});
