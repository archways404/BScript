const HEARTBEAT_MS = 15_000

// Takes over the raw response for Server-Sent Events. Returns send() and a close hook.
export function openEventStream(reply) {
  reply.hijack()
  const res = reply.raw
  res.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  })
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS)
  const closeHandlers = []
  res.on('close', () => {
    clearInterval(heartbeat)
    for (const handler of closeHandlers) handler()
  })

  return {
    send(event, data) {
      if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    },
    onClose(handler) {
      closeHandlers.push(handler)
    },
    end() {
      res.end()
    },
  }
}
