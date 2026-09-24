import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

const source = await readFile(new URL("../app/routes/affiliate-login.tsx", import.meta.url), "utf8");
const effect = source.match(/useEffect\(\(\) => \{([\s\S]*?)\}, \[\]\);/)[1];
let token = "";
let writes = 0;
const location = { hash: "#token=private-test-token", pathname: "/affiliate-login", search: "" };
const history = { state: { router: "preserved" }, replaceState(state) { assert.equal(state.router, "preserved"); writes++; location.hash = ""; } };
const context = vm.createContext({ URLSearchParams, tokenRead: { current: false }, window: { location, history }, setToken(value) { token = value; } });
vm.runInContext(`function initialize() { ${effect} } initialize(); initialize();`, context);
assert.equal(token, "private-test-token");
assert.equal(writes, 1);
assert.equal(location.hash, "");
console.info("Passed: replayed initialization preserves token, removes private fragment once, and preserves router history state.");
