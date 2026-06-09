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

// "Generate with Template": upload input video first, then trigger the n8n
// render. Resolves with the rendered video URL n8n (→ Creatomate) returns.
export async function startRender({ template_id, video_s3_key, caption }) {
  const { data } = await api.post('/creatomate-templates/renders', { template_id, video_s3_key, caption });
  return data.data; // { url }
}

// Download the rendered video into S3 (called at post-submit, after "Upload output").
export async function saveRender(url) {
  const { data } = await api.post('/creatomate-templates/renders/save', { url });
  return data.data; // { s3Key, mediaUrl, mediaType }
}
