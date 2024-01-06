import express from 'express'
import { sql } from 'kysely'
import AppContext from './context'

export const createRouter = (ctx: AppContext): express.Router => {
  const router = express.Router()

  router.get('/', function (req, res) {
    res.type('text/plain')
    res.send(
      'Under construction',
    )
  })

  router.get('/xrpc/_health2', async function (req, res) {
    const { version } = ctx.cfg
    try {
      await sql`select 1`.execute(ctx.db.db)
    } catch (err) {
      req.log.error(err, 'failed health check')
      return res.status(503).send({ version, error: 'Service Unavailable' })
    }
    res.send({ version })
  })

  return router
}
