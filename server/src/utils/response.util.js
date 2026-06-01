// Consistent response envelope: { success, data } / { success, message }.
export function sendSuccess(res, data = null, status = 200) {
  return res.status(status).json({ success: true, data });
}

export function sendError(res, status, message, details) {
  const body = { success: false, message };
  if (details) body.details = details;
  return res.status(status).json(body);
}
