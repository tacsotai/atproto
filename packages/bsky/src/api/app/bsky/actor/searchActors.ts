import AppContext from '../../../../context'
import { Server } from '../../../../lexicon'
import { cleanQuery } from '../../../../services/util/search'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.actor.searchActors({
    auth: ctx.authVerifier.standardOptional,
    handler: async ({ auth, params }) => {
      const { cursor, limit } = params
      const requester = auth.credentials.iss
      const rawQuery = params.q ?? params.term
      const query = cleanQuery(rawQuery || '')
      const db = ctx.db.getReplica('search')

      let results: string[]
      let resCursor: string | undefined
      if (ctx.searchAgent) {
        // @NOTE cursors wont change on appview swap
        const res =
          await ctx.searchAgent.api.app.bsky.unspecced.searchActorsSkeleton({
            q: query,
            cursor,
            limit,
          })
        results = res.data.actors.map((a) => a.did)
        resCursor = res.data.cursor
      } else {
        const res = await ctx.services
          .actor(ctx.db.getReplica('search'))
          .getSearchResults({ query, limit, cursor })
        results = res.results.map((a) => a.did)
        resCursor = res.cursor
      }

      const actors = await ctx.services
        .actor(db)
        .views.profiles(results, requester)

      const SKIP = []
      const filtered = results.flatMap((did) => {
        const actor = actors[did]
        if (!actor) return SKIP
        if (actor.viewer?.blocking || actor.viewer?.blockedBy) return SKIP
        return actor
      })

      return {
        encoding: 'application/json',
        body: {
          cursor: resCursor,
          actors: filtered,
        },
      }
    },
  })
}
