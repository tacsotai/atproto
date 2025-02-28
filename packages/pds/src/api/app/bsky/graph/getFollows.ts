import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { authPassthru } from '../../../proxy'
import { pipethrough } from '../../../../pipethrough'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.graph.getFollows({
    auth: ctx.authVerifier.accessOrRole,
    handler: async ({ req, params, auth }) => {
      const requester =
        auth.credentials.type === 'access' ? auth.credentials.did : null
      return pipethrough(
        ctx.cfg.bskyAppView.url,
        'app.bsky.graph.getFollows',
        params,
        requester ? await ctx.appviewAuthHeaders(requester) : authPassthru(req),
      )
    },
  })
}
