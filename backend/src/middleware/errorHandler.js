function errorHandler(err, req, res, next) {
  console.error(`[Error] ${req.method} ${req.url}:`, err);

  const statusCode = err.status || err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message || 'Internal Server Error',
    ...(process.env.NODE_ENV === 'development' ? { stack: err.stack } : {}),
  });
}

module.exports = errorHandler;
