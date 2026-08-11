const ENDPOINT = 'https://public.intelx.io';

export async function callService({ endpoint, payload, apiKey }) {
  let url;
  let response;

  switch (endpoint) {
    case 'search': {
      url = `${ENDPOINT}/intelligent/search`;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-key': apiKey,
        },
        body: JSON.stringify({
          term: payload.query,
          maxresults: payload.maxresults || 20,
          buckets: payload.buckets || [],
          timeout: payload.timeout || 15,
          sort: payload.sort || 4,
          media: payload.media || 0,
          terminate: ['1'],
        }),
      });
      break;
    }
    case 'results': {
      const offset = payload.offset || 0;
      const limit = payload.limit || 20;
      url = `${ENDPOINT}/intelligent/search/result?id=${encodeURIComponent(payload.id)}&key=${encodeURIComponent(apiKey)}&offset=${offset}&limit=${limit}`;
      response = await fetch(url, {
        method: 'GET',
        headers: {
          'x-key': apiKey,
        },
      });
      break;
    }
    case 'phonebook': {
      url = `${ENDPOINT}/phonebook/search`;
      response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-key': apiKey,
        },
        body: JSON.stringify({
          term: payload.query,
          maxresults: payload.maxresults || 20,
        }),
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
