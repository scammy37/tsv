// An error the API is willing to describe to the client. Anything else that
// reaches the error handler is reported as a generic 500.
class AppError extends Error {
  constructor(statusCode, message, details) {
    super(message);
    this.name = 'AppError';
    this.statusCode = statusCode;
    this.details = details;
    this.expected = true;
    Error.captureStackTrace(this, AppError);
  }

  static badRequest(message, details) { return new AppError(400, message, details); }
  static unauthorized(message = 'Authentication required') { return new AppError(401, message); }
  static forbidden(message = 'You do not have access to this resource') { return new AppError(403, message); }
  static notFound(message = 'Resource not found') { return new AppError(404, message); }
  static conflict(message, details) { return new AppError(409, message, details); }
}

module.exports = AppError;
