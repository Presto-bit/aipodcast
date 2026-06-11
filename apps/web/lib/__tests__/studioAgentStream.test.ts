import { isStreamFetchAbortError } from "../studioAgentStream";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

assert(isStreamFetchAbortError(new DOMException("Aborted", "AbortError")), "AbortError");
assert(!isStreamFetchAbortError(new Error("Network error")), "network error is not user abort");
assert(!isStreamFetchAbortError(new Error("Failed to fetch")), "failed to fetch is not user abort");
assert(isStreamFetchAbortError(new Error("The user aborted a request")), "user aborted");
assert(!isStreamFetchAbortError(new Error("NEEDS_REWRITE")), "not abort");

console.log("studioAgentStream.test.ts: ok");
