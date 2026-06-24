import api from './api.js';

export async function list() {
  const { data } = await api.get('/creatomate-templates');
  return data.data.templates;
}

export async function create(payload) {
  const { data } = await api.post('/creatomate-templates', payload);
  return data.data.template;
}

export async function update(id, payload) {
  const { data } = await api.patch(`/creatomate-templates/${id}`, payload);
  return data.data.template;
}

export async function remove(id) {
  const { data } = await api.delete(`/creatomate-templates/${id}`);
  return data.data;
}

// "Generate with Template": upload the input video first, then kick off the async
// n8n → Creatomate render. Resolves immediately with a render-job id to poll —
// the render itself finishes later (poll with getRender).
export async function startRender({ template_id, video_s3_key, caption }) {
  const { data } = await api.post('/creatomate-templates/renders', { template_id, video_s3_key, caption });
  return data.data; // { renderJobId, status: 'rendering' }
}

// Poll a render job's state until it's done.
export async function getRender(jobId) {
  const { data } = await api.get(`/creatomate-templates/renders/${jobId}`);
  return data.data; // { renderJobId, status, url, snapshotUrl, errorMessage }
}

// Download the rendered video into S3 (called at post-submit, after "Upload output").
export async function saveRender(url) {
  const { data } = await api.post('/creatomate-templates/renders/save', { url });
  return data.data; // { s3Key, mediaUrl, mediaType }
}
