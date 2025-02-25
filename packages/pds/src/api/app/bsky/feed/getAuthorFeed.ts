import { Server } from '../../../../lexicon'
import AppContext from '../../../../context'
import { authPassthru } from '../../../proxy'
import { OutputSchema } from '../../../../lexicon/types/app/bsky/feed/getAuthorFeed'
import { isReasonRepost } from '../../../../lexicon/types/app/bsky/feed/defs'
import {
  LocalViewer,
  handleReadAfterWrite,
  LocalRecords,
} from '../../../../read-after-write'
import { pipethrough } from '../../../../pipethrough'

const METHOD_NSID = 'app.bsky.feed.getAuthorFeed'

export default function (server: Server, ctx: AppContext) {
  server.app.bsky.feed.getAuthorFeed({
    auth: ctx.authVerifier.accessOrRole,
    handler: async ({ req, params, auth }) => {
      const requester =
        auth.credentials.type === 'access' ? auth.credentials.did : null
      const res = await pipethrough(
        ctx.cfg.bskyAppView.url,
        METHOD_NSID,
        params,
        requester ? await ctx.appviewAuthHeaders(requester) : authPassthru(req),
      )
      if (!requester) {
        return res
      }
      return await handleReadAfterWrite(
        ctx,
        METHOD_NSID,
        requester,
        res,
        getAuthorMunge,
      )
    },
  })
}

const getAuthorMunge = async (
  localViewer: LocalViewer,
  original: OutputSchema,
  local: LocalRecords,
  requester: string,
): Promise<OutputSchema> => {
  const localProf = local.profile
  // only munge on own feed
  if (!isUsersFeed(original, requester)) {
    return original
  }
  let feed = original.feed
  // first update any out of date profile pictures in feed
  if (localProf) {
    feed = feed.map((item) => {
      if (item.post.author.did === requester) {
        return {
          ...item,
          post: {
            ...item.post,
            author: localViewer.updateProfileViewBasic(
              item.post.author,
              localProf.record,
            ),
          },
        }
      } else {
        return item
      }
    })
  }
  feed = await localViewer.formatAndInsertPostsInFeed(feed, local.posts)
  return {
    ...original,
    feed,
  }
}

const isUsersFeed = (feed: OutputSchema, requester: string) => {
  const first = feed.feed.at(0)
  if (!first) return false
  if (!first.reason && first.post.author.did === requester) return true
  if (isReasonRepost(first.reason) && first.reason.by.did === requester)
    return true
  return false
}
