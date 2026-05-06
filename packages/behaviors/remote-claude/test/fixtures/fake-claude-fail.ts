#!/usr/bin/env bun
// Fake claude — exits 1 with a stderr message. Used to test error handling.
process.stderr.write("fake claude error: api key missing\n");
process.exit(1);
