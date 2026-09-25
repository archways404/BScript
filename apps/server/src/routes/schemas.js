export const idParams = {
  type: 'object',
  required: ['id'],
  properties: { id: { type: 'integer', minimum: 1 } },
}

export const name = { type: 'string', minLength: 1, maxLength: 100 }
