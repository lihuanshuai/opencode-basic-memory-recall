/**
 * Print the briefing that the plugin would inject, without starting OpenCode.
 *
 *   node scripts/preview.ts [project] [since]
 */

import { buildBriefing, resolveOptions } from "../src/briefing.ts"

const project = process.argv[2] ?? "main"
const since = process.argv[3] ?? "7d"

const options = resolveOptions({ project, since, mode: process.env.BM_MODE ?? "auto" }, process.cwd())
const result = await buildBriefing(options)

if (result.text) {
  process.stdout.write(`${result.text}\n`)
} else {
  process.stdout.write("(empty briefing)\n")
}

console.error(`\nsource=${result.source} warnings=${JSON.stringify(result.warnings)}`)
