const ENDPOINT = 'https://api.zoomeye.org';

export async function callService({ endpoint, payload, apiKey }) {
  let url;
  let response;

  switch (endpoint) {
    case 'search': {
      url = `${ENDPOINT}/web/search`;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `JWT ${apiKey}`,
        },
        body: JSON.stringify({
          query: payload.query,
          page: payload.page || 1,
          facets: payload.facets || [],
        }),
      });
      break;
    }
    case 'host': {
      url = `${ENDPOINT}/host/search`;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `JWT ${apiKey}`,
        },
        body: JSON.stringify({
          query: payload.query,
          page: payload.page || 1,
        }),
      });
      break;
    }
    case 'ip': {
      url = `${ENDPOINT}/ip/${encodeURIComponent(payload.ip)}`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `JWT ${apiKey}`,
        },
      });
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
