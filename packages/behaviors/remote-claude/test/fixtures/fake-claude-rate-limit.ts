#!/usr/bin/env bun

const lines = [
  {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      resetsAt: 1778739600,
      rateLimitType: "weekly",
    },
    session_id: "fake-rate-limit-session",
  },
  {
    type: "rate_limit_event",
    rate_limit_info: {
      status: "allowed",
      resetsAt: 1778134800,
      rateLimitType: "five_hour",
    },
    session_id: "fake-rate-limit-session",
  },
  { type: "system", subtype: "init", session_id: "fake-rate-limit-session", cwd: process.cwd() },
  {
    type: "result",
    subtype: "success",
    is_error: false,
    result: "usage checked",
    num_turns: 0,
  },
];

for (const line of lines) {
  process.stdout.write(`${JSON.stringify(line)}\n`);
}

export {};
