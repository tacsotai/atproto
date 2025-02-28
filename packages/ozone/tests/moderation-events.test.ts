import assert from 'node:assert'
import { TestNetwork, SeedClient, basicSeed } from '@atproto/dev-env'
import AtpAgent, {
  ComAtprotoAdminDefs,
  ComAtprotoAdminEmitModerationEvent,
} from '@atproto/api'
import { forSnapshot } from './_util'
import {
  REASONAPPEAL,
  REASONMISLEADING,
  REASONSPAM,
} from '../src/lexicon/types/com/atproto/moderation/defs'

describe('moderation-events', () => {
  let network: TestNetwork
  let agent: AtpAgent
  let pdsAgent: AtpAgent
  let sc: SeedClient

  const emitModerationEvent = async (
    eventData: ComAtprotoAdminEmitModerationEvent.InputSchema,
  ) => {
    return pdsAgent.api.com.atproto.admin.emitModerationEvent(eventData, {
      encoding: 'application/json',
      headers: network.bsky.adminAuthHeaders('moderator'),
    })
  }

  const queryModerationEvents = (eventQuery) =>
    agent.api.com.atproto.admin.queryModerationEvents(eventQuery, {
      headers: network.bsky.adminAuthHeaders('moderator'),
    })

  const seedEvents = async () => {
    const bobsAccount = {
      $type: 'com.atproto.admin.defs#repoRef',
      did: sc.dids.bob,
    }
    const alicesAccount = {
      $type: 'com.atproto.admin.defs#repoRef',
      did: sc.dids.alice,
    }
    const bobsPost = {
      $type: 'com.atproto.repo.strongRef',
      uri: sc.posts[sc.dids.bob][0].ref.uriStr,
      cid: sc.posts[sc.dids.bob][0].ref.cidStr,
    }
    const alicesPost = {
      $type: 'com.atproto.repo.strongRef',
      uri: sc.posts[sc.dids.alice][0].ref.uriStr,
      cid: sc.posts[sc.dids.alice][0].ref.cidStr,
    }

    for (let i = 0; i < 4; i++) {
      await emitModerationEvent({
        event: {
          $type: 'com.atproto.admin.defs#modEventReport',
          reportType: i % 2 ? REASONSPAM : REASONMISLEADING,
          comment: 'X',
        },
        //   Report bob's account by alice and vice versa
        subject: i % 2 ? bobsAccount : alicesAccount,
        createdBy: i % 2 ? sc.dids.alice : sc.dids.bob,
      })
      await emitModerationEvent({
        event: {
          $type: 'com.atproto.admin.defs#modEventReport',
          reportType: REASONSPAM,
          comment: 'X',
        },
        //   Report bob's post by alice and vice versa
        subject: i % 2 ? bobsPost : alicesPost,
        createdBy: i % 2 ? sc.dids.alice : sc.dids.bob,
      })
    }
  }

  beforeAll(async () => {
    network = await TestNetwork.create({
      dbPostgresSchema: 'ozone_moderation_events',
    })
    agent = network.ozone.getClient()
    pdsAgent = network.pds.getClient()
    sc = network.getSeedClient()
    await basicSeed(sc)
    await network.processAll()
    await seedEvents()
  })

  afterAll(async () => {
    await network.close()
  })

  describe('query events', () => {
    it('returns all events for record or repo', async () => {
      const [bobsEvents, alicesPostEvents] = await Promise.all([
        queryModerationEvents({
          subject: sc.dids.bob,
        }),
        queryModerationEvents({
          subject: sc.posts[sc.dids.alice][0].ref.uriStr,
        }),
      ])

      expect(forSnapshot(bobsEvents.data.events)).toMatchSnapshot()
      expect(forSnapshot(alicesPostEvents.data.events)).toMatchSnapshot()
    })

    it('filters events by types', async () => {
      const alicesAccount = {
        $type: 'com.atproto.admin.defs#repoRef',
        did: sc.dids.alice,
      }
      await Promise.all([
        emitModerationEvent({
          event: {
            $type: 'com.atproto.admin.defs#modEventComment',
            comment: 'X',
          },
          subject: alicesAccount,
          createdBy: 'did:plc:moderator',
        }),
        emitModerationEvent({
          event: {
            $type: 'com.atproto.admin.defs#modEventEscalate',
            comment: 'X',
          },
          subject: alicesAccount,
          createdBy: 'did:plc:moderator',
        }),
      ])
      const [allEvents, reportEvents] = await Promise.all([
        queryModerationEvents({
          subject: sc.dids.alice,
        }),
        queryModerationEvents({
          subject: sc.dids.alice,
          types: ['com.atproto.admin.defs#modEventReport'],
        }),
      ])

      expect(allEvents.data.events.length).toBeGreaterThan(
        reportEvents.data.events.length,
      )
      expect(
        [...new Set(reportEvents.data.events.map((e) => e.event.$type))].length,
      ).toEqual(1)

      expect(
        [...new Set(allEvents.data.events.map((e) => e.event.$type))].length,
      ).toEqual(3)
    })

    it('returns events for all content by user', async () => {
      const [forAccount, forPost] = await Promise.all([
        queryModerationEvents({
          subject: sc.dids.bob,
          includeAllUserRecords: true,
        }),
        queryModerationEvents({
          subject: sc.posts[sc.dids.bob][0].ref.uriStr,
          includeAllUserRecords: true,
        }),
      ])

      expect(forAccount.data.events.length).toEqual(forPost.data.events.length)
      // Save events are returned from both requests
      expect(forPost.data.events.map(({ id }) => id).sort()).toEqual(
        forAccount.data.events.map(({ id }) => id).sort(),
      )
    })

    it('returns paginated list of events with cursor', async () => {
      const allEvents = await queryModerationEvents({
        subject: sc.dids.bob,
        includeAllUserRecords: true,
      })

      const getPaginatedEvents = async (
        sortDirection: 'asc' | 'desc' = 'desc',
      ) => {
        let defaultCursor: undefined | string = undefined
        const events: ComAtprotoAdminDefs.ModEventView[] = []
        let count = 0
        do {
          // get 1 event at a time and check we get all events
          const { data } = await queryModerationEvents({
            limit: 1,
            subject: sc.dids.bob,
            includeAllUserRecords: true,
            cursor: defaultCursor,
            sortDirection,
          })
          events.push(...data.events)
          defaultCursor = data.cursor
          count++
          // The count is a circuit breaker to prevent infinite loop in case of failing test
        } while (defaultCursor && count < 10)

        return events
      }

      const defaultEvents = await getPaginatedEvents()
      const reversedEvents = await getPaginatedEvents('asc')

      expect(allEvents.data.events.length).toEqual(5)
      expect(defaultEvents.length).toEqual(allEvents.data.events.length)
      expect(reversedEvents.length).toEqual(allEvents.data.events.length)
      expect(reversedEvents[0].id).toEqual(defaultEvents[4].id)
    })

    it('returns report events matching reportType filters', async () => {
      const [spamEvents, misleadingEvents] = await Promise.all([
        queryModerationEvents({
          reportTypes: [REASONSPAM],
        }),
        queryModerationEvents({
          reportTypes: [REASONMISLEADING, REASONAPPEAL],
        }),
      ])

      expect(misleadingEvents.data.events.length).toEqual(2)
      expect(spamEvents.data.events.length).toEqual(6)
    })

    it('returns events matching keyword in comment', async () => {
      const [eventsWithX, eventsWithTest, eventsWithComment] =
        await Promise.all([
          queryModerationEvents({
            comment: 'X',
          }),
          queryModerationEvents({
            comment: 'test',
          }),
          queryModerationEvents({
            hasComment: true,
          }),
        ])

      expect(eventsWithX.data.events.length).toEqual(10)
      expect(eventsWithTest.data.events.length).toEqual(0)
      expect(eventsWithComment.data.events.length).toEqual(12)
    })

    it('returns events matching filter params for columns', async () => {
      const [negatedLabelEvent, createdLabelEvent] = await Promise.all([
        emitModerationEvent({
          event: {
            $type: 'com.atproto.admin.defs#modEventLabel',
            comment: 'X',
            negateLabelVals: ['L1', 'L2'],
            createLabelVals: [],
          },
          //   Report bob's account by alice and vice versa
          subject: {
            $type: 'com.atproto.admin.defs#repoRef',
            did: sc.dids.alice,
          },
          createdBy: sc.dids.bob,
        }),
        emitModerationEvent({
          event: {
            $type: 'com.atproto.admin.defs#modEventLabel',
            comment: 'X',
            createLabelVals: ['L1', 'L2'],
            negateLabelVals: [],
          },
          //   Report bob's account by alice and vice versa
          subject: {
            $type: 'com.atproto.admin.defs#repoRef',
            did: sc.dids.bob,
          },
          createdBy: sc.dids.alice,
        }),
      ])
      const [withTwoLabels, withoutTwoLabels, withOneLabel, withoutOneLabel] =
        await Promise.all([
          queryModerationEvents({
            addedLabels: ['L1', 'L3'],
          }),
          queryModerationEvents({
            removedLabels: ['L1', 'L2'],
          }),
          queryModerationEvents({
            addedLabels: ['L1'],
          }),
          queryModerationEvents({
            removedLabels: ['L2'],
          }),
        ])

      // Verify that when querying for events where 2 different labels were added
      // events where all of the labels from the list was added are returned
      expect(withTwoLabels.data.events.length).toEqual(0)
      expect(negatedLabelEvent.data.id).toEqual(
        withoutTwoLabels.data.events[0].id,
      )

      expect(createdLabelEvent.data.id).toEqual(withOneLabel.data.events[0].id)
      expect(negatedLabelEvent.data.id).toEqual(
        withoutOneLabel.data.events[0].id,
      )
    })
  })

  describe('get event', () => {
    it('gets an event by specific id', async () => {
      const { data } = await pdsAgent.api.com.atproto.admin.getModerationEvent(
        { id: 1 },
        { headers: network.bsky.adminAuthHeaders('moderator') },
      )
      expect(forSnapshot(data)).toMatchSnapshot()
    })
  })

  describe('blobs', () => {
    it('are tracked on takedown event', async () => {
      const post = sc.posts[sc.dids.carol][0]
      assert(post.images.length > 1)
      await emitModerationEvent({
        event: {
          $type: 'com.atproto.admin.defs#modEventTakedown',
        },
        subject: {
          $type: 'com.atproto.repo.strongRef',
          uri: post.ref.uriStr,
          cid: post.ref.cidStr,
        },
        subjectBlobCids: [post.images[0].image.ref.toString()],
        createdBy: sc.dids.alice,
      })
      const { data: result } =
        await pdsAgent.api.com.atproto.admin.queryModerationEvents(
          { subject: post.ref.uriStr },
          { headers: network.ozone.adminAuthHeaders('moderator') },
        )
      expect(result.events[0]).toMatchObject({
        createdBy: sc.dids.alice,
        event: {
          $type: 'com.atproto.admin.defs#modEventTakedown',
        },
        subjectBlobCids: [post.images[0].image.ref.toString()],
      })
    })

    it("are tracked on reverse-takedown event even if they aren't specified", async () => {
      const post = sc.posts[sc.dids.carol][0]
      await emitModerationEvent({
        event: {
          $type: 'com.atproto.admin.defs#modEventReverseTakedown',
        },
        subject: {
          $type: 'com.atproto.repo.strongRef',
          uri: post.ref.uriStr,
          cid: post.ref.cidStr,
        },
        createdBy: sc.dids.alice,
      })
      const { data: result } =
        await pdsAgent.api.com.atproto.admin.queryModerationEvents(
          { subject: post.ref.uriStr },
          { headers: network.ozone.adminAuthHeaders('moderator') },
        )
      expect(result.events[0]).toMatchObject({
        createdBy: sc.dids.alice,
        event: {
          $type: 'com.atproto.admin.defs#modEventReverseTakedown',
        },
        subjectBlobCids: [post.images[0].image.ref.toString()],
      })
    })
  })
})
