#!/usr/bin/env bun
// Fake claude — never exits. Used to test AbortSignal handling.
export {};
await new Promise(() => {});
