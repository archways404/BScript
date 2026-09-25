import { changePassword, checkCredentials, getAdmin } from '../auth/admin.js'
import { verifyPassword } from '../auth/passwords.js'
import { createLoginLimiter } from '../auth/rate-limit.js'
import { SESSION_COOKIE, SESSION_TTL_SEC } from '../auth/session.js'

export default async function authRoutes(app, { sessions }) {
  const limiter = createLoginLimiter()
  const cookieOptions = {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: app.config.publicUrl.startsWith('https://'),
  }

  function setSession(reply, admin) {
    reply.setCookie(SESSION_COOKIE, sessions.issue({ user: admin.user, version: admin.sessionVersion }), {
      ...cookieOptions,
      maxAge: SESSION_TTL_SEC,
    })
  }

  app.post(
    '/api/auth/login',
    {
      schema: {
        body: {
          type: 'object',
          required: ['username', 'password'],
          properties: { username: { type: 'string' }, password: { type: 'string' } },
        },
      },
    },
    async (request, reply) => {
      if (limiter.blocked(request.ip)) {
        return reply.code(429).send({ error: 'Too many failed attempts, try again later' })
      }
      const admin = await checkCredentials(app.db, request.body.username, request.body.password)
      if (!admin) {
        limiter.fail(request.ip)
        return reply.code(401).send({ error: 'Invalid username or password' })
      }
      limiter.reset(request.ip)
      setSession(reply, admin)
      return { user: admin.user }
    },
  )

  app.post('/api/auth/logout', async (request, reply) => {
    reply.clearCookie(SESSION_COOKIE, cookieOptions)
    return { ok: true }
  })

  app.get('/api/auth/me', async (request) => request.auth)

  app.post(
    '/api/auth/password',
    {
      config: { sessionOnly: true },
      schema: {
        body: {
          type: 'object',
          required: ['currentPassword', 'newPassword'],
          properties: {
            currentPassword: { type: 'string' },
            newPassword: { type: 'string', minLength: 8, maxLength: 200 },
          },
        },
      },
    },
    async (request, reply) => {
      const admin = getAdmin(app.db)
      if (!(await verifyPassword(request.body.currentPassword, admin.passwordHash))) {
        return reply.code(400).send({ error: 'Current password is wrong' })
      }
      const version = await changePassword(app.db, request.body.newPassword)
      setSession(reply, { user: admin.user, sessionVersion: version })
      return { ok: true }
    },
  )
}
