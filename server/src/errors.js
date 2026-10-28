export class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

export function errorHandler(error, _request, response, _next) {
  if (error.name === 'ZodError') {
    return response.status(400).json({ error: 'Request validation failed' });
  }
  if (error.type === 'entity.parse.failed') {
    return response.status(400).json({ error: 'Request body must contain valid JSON' });
  }
  if (error.type === 'entity.too.large') {
    return response.status(413).json({ error: 'Request body is too large' });
  }
  if (error instanceof HttpError) {
    return response.status(error.statusCode).json({ error: error.message });
  }

  const status = Number.isInteger(error.statusCode)
    ? error.statusCode
    : Number.isInteger(error.status) ? error.status : 500;
  if (status < 400 || status > 599) {
    console.error(error);
    return response.status(500).json({ error: 'An unexpected server error occurred' });
  }
  console.error(error);
  return response.status(status).json({
    error: status >= 500 ? 'An unexpected server error occurred' : 'The request could not be completed',
  });
}
