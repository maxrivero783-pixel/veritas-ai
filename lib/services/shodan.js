import { fetchT } from './http.js';
const ENDPOINT = 'https://api.shodan.io';

export async function callService({ endpoint, payload, apiKey }) {
  let url;
  let response;

  switch (endpoint) {
    case 'search': {
      const page = payload.page || 1;
      url = `${ENDPOINT}/shodan/host/search?key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(payload.query)}&page=${page}`;
      response = await fetchT(url);
      break;
    }
    case 'host': {
      url = `${ENDPOINT}/shodan/host/${encodeURIComponent(payload.ip)}?key=${encodeURIComponent(apiKey)}`;
      response = await fetchT(url);
      break;
    }
    case 'exploits': {
      const page = payload.page || 1;
      url = `${ENDPOINT}/shodan/exploits/search?key=${encodeURIComponent(apiKey)}&query=${encodeURIComponent(payload.query)}&page=${page}`;
      response = await fetchT(url);
      break;
    }
    default:
      return { status: 400, data: null, raw: null, error: `Unknown endpoint: ${endpoint}` };
  }

  const raw = await response.text();
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    data = raw;
  }
  return { status: response.status, data, raw, error: response.ok ? undefined : `HTTP ${response.status}` };
}

export default { callService };
