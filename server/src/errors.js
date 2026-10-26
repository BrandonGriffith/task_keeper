export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(error, _request, response, _next) {
  if (error.name === 'ZodError') {
    return response.status(400).json({ error: 'Request validation failed', details: error.issues });
  }
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must contain valid JSON' });
  }

  const status = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status) ? error.status : 500;
  if (status >= 500) console.error(error);
  return response.status(status).json({
    error: status >= 500 ? 'An unexpected server error occurred' : error.message,
  });
}
