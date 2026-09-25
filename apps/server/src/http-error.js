export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message)
    this.statusCode = statusCode
  }
}

export const notFound = (what) => new HttpError(404, `${what} not found`)
