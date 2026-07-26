import supabase from './db-client.js';
import { cloneUrl } from './_engine.js';

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  let body = req.body || {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  const { url, mode = 'section', pro = false, maxSections = 24 } = body;

  if (!url || typeof url !== 'string' || url.trim().length < 4) {
    return res.status(400).json({ error: 'A valid website URL is required.' });
  }

  const hostOf = (u) => {
    try {
      return new URL(/^https?:/i.test(u) ? u : 'https://' + u).host;
    } catch {
      return String(u).slice(0, 80);
    }
  };

  try {
    const result = await cloneUrl(url, { mode, pro, maxSections });

    const row = {
      url: result.meta.url,
      host: result.meta.host,
      page_title: result.meta.title,
      favicon: result.meta.favicon,
      platform: result.meta.platform,
      mode,
      status: 'success',
      sections_count: result.stats.sections,
      widgets_count: result.stats.widgets,
      images_count: result.stats.images,
      duration_ms: result.stats.durationMs,
      html_kb: result.stats.htmlKb,
      json_kb: result.stats.jsonKb,
      result,
    };

    const { data, error } = await supabase.from('clone_jobs').insert(row).select('id, created_at').single();
    if (error) throw error;

    return res.status(201).json({ ...result, jobId: data.id, createdAt: data.created_at });
  } catch (err) {
    console.error('clone error', err);
    try {
      await supabase.from('clone_jobs').insert({
        url,
        host: hostOf(url),
        page_title: 'Failed clone',
        platform: 'unknown',
        mode,
        status: 'error',
        sections_count: 0,
        widgets_count: 0,
        images_count: 0,
        error: String(err.message || err).slice(0, 400),
      });
    } catch {
      /* ignore logging failure */
    }
    return res.status(502).json({ error: String(err.message || err) });
  }
}
