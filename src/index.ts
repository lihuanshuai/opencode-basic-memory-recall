import { appendFileSync, mkdirSync } from "node:fs"
import { homedir } from "node:os"
import { dirname, join } from "node:path"

import { Plugin } from "@opencode/plugin"

import { buildBriefing, resolveOptions } from "./briefing.ts"

const CACHE_LIMIT = 200

type CacheEntry = { text: string; at: number }

/**
 * Inject a Basic Memory briefing into the system instructions of a session.
 *
 * One briefing is built per session and reused for `ttlMinutes`, so the first
 * model call pays for one `bm` invocation and later calls are free.
 */
export default Plugin.define({
  id: "basic-memory-recall",
  async setup(ctx) {
    const raw = (ctx.options ?? {}) as Record<string, unknown>
    const debug = raw.debug === true
    const debugFile =
      typeof raw.debugFile === "string" && raw.debugFile.length > 0
        ? raw.debugFile
        : join(homedir(), ".local/share/opencode/basic-memory-recall.log")

    const log = (message: string) => {
      if (!debug) return
      console.error(`[basic-memory-recall] ${message}`)
      try {
        mkdirSync(dirname(debugFile), { recursive: true })
        appendFileSync(debugFile, `${new Date().toISOString()} ${message}\n`)
      } catch {
        // Logging must never break a model call.
      }
    }

    if (raw.enabled === false) {
      log("disabled by options")
      return
    }

    const options = resolveOptions(raw, ctx.location.directory)
    const ttlMs = options.ttlMinutes * 60_000
    const cache = new Map<string, CacheEntry>()

    const remember = (sessionID: string, entry: CacheEntry) => {
      cache.set(sessionID, entry)
      if (cache.size <= CACHE_LIMIT) return
      const oldest = [...cache.entries()].sort((a, b) => a[1].at - b[1].at)[0]
      if (oldest) cache.delete(oldest[0])
    }

    log(
      `loaded: mode=${options.mode} project=${options.project ?? "(none)"} dir=${options.projectDir} ` +
        `ttl=${options.ttlMinutes}m maxChars=${options.maxChars}`,
    )

    const registration = await ctx.session.hook("context", async (event) => {
      try {
        const now = Date.now()
        let entry = cache.get(event.sessionID)

        if (!entry || ttlMs === 0 || now - entry.at > ttlMs) {
          const result = await buildBriefing(options)
          if (!result.text) {
            log(`no briefing for ${event.sessionID}: ${result.warnings.join("; ")}`)
            return
          }
          entry = { text: result.text, at: now }
          remember(event.sessionID, entry)
          log(
            `${event.sessionID} briefing ${result.text.length} chars from ${result.source}` +
              (result.warnings.length > 0 ? ` (${result.warnings.join("; ")})` : ""),
          )
        }

        event.system.push({ type: "text", text: entry.text })
      } catch (error) {
        // A briefing must never break a model call.
        log(`briefing failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    })

    return async () => {
      await registration.dispose()
      cache.clear()
    }
  },
})
